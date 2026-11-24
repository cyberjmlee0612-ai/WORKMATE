"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, LoaderCircle, X } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { PROJECT_STATUS_LABEL, isEditableStatus, listProjects, projectKeys } from "@/lib/api/projects";
import {
  ESTIMATED_MINUTES_MAX, TASK_PRIORITIES, TASK_PRIORITY_LABEL, TASK_STATUSES, TASK_STATUS_LABEL,
  createTask, updateTask,
  type Task, type TaskInput, type TaskPriority, type TaskStatus,
} from "@/lib/api/tasks";
import { invalidateWorkData } from "@/lib/api/invalidate";

const TITLE_MAX = 300;
const DESCRIPTION_MAX = 2000;

type Fields = {
  title: string;
  description: string;
  project_id: string; // "" = 개인 업무
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string;
  estimated_minutes: string; // 입력 중인 문자열 그대로 보관
};
type FieldErrors = Partial<Record<keyof Fields | "_form", string>>;

function initialFields(task?: Task, defaultProjectId?: string | null, defaultDueDate?: string | null): Fields {
  return {
    title: task?.title ?? "",
    description: task?.description ?? "",
    project_id: task ? task.project_id ?? "" : defaultProjectId ?? "",
    status: task?.status ?? "todo",
    priority: task?.priority ?? "medium",
    due_date: task ? task.due_date ?? "" : defaultDueDate ?? "",
    estimated_minutes: task?.estimated_minutes ? String(task.estimated_minutes) : "",
  };
}

/** 서버와 같은 규칙 (빠른 안내용, 서버가 다시 검사한다) */
function validate(fields: Fields): FieldErrors {
  const errors: FieldErrors = {};
  const title = fields.title.trim();
  if (!title) errors.title = "업무 제목을 입력해 주세요.";
  else if (title.length > TITLE_MAX) errors.title = `업무 제목은 ${TITLE_MAX}자 이하로 입력해 주세요.`;
  if (fields.description.trim().length > DESCRIPTION_MAX) errors.description = `설명은 ${DESCRIPTION_MAX}자 이하로 입력해 주세요.`;
  const minutes = fields.estimated_minutes.trim();
  if (minutes) {
    if (!/^\d+$/.test(minutes)) errors.estimated_minutes = "예상 시간은 분 단위 정수로 입력해 주세요.";
    else if (Number(minutes) <= 0) errors.estimated_minutes = "예상 시간은 1분 이상이어야 합니다.";
    else if (Number(minutes) > ESTIMATED_MINUTES_MAX) errors.estimated_minutes = `예상 시간은 ${ESTIMATED_MINUTES_MAX.toLocaleString()}분 이하로 입력해 주세요.`;
  }
  return errors;
}

type Props = {
  /** 없으면 생성, 있으면 수정 */
  task?: Task;
  /** 생성 시 미리 선택할 프로젝트 (프로젝트 상세에서 추가할 때) */
  defaultProjectId?: string | null;
  /** 생성 시 미리 채울 마감일 (대시보드 '오늘의 업무'에서 추가할 때) */
  defaultDueDate?: string | null;
  onClose: () => void;
};

/** 열 때마다 새로 마운트해서 사용한다: `{open && <TaskFormDialog … />}` */
export function TaskFormDialog({ task, defaultProjectId, defaultDueDate, onClose }: Props) {
  const isEdit = Boolean(task);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formId = useId();
  const queryClient = useQueryClient();

  const [fields, setFields] = useState<Fields>(() => initialFields(task, defaultProjectId, defaultDueDate));
  const [errors, setErrors] = useState<FieldErrors>({});

  const projectsQuery = useQuery({ queryKey: projectKeys.list(), queryFn: listProjects });
  // 진행 중인 프로젝트만 선택지로. 단, 이미 연결된 프로젝트는 완료·보관 상태여도 남겨 둔다.
  const projectOptions = (projectsQuery.data ?? []).filter((p) => isEditableStatus(p.status) || p.id === fields.project_id);
  // 목록에 없는 프로젝트(다른 탭에서 삭제 등)에 연결된 업무를 수정할 때도 현재 값이 사라지지 않게 한다
  const missingCurrent =
    fields.project_id && projectsQuery.isSuccess && !projectOptions.some((p) => p.id === fields.project_id)
      ? { id: fields.project_id, name: task?.project_name ?? "알 수 없는 프로젝트" }
      : null;

  const mutation = useMutation({
    mutationFn: (input: TaskInput) => (task ? updateTask(task.id, input) : createTask(input)),
    onSuccess: () => {
      // 업무 변경은 프로젝트 진행률·대시보드 KPI에도 영향을 준다
      invalidateWorkData(queryClient);
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiError && Object.keys(error.fieldErrors).length > 0) {
        setErrors(error.fieldErrors as FieldErrors);
        // 선택한 프로젝트가 사라졌을 수 있으므로 목록을 새로 받는다
        if (error.fieldErrors.project_id) queryClient.invalidateQueries({ queryKey: projectKeys.all });
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
    if (!pending) onClose();
  }

  function update<K extends keyof Fields>(key: K, value: Fields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined, _form: undefined }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const found = validate(fields);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    mutation.mutate({
      title: fields.title.trim(),
      description: fields.description.trim() || null,
      project_id: fields.project_id || null,
      status: fields.status,
      priority: fields.priority,
      due_date: fields.due_date || null,
      estimated_minutes: fields.estimated_minutes.trim() ? Number(fields.estimated_minutes.trim()) : null,
    });
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
        event.preventDefault();
        requestClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) requestClose();
      }}
      aria-labelledby={`${formId}-title`}
      className="surface-card m-auto w-[calc(100%-2rem)] max-w-lg rounded-[20px] p-0 text-foreground backdrop:bg-primary-dark/30 backdrop:backdrop-blur-[2px]"
    >
      <form onSubmit={handleSubmit} noValidate className="max-h-[85vh] overflow-y-auto p-5 md:p-6">
        <div className="flex items-start justify-between gap-3">
          <h2 id={`${formId}-title`} className="text-xl font-bold text-primary-dark">{isEdit ? "업무 수정" : "새 업무"}</h2>
          <button type="button" onClick={requestClose} disabled={pending} className="-mr-2 -mt-1 flex size-11 items-center justify-center rounded-xl text-muted hover:bg-pale-green hover:text-primary-dark" aria-label="닫기">
            <X size={20} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        <fieldset disabled={pending} className="mt-5 space-y-4">
          <label className="block text-sm font-medium">
            제목 <span className="text-red-700" aria-hidden="true">*</span>
            <input autoFocus value={fields.title} onChange={(e) => update("title", e.target.value)} required className={inputClass(Boolean(errors.title))} placeholder="예: 화면 설계서 검토하기" {...a11y("title")} />
            {errorText("title")}
          </label>

          <label className="block text-sm font-medium">
            설명
            <textarea value={fields.description} onChange={(e) => update("description", e.target.value)} rows={3} className={`${inputClass(Boolean(errors.description))} py-2.5 leading-6`} placeholder="메모 (선택)" {...a11y("description")} />
            {errorText("description")}
          </label>

          <label className="block text-sm font-medium">
            프로젝트
            <select value={fields.project_id} onChange={(e) => update("project_id", e.target.value)} disabled={projectsQuery.isPending} className={inputClass(Boolean(errors.project_id))} {...a11y("project_id")}>
              <option value="">없음 (개인 업무)</option>
              {projectsQuery.isPending && fields.project_id && <option value={fields.project_id}>{task?.project_name ?? "불러오는 중…"}</option>}
              {projectOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{isEditableStatus(p.status) ? "" : ` (${PROJECT_STATUS_LABEL[p.status]})`}
                </option>
              ))}
              {missingCurrent && <option value={missingCurrent.id}>{missingCurrent.name}</option>}
            </select>
            {projectsQuery.isError && <span className="mt-1 block text-xs text-muted">프로젝트 목록을 불러오지 못했습니다. 개인 업무로 저장할 수 있습니다.</span>}
            {errorText("project_id")}
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium">
              상태
              <select value={fields.status} onChange={(e) => update("status", e.target.value as TaskStatus)} className={inputClass(false)}>
                {TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}
                {/* 제외된 업무를 수정할 때만 현재 값으로 남겨 둔다 (새로 제외하는 것은 상태 메뉴에서) */}
                {task?.status === "cancelled" && <option value="cancelled">{TASK_STATUS_LABEL.cancelled}</option>}
              </select>
            </label>
            <label className="block text-sm font-medium">
              우선순위
              <select value={fields.priority} onChange={(e) => update("priority", e.target.value as TaskPriority)} className={inputClass(false)}>
                {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{TASK_PRIORITY_LABEL[p]}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium">
              마감일
              <input type="date" value={fields.due_date} onChange={(e) => update("due_date", e.target.value)} className={inputClass(Boolean(errors.due_date))} {...a11y("due_date")} />
              {errorText("due_date")}
            </label>
            <label className="block text-sm font-medium">
              예상 시간 (분)
              <input type="text" inputMode="numeric" value={fields.estimated_minutes} onChange={(e) => update("estimated_minutes", e.target.value)} className={inputClass(Boolean(errors.estimated_minutes))} placeholder="예: 90" {...a11y("estimated_minutes")} />
              {errorText("estimated_minutes")}
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
          <button type="button" onClick={requestClose} disabled={pending} className="min-h-11 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-primary-dark hover:bg-pale-green disabled:opacity-60">취소</button>
          <button type="submit" disabled={pending} aria-busy={pending} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-75">
            {pending && <LoaderCircle size={18} strokeWidth={2} className="animate-spin" aria-hidden="true" />}
            {pending ? "저장 중…" : isEdit ? "저장" : "추가"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
