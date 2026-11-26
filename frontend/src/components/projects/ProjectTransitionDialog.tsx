"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, CircleAlert, CircleCheck, Info, LoaderCircle, RotateCcw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { invalidateWorkData } from "@/lib/api/invalidate";
import {
  archiveProject, completeProject, isOpenTasksChanged, openTaskCount, projectKeys, restoreProject,
  type Project, type ProjectAction,
} from "@/lib/api/projects";

type Props = { project: Project; action: ProjectAction; onClose: () => void };

const COPY: Record<ProjectAction, { title: string; button: string; pending: string; icon: LucideIcon }> = {
  complete: { title: "프로젝트를 완료할까요?", button: "완료하기", pending: "완료하는 중…", icon: CircleCheck },
  archive: { title: "프로젝트를 보관할까요?", button: "보관하기", pending: "보관하는 중…", icon: Archive },
  restore: { title: "프로젝트를 다시 열까요?", button: "다시 열기", pending: "여는 중…", icon: RotateCcw },
};

/**
 * 완료·보관·복원 확인 창. 업무 데이터는 바뀌지 않고, 모든 변경은 상태 이력에 남는다.
 * 열 때마다 새로 마운트해서 사용한다.
 */
export function ProjectTransitionDialog({ project, action, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const id = useId();
  const queryClient = useQueryClient();
  const copy = COPY[action];

  // 완료: 사용자에게 보여준 미완료 업무 수. 서버 값과 다르면 409로 받은 최신 수로 다시 확인한다.
  const [openTasks, setOpenTasks] = useState(() => openTaskCount(project));
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      action === "complete" ? completeProject(project.id, openTasks) : action === "archive" ? archiveProject(project.id) : restoreProject(project.id),
    onSuccess: (saved) => {
      queryClient.setQueryData(projectKeys.detail(saved.id), saved);
      invalidateWorkData(queryClient); // 목록·대시보드·이력 갱신
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409 && isOpenTasksChanged(err.body)) {
        setOpenTasks(err.body.open_tasks);
        setNotice(err.body.detail);
        invalidateWorkData(queryClient);
        return;
      }
      if (err instanceof ApiError && (err.status === 409 || err.status === 404)) {
        // 다른 탭에서 이미 상태가 바뀌었거나 삭제됨 → 화면을 최신으로
        invalidateWorkData(queryClient);
      }
      setError(err instanceof ApiError ? err.message : "처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
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

  let description: React.ReactNode;
  if (action === "complete") {
    description =
      openTasks > 0 ? (
        <>
          아직 끝나지 않은 업무가 <strong className="font-semibold text-red-800">{openTasks}개</strong> 남아 있어요.
          완료해도 업무는 그대로 남고, 완료 당시 미완료 업무 수가 기록돼요.
        </>
      ) : (
        <>모든 업무를 마쳤어요. 완료한 프로젝트는 진행 목록에서 ‘완료’ 구역으로 옮겨져요.</>
      );
  } else if (action === "archive") {
    description = (
      <>
        보관하면 진행 목록과 대시보드에서 빠지고 ‘보관함’으로 옮겨져요. 업무와 기록은 그대로 남고 언제든 다시 열 수 있어요.
        {project.subproject_count > 0 && <> 하위 프로젝트도 함께 보관되고, 다시 열면 함께 돌아와요.</>}
      </>
    );
  } else {
    description =
      project.status === "archived" ? (
        <>보관하기 직전 상태로 되돌아가요. 완료한 뒤 보관했다면 ‘완료’ 상태로 돌아가요.</>
      ) : (
        <>완료하기 직전 상태로 되돌아가 다시 진행할 수 있어요.</>
      );
  }

  const Icon = copy.icon;

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
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-desc`}
      className="surface-card m-auto w-[calc(100%-2rem)] max-w-md rounded-[20px] p-5 text-foreground backdrop:bg-primary-dark/30 md:p-6"
    >
      <span className="flex size-11 items-center justify-center rounded-2xl bg-pale-green text-primary-dark">
        <Icon size={20} strokeWidth={2} aria-hidden="true" />
      </span>
      <h2 id={`${id}-title`} className="mt-4 text-lg font-bold text-primary-dark">{copy.title}</h2>
      <p className="mt-1 break-words text-sm font-medium text-foreground">“{project.name}”</p>

      {notice && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-soft-sage bg-pale-green/60 px-3.5 py-3 text-sm text-primary-dark" role="status">
          <Info size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
          {notice}
        </p>
      )}

      <p id={`${id}-desc`} className="mt-3 text-sm leading-6 text-muted">{description}</p>

      {error && (
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800" role="alert">
          <CircleAlert size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" autoFocus onClick={requestClose} disabled={pending} className="min-h-11 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-primary-dark hover:bg-pale-green disabled:opacity-60">
          취소
        </button>
        <button
          type="button"
          onClick={() => !pending && (setError(null), mutation.mutate())}
          disabled={pending}
          aria-busy={pending}
          className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-75"
        >
          {pending && <LoaderCircle size={18} strokeWidth={2} className="animate-spin" aria-hidden="true" />}
          {pending ? copy.pending : copy.button}
        </button>
      </div>
    </dialog>
  );
}
