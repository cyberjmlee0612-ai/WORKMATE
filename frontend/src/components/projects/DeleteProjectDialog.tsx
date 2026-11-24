"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, CircleAlert, Info, LoaderCircle, Trash2, UserRound } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { dashboardKeys } from "@/lib/api/dashboard";
import {
  deleteProject, getDeletionPreview, isTasksChanged, projectKeys,
  type DeletionMode, type Project,
} from "@/lib/api/projects";
import { taskKeys, type Task } from "@/lib/api/tasks";
import { TaskStatusBadge } from "@/components/tasks/TaskBadges";
import { ErrorState } from "@/components/common/QueryStates";

type Step = "choose" | "confirm";

type Props = {
  project: Project;
  onClose: () => void;
  /** 삭제 성공(또는 이미 삭제됨) 후 호출. 상세 화면을 떠나는 처리를 한다. */
  onDeleted: () => void;
};

/**
 * 프로젝트 삭제 (PRD §3 프로젝트 삭제 대화상자)
 *  A. 개인 업무로 옮기고 삭제 — 업무 목록 펼치기/접기, 처음엔 전체 선택, 모두 선택/해제, 0개 선택이면 진행 불가
 *  B. 삭제 취소 — 아무것도 바꾸지 않음
 *  C. 업무도 함께 삭제 — 삭제될 업무 목록·개수를 보여주고 최종 확인
 * 연결된 업무가 0개면 선택 없이 삭제 확인만 한다. 서버가 한 트랜잭션으로 처리한다.
 *
 * 열 때마다 새로 마운트해서 사용한다.
 */
export function DeleteProjectDialog({ project, onClose, onDeleted }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const id = useId();
  const queryClient = useQueryClient();

  // 열 때마다 서버의 최신 소속 업무를 받는다 (캐시 사용 안 함)
  const preview = useQuery({
    queryKey: [...projectKeys.detail(project.id), "deletion-preview"],
    queryFn: () => getDeletionPreview(project.id),
    gcTime: 0,
    staleTime: 0,
    // 확인 중에 목록이 말없이 바뀌지 않게 한다. 바뀐 경우는 서버가 409로 알려주고 다시 확인시킨다.
    refetchOnWindowFocus: false,
  });

  // 409로 받은 최신 목록이 있으면 그것을, 없으면 처음 받은 목록을 쓴다
  const [latestTasks, setLatestTasks] = useState<Task[] | null>(null);
  const tasks = latestTasks ?? preview.data?.tasks ?? null;
  // A의 선택은 '선택 해제한 업무'로 저장한다 → 처음엔 전체 선택, 새로 생긴 업무도 자동으로 선택된다
  const [unselected, setUnselected] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<Step>("choose");
  const [mode, setMode] = useState<DeletionMode | null>(null);
  const [listOpen, setListOpen] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  function finish() {
    // 상세 화면을 먼저 떠난 뒤 목록·대시보드를 갱신한다 (떠나기 전 상세가 다시 조회되어 '찾을 수 없음'이 깜빡이지 않게)
    onDeleted();
    queryClient.invalidateQueries({ queryKey: taskKeys.all });
    queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    queryClient.invalidateQueries({ queryKey: projectKeys.list() });
    requestAnimationFrame(() => queryClient.removeQueries({ queryKey: projectKeys.detail(project.id) }));
  }

  const mutation = useMutation({
    mutationFn: (input: { mode: DeletionMode; keepIds: string[]; expectedIds: string[] }) =>
      deleteProject(project.id, { mode: input.mode, expected_task_ids: input.expectedIds, keep_task_ids: input.keepIds }),
    onSuccess: finish,
    onError: (err) => {
      if (err instanceof ApiError && err.status === 404) {
        finish(); // 이미 삭제됨(다른 탭·중복 요청) — 결과가 같으므로 성공으로 처리
        return;
      }
      if (err instanceof ApiError && err.status === 409 && isTasksChanged(err.body)) {
        // 다른 곳에서 업무가 바뀜: 최신 목록으로 다시 확인. 선택 해제는 남은 업무에 한해 유지, 새 업무는 선택된 상태
        const latest = err.body.tasks;
        const latestIds = new Set(latest.map((t) => t.id));
        setUnselected((prev) => new Set([...prev].filter((taskId) => latestIds.has(taskId))));
        setLatestTasks(latest);
        setStep("choose");
        setMode(latest.length === 0 ? null : mode);
        setNotice(err.body.detail);
        return;
      }
      setError(err instanceof ApiError ? (err.fieldErrors.keep_task_ids ?? err.message) : "삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    },
  });
  const pending = mutation.isPending;

  function requestClose() {
    if (!pending) onClose(); // B. 삭제 취소 — 데이터 변경 없음
  }

  function submit() {
    if (pending || !tasks) return;
    setError(null);
    const effectiveMode: DeletionMode = tasks.length === 0 ? "delete" : mode!;
    mutation.mutate({
      mode: effectiveMode,
      expectedIds: tasks.map((t) => t.id),
      keepIds: effectiveMode === "move" ? tasks.filter((t) => !unselected.has(t.id)).map((t) => t.id) : [],
    });
  }

  function toggle(taskId: string) {
    setUnselected((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  const kept = tasks?.filter((t) => !unselected.has(t.id)) ?? [];
  const dropped = tasks?.filter((t) => unselected.has(t.id)) ?? [];
  const canProceed = mode === "delete" || (mode === "move" && kept.length > 0);

  // ---------- 화면 ----------
  let body: React.ReactNode;
  if (preview.isPending || tasks === null) {
    body = preview.isError ? (
      <div className="mt-4">
        <ErrorState message={preview.error.message} onRetry={() => preview.refetch()} retrying={preview.isRefetching} />
      </div>
    ) : (
      <div className="flex items-center gap-2 py-8 text-sm text-muted" aria-busy="true">
        <LoaderCircle size={18} strokeWidth={2} className="animate-spin" aria-hidden="true" />
        연결된 업무를 확인하는 중…
      </div>
    );
  } else if (tasks.length === 0) {
    body = (
      <>
        <p className="mt-2 text-sm leading-6 text-muted">
          <strong className="font-semibold text-foreground">“{project.name}”</strong>에 연결된 업무가 없어요. 프로젝트를 삭제하면 되돌릴 수 없습니다.
        </p>
        <Footer>
          <SecondaryButton onClick={requestClose} disabled={pending}>취소</SecondaryButton>
          <DangerButton onClick={submit} pending={pending}>프로젝트 삭제</DangerButton>
        </Footer>
      </>
    );
  } else if (step === "choose") {
    body = (
      <>
        <p className="mt-2 text-sm leading-6 text-muted">
          <strong className="font-semibold text-foreground">“{project.name}”</strong>에 업무 <strong className="text-foreground">{tasks.length}개</strong>가 연결되어 있어요. 업무를 어떻게 할까요?
        </p>

        <fieldset className="mt-4 space-y-3" disabled={pending}>
          <legend className="sr-only">연결된 업무 처리 방법</legend>

          {/* A. 개인 업무로 이동 */}
          <div className={`rounded-xl border p-3.5 ${mode === "move" ? "border-primary bg-pale-green/40" : "border-border"}`}>
            <label className="flex cursor-pointer items-start gap-3">
              <input type="radio" name={`${id}-mode`} checked={mode === "move"} onChange={() => setMode("move")} className="mt-1 size-4 accent-[var(--primary)]" />
              <span>
                <span className="block text-sm font-semibold text-primary-dark">업무를 개인 업무로 옮기고 삭제</span>
                <span className="mt-0.5 block text-xs leading-5 text-muted">선택한 업무는 개인 업무로 남고, 선택하지 않은 업무는 삭제돼요.</span>
              </span>
            </label>

            {mode === "move" && (
              <div className="mt-3 border-t border-border pt-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button type="button" onClick={() => setListOpen((v) => !v)} aria-expanded={listOpen} aria-controls={`${id}-keep-list`} className="flex min-h-11 items-center gap-1 text-sm font-medium text-primary-dark">
                    <ChevronDown size={16} strokeWidth={2} aria-hidden="true" className={`transition-transform ${listOpen ? "" : "-rotate-90"}`} />
                    업무 목록 {listOpen ? "접기" : "펼치기"} <span className="font-normal text-muted">({kept.length}/{tasks.length} 선택)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setUnselected(kept.length === tasks.length ? new Set(tasks.map((t) => t.id)) : new Set())}
                    className="min-h-11 rounded-lg px-2 text-sm font-medium text-primary hover:underline"
                  >
                    {kept.length === tasks.length ? "모두 해제" : "모두 선택"}
                  </button>
                </div>
                {listOpen && (
                  <ul id={`${id}-keep-list`} className="max-h-56 space-y-0.5 overflow-y-auto pr-1">
                    {tasks.map((task) => (
                      <li key={task.id}>
                        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-1.5 hover:bg-pale-green/50">
                          <input type="checkbox" checked={!unselected.has(task.id)} onChange={() => toggle(task.id)} className="size-4 shrink-0 accent-[var(--primary)]" />
                          <span className="min-w-0 flex-1 break-words text-sm">{task.title}</span>
                          <TaskStatusBadge status={task.status} />
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
                {kept.length === 0 && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-red-700" role="alert">
                    <CircleAlert size={14} strokeWidth={2} aria-hidden="true" />
                    개인 업무로 옮길 업무를 1개 이상 선택해 주세요. 모두 지우려면 아래 ‘업무도 함께 삭제’를 고르세요.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* C. 함께 삭제 */}
          <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 ${mode === "delete" ? "border-red-300 bg-red-50/60" : "border-border"}`}>
            <input type="radio" name={`${id}-mode`} checked={mode === "delete"} onChange={() => setMode("delete")} className="mt-1 size-4 accent-red-700" />
            <span>
              <span className="block text-sm font-semibold text-primary-dark">업무도 함께 삭제</span>
              <span className="mt-0.5 block text-xs leading-5 text-muted">연결된 업무 {tasks.length}개가 모두 삭제되고 되돌릴 수 없어요.</span>
            </span>
          </label>
        </fieldset>

        <Footer>
          {/* B. 삭제 취소 */}
          <SecondaryButton onClick={requestClose} disabled={pending}>삭제 취소</SecondaryButton>
          <button
            type="button"
            onClick={() => canProceed && setStep("confirm")}
            disabled={!canProceed}
            className="flex min-h-11 items-center justify-center rounded-xl bg-primary-dark px-5 text-sm font-semibold text-white hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            다음
          </button>
        </Footer>
      </>
    );
  } else {
    // 최종 확인: 보존할 업무와 삭제될 업무를 나눠 보여준다
    const toDelete = mode === "move" ? dropped : tasks;
    body = (
      <>
        <p className="mt-2 text-sm leading-6 text-muted">
          <strong className="font-semibold text-foreground">“{project.name}”</strong> 프로젝트를 삭제합니다. 아래 내용을 확인해 주세요.
        </p>
        <div className="mt-4 space-y-3">
          {mode === "move" && (
            <TaskSummary title="개인 업무로 옮길 업무" tasks={kept} icon={<UserRound size={16} strokeWidth={2} aria-hidden="true" />} tone="text-primary-dark" />
          )}
          <TaskSummary
            title="삭제될 업무"
            tasks={toDelete}
            icon={<Trash2 size={16} strokeWidth={2} aria-hidden="true" />}
            tone="text-red-800"
            empty="삭제될 업무가 없어요."
          />
        </div>
        <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-muted">
          <Info size={14} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
          프로젝트와 삭제된 업무는 되돌릴 수 없어요. 처리 중 문제가 생기면 아무것도 바뀌지 않아요.
        </p>
        <Footer>
          <SecondaryButton onClick={() => setStep("choose")} disabled={pending}>
            <ArrowLeft size={16} strokeWidth={2} aria-hidden="true" />
            이전
          </SecondaryButton>
          <DangerButton onClick={submit} pending={pending}>
            {mode === "move" ? `옮기고 프로젝트 삭제` : `업무 ${tasks.length}개와 프로젝트 삭제`}
          </DangerButton>
        </Footer>
      </>
    );
  }

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
      role="alertdialog"
      aria-labelledby={`${id}-title`}
      className="surface-card m-auto w-[calc(100%-2rem)] max-w-lg rounded-[20px] p-0 text-foreground backdrop:bg-primary-dark/30"
    >
      <div className="max-h-[85vh] overflow-y-auto p-5 md:p-6">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-red-50 text-red-700">
          <Trash2 size={20} strokeWidth={2} aria-hidden="true" />
        </span>
        <h2 id={`${id}-title`} className="mt-4 text-lg font-bold text-primary-dark">
          {step === "confirm" ? "삭제 내용을 확인해 주세요" : "프로젝트를 삭제할까요?"}
        </h2>

        {notice && (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-soft-sage bg-pale-green/60 px-3.5 py-3 text-sm text-primary-dark" role="status">
            <Info size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
            {notice}
          </p>
        )}

        {body}

        {error && (
          <p className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800" role="alert">
            <CircleAlert size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
      </div>
    </dialog>
  );
}

function TaskSummary({ title, tasks, icon, tone, empty }: { title: string; tasks: Task[]; icon: React.ReactNode; tone: string; empty?: string }) {
  return (
    <section className="rounded-xl border border-border p-3.5">
      <h3 className={`flex items-center gap-1.5 text-sm font-semibold ${tone}`}>
        {icon}
        {title} <span className="font-geist font-medium text-muted">({tasks.length})</span>
      </h3>
      {tasks.length === 0 ? (
        <p className="mt-1.5 text-xs text-muted">{empty}</p>
      ) : (
        <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto pr-1 text-sm">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 break-words">{t.title}</span>
              <TaskStatusBadge status={t.status} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Footer({ children }: { children: React.ReactNode }) {
  return <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{children}</div>;
}

function SecondaryButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-primary-dark hover:bg-pale-green disabled:opacity-60">
      {children}
    </button>
  );
}

function DangerButton({ onClick, pending, children }: { onClick: () => void; pending: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={pending} aria-busy={pending} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-700 px-5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-75">
      {pending && <LoaderCircle size={18} strokeWidth={2} className="animate-spin" aria-hidden="true" />}
      {pending ? "삭제 중…" : children}
    </button>
  );
}
