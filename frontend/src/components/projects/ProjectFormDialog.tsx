"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { buildTree, parentOptions } from "@/lib/projectTree";
import { CircleAlert, LoaderCircle, X } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import {
  EDITABLE_PROJECT_STATUSES, PROJECT_STATUS_LABEL, createProject, isEditableStatus, listProjects, projectKeys, updateProject,
  type EditableProjectStatus, type Project, type ProjectInput,
} from "@/lib/api/projects";
import { invalidateWorkData } from "@/lib/api/invalidate";

const NAME_MAX = 200;
const DESCRIPTION_MAX = 2000;

type Fields = { name: string; description: string; status: EditableProjectStatus; start_date: string; due_date: string; parent_id: string };
type FieldErrors = Partial<Record<keyof Fields | "_form", string>>;

function initialFields(project?: Project, defaultParentId?: string): Fields {
  return {
    name: project?.name ?? "",
    description: project?.description ?? "",
    status: project && isEditableStatus(project.status) ? project.status : "planning",
    start_date: project?.start_date ?? "",
    due_date: project?.due_date ?? "",
    parent_id: project ? (project.parent_id ?? "") : (defaultParentId ?? ""),
  };
}

/** 서버와 같은 규칙. 서버도 다시 검사하므로 여기서는 빠른 안내용이다. */
function validate(fields: Fields): FieldErrors {
  const errors: FieldErrors = {};
  const name = fields.name.trim();
  if (!name) errors.name = "프로젝트 이름을 입력해 주세요.";
  else if (name.length > NAME_MAX) errors.name = `프로젝트 이름은 ${NAME_MAX}자 이하로 입력해 주세요.`;
  if (fields.description.trim().length > DESCRIPTION_MAX) errors.description = `설명은 ${DESCRIPTION_MAX}자 이하로 입력해 주세요.`;
  // "YYYY-MM-DD" 문자열은 사전순 비교가 날짜 비교와 같다
  if (fields.start_date && fields.due_date && fields.start_date > fields.due_date) errors.due_date = "마감일은 시작일과 같거나 이후여야 합니다.";
  return errors;
}

type Props = {
  /** 없으면 생성, 있으면 수정 */
  project?: Project;
  /** 새로 만들 때 미리 고를 상위 프로젝트 (프로젝트 상세의 '하위 프로젝트 추가') */
  defaultParentId?: string;
  onClose: () => void;
  onSaved?: (project: Project) => void;
};

/** 열 때마다 새로 마운트해서 사용한다: `{open && <ProjectFormDialog … />}` */
export function ProjectFormDialog({ project, defaultParentId, onClose, onSaved }: Props) {
  const isEdit = Boolean(project);
  const statusEditable = !project || isEditableStatus(project.status);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formId = useId();
  const queryClient = useQueryClient();

  const [fields, setFields] = useState<Fields>(() => initialFields(project, defaultParentId));
  // 상위 프로젝트 선택지: 3단계·순환·완료/보관 규칙에 맞는 것만 (서버도 다시 검사)
  const projectsQuery = useQuery({ queryKey: projectKeys.list(), queryFn: listProjects });
  const tree = buildTree(projectsQuery.data ?? []);
  const parentChoices = parentOptions(tree, project?.id ?? null);
  const [errors, setErrors] = useState<FieldErrors>({});

  const mutation = useMutation({
    mutationFn: (input: ProjectInput) => (project ? updateProject(project.id, input) : createProject(input)),
    onSuccess: (saved) => {
      queryClient.setQueryData(projectKeys.detail(saved.id), saved);
      // 프로젝트 목록·대시보드, 그리고 업무 행에 표시되는 프로젝트명까지 갱신
      invalidateWorkData(queryClient);
      onSaved?.(saved);
      onClose();
    },
    onError: (error) => {
      // 실패해도 입력값은 그대로 두고 오류만 표시한다
      if (error instanceof ApiError && Object.keys(error.fieldErrors).length > 0) {
        setErrors(error.fieldErrors as FieldErrors);
      } else {
        setErrors({ _form: error instanceof ApiError ? error.message : "저장하지 못했습니다. 잠시 후 다시 시도해 주세요." });
      }
    },
  });
  const pending = mutation.isPending;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  function requestClose() {
    if (!pending) onClose(); // 저장 중에는 닫지 않는다
  }

  function update<K extends keyof Fields>(key: K, value: Fields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined, _form: undefined }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return; // 중복 제출 방지
    const found = validate(fields);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const input: ProjectInput = {
      name: fields.name.trim(),
      description: fields.description.trim() || null,
      start_date: fields.start_date || null,
      due_date: fields.due_date || null,
      ...(statusEditable ? { status: fields.status } : {}),
      // 수정할 때는 바뀐 경우에만 보낸다 (그대로면 계층 검사를 다시 할 필요가 없다)
      ...(!project || (project.parent_id ?? "") !== fields.parent_id ? { parent_id: fields.parent_id || null } : {}),
    };
    mutation.mutate(input);
  }

  const inputClass = (invalid: boolean) =>
    `mt-1.5 block min-h-11 w-full rounded-xl border bg-surface px-3.5 text-[15px] text-foreground focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 disabled:opacity-60 ${invalid ? "border-red-400" : "border-border focus:border-primary"}`;

  const errorText = (key: keyof Fields) =>
    errors[key] ? (
      <span id={`${formId}-${key}-error`} className="mt-1 flex items-center gap-1 text-xs text-red-700">
        <CircleAlert size={14} strokeWidth={2} aria-hidden="true" />
        {errors[key]}
      </span>
    ) : null;

  const a11y = (key: keyof Fields) => ({
    "aria-invalid": Boolean(errors[key]) || undefined,
    "aria-describedby": errors[key] ? `${formId}-${key}-error` : undefined,
  });

  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault(); // Esc: 직접 닫아 상태를 일관되게 유지
        requestClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) requestClose(); // 바깥(backdrop) 클릭
      }}
      aria-labelledby={`${formId}-title`}
      className="surface-card m-auto w-[calc(100%-2rem)] max-w-lg rounded-[20px] p-0 text-foreground backdrop:bg-primary-dark/30 backdrop:backdrop-blur-[2px]"
    >
      <form onSubmit={handleSubmit} noValidate className="max-h-[85vh] overflow-y-auto p-5 md:p-6">
        <div className="flex items-start justify-between gap-3">
          <h2 id={`${formId}-title`} className="text-xl font-bold text-primary-dark">
            {isEdit ? "프로젝트 수정" : "새 프로젝트"}
          </h2>
          <button type="button" onClick={requestClose} disabled={pending} className="-mr-2 -mt-1 flex size-11 items-center justify-center rounded-xl text-muted hover:bg-pale-green hover:text-primary-dark" aria-label="닫기">
            <X size={20} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        <fieldset disabled={pending} className="mt-5 space-y-4">
          <label className="block text-sm font-medium">
            이름 <span className="text-red-700" aria-hidden="true">*</span>
            <input autoFocus value={fields.name} onChange={(e) => update("name", e.target.value)} required className={inputClass(Boolean(errors.name))} placeholder="예: WORKMATE 개발" {...a11y("name")} />
            {errorText("name")}
          </label>

          <label className="block text-sm font-medium">
            설명
            <textarea value={fields.description} onChange={(e) => update("description", e.target.value)} rows={3} className={`${inputClass(Boolean(errors.description))} py-2.5 leading-6`} placeholder="프로젝트 목표나 메모 (선택)" {...a11y("description")} />
            {errorText("description")}
          </label>

          <label className="block text-sm font-medium">
            상위 프로젝트 <span className="font-normal text-muted">(최대 3단계)</span>
            <select value={fields.parent_id} onChange={(e) => update("parent_id", e.target.value)} disabled={projectsQuery.isPending} className={inputClass(Boolean(errors.parent_id))} {...a11y("parent_id")}>
              <option value="">없음 (최상위)</option>
              {parentChoices.map(({ project: p, label }) => (
                <option key={p.id} value={p.id}>{label}</option>
              ))}
            </select>
            {errorText("parent_id")}
          </label>

          {statusEditable ? (
            <label className="block text-sm font-medium">
              상태
              <select value={fields.status} onChange={(e) => update("status", e.target.value as EditableProjectStatus)} className={inputClass(false)}>
                {EDITABLE_PROJECT_STATUSES.map((status) => (
                  <option key={status} value={status}>{PROJECT_STATUS_LABEL[status]}</option>
                ))}
              </select>
            </label>
          ) : (
            <p className="rounded-xl bg-background px-3.5 py-3 text-sm text-muted">
              현재 상태: <strong className="font-semibold text-foreground">{PROJECT_STATUS_LABEL[project!.status]}</strong>. 완료·보관 상태는 이 창에서 바꿀 수 없습니다.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium">
              시작일
              <input type="date" value={fields.start_date} onChange={(e) => update("start_date", e.target.value)} className={inputClass(false)} />
            </label>
            <label className="block text-sm font-medium">
              마감일
              <input type="date" value={fields.due_date} min={fields.start_date || undefined} onChange={(e) => update("due_date", e.target.value)} className={inputClass(Boolean(errors.due_date))} {...a11y("due_date")} />
              {errorText("due_date")}
            </label>
          </div>
        </fieldset>

        {errors._form && (
          <p className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800" role="alert">
            <CircleAlert size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
            {errors._form}
          </p>
        )}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={requestClose} disabled={pending} className="min-h-11 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-primary-dark hover:bg-pale-green disabled:opacity-60">
            취소
          </button>
          <button type="submit" disabled={pending} aria-busy={pending} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-75">
            {pending && <LoaderCircle size={18} strokeWidth={2} className="animate-spin" aria-hidden="true" />}
            {pending ? "저장 중…" : isEdit ? "저장" : "만들기"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
