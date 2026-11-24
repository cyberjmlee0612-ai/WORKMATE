"use client";

import { useEffect, useId, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, LoaderCircle, Trash2 } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { projectKeys } from "@/lib/api/projects";
import { deleteTask, taskKeys, type Task } from "@/lib/api/tasks";

/** 열 때마다 새로 마운트해서 사용한다: `{target && <DeleteTaskDialog task={target} … />}` */
export function DeleteTaskDialog({ task, onClose }: { task: Task; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const id = useId();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      try {
        await deleteTask(task.id);
      } catch (error) {
        // 이미 삭제된 업무(다른 탭 등)면 결과가 같으므로 성공으로 처리
        if (error instanceof ApiError && error.status === 404) return;
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
      queryClient.invalidateQueries({ queryKey: projectKeys.all });
      onClose();
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
      aria-describedby={`${id}-desc`}
      className="surface-card m-auto w-[calc(100%-2rem)] max-w-md rounded-[20px] p-5 text-foreground backdrop:bg-primary-dark/30 md:p-6"
    >
      <span className="flex size-11 items-center justify-center rounded-2xl bg-red-50 text-red-700">
        <Trash2 size={20} strokeWidth={2} aria-hidden="true" />
      </span>
      <h2 id={`${id}-title`} className="mt-4 text-lg font-bold text-primary-dark">업무를 삭제할까요?</h2>
      <p id={`${id}-desc`} className="mt-2 text-sm leading-6 text-muted">
        <strong className="break-words font-semibold text-foreground">“{task.title}”</strong> 업무를 삭제합니다. 삭제한 업무는 되돌릴 수 없습니다.
      </p>

      {mutation.isError && (
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800" role="alert">
          <CircleAlert size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
          {mutation.error instanceof ApiError ? mutation.error.message : "삭제하지 못했습니다. 잠시 후 다시 시도해 주세요."}
        </p>
      )}

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {/* 실수로 Enter를 눌러도 삭제되지 않도록 취소에 먼저 포커스 */}
        <button type="button" autoFocus onClick={requestClose} disabled={pending} className="min-h-11 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-primary-dark hover:bg-pale-green disabled:opacity-60">취소</button>
        <button type="button" onClick={() => !pending && mutation.mutate()} disabled={pending} aria-busy={pending} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-700 px-5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-75">
          {pending && <LoaderCircle size={18} strokeWidth={2} className="animate-spin" aria-hidden="true" />}
          {pending ? "삭제 중…" : "삭제"}
        </button>
      </div>
    </dialog>
  );
}
