"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, CircleAlert, LoaderCircle } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { invalidateWorkData } from "@/lib/api/invalidate";
import { CANCEL_REASON_MAX, updateTask, type Task } from "@/lib/api/tasks";

/**
 * 업무 제외 확인. 삭제와 달리 기록이 남고 언제든 상태를 골라 되돌릴 수 있다.
 * 열 때마다 새로 마운트해서 사용한다: `{target && <CancelTaskDialog task={target} … />}`
 */
export function CancelTaskDialog({ task, onClose }: { task: Task; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const id = useId();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => updateTask(task.id, { status: "cancelled", cancel_reason: reason.trim() || null }),
    onSuccess: () => {
      invalidateWorkData(queryClient);
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 404) {
        invalidateWorkData(queryClient);
        setError("이미 삭제된 업무입니다.");
      } else if (err instanceof ApiError) {
        setError(err.fieldErrors.cancel_reason ?? err.message);
      } else {
        setError("제외하지 못했습니다. 잠시 후 다시 시도해 주세요.");
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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (reason.trim().length > CANCEL_REASON_MAX) {
      setError(`제외 사유는 ${CANCEL_REASON_MAX}자 이하로 입력해 주세요.`);
      return;
    }
    mutation.mutate();
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
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-desc`}
      className="surface-card m-auto w-[calc(100%-2rem)] max-w-md rounded-[20px] p-0 text-foreground backdrop:bg-primary-dark/30"
    >
      <form onSubmit={handleSubmit} noValidate className="p-5 md:p-6">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-background text-muted">
          <Ban size={20} strokeWidth={2} aria-hidden="true" />
        </span>
        <h2 id={`${id}-title`} className="mt-4 text-lg font-bold text-primary-dark">업무에서 제외할까요?</h2>
        <p id={`${id}-desc`} className="mt-2 text-sm leading-6 text-muted">
          <strong className="break-words font-semibold text-foreground">“{task.title}”</strong>을(를) 삭제하지 않고 보관합니다.
          진행률과 오늘의 업무에서는 빠지고, 업무 관리의 ‘제외됨’ 필터에서 다시 볼 수 있어요.
        </p>

        <label className="mt-5 block text-sm font-medium">
          제외 사유 <span className="font-normal text-muted">(선택)</span>
          <textarea
            autoFocus
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setError(null);
            }}
            disabled={pending}
            rows={3}
            placeholder="예: 범위에서 빠짐, 다른 업무로 대체됨"
            aria-invalid={Boolean(error) || undefined}
            className="mt-1.5 block w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-[15px] leading-6 focus:border-primary focus:outline-none disabled:opacity-60"
          />
          <span className="mt-1 block text-right text-xs text-muted">{reason.trim().length}/{CANCEL_REASON_MAX}</span>
        </label>

        {error && (
          <p className="mt-2 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800" role="alert">
            <CircleAlert size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={requestClose} disabled={pending} className="min-h-11 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-primary-dark hover:bg-pale-green disabled:opacity-60">취소</button>
          <button type="submit" disabled={pending} aria-busy={pending} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary-dark px-5 text-sm font-semibold text-white hover:bg-primary disabled:opacity-75">
            {pending && <LoaderCircle size={18} strokeWidth={2} className="animate-spin" aria-hidden="true" />}
            {pending ? "제외 중…" : "업무에서 제외"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
