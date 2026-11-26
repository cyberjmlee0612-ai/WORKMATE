"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, Trash2, X } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { invalidateWorkData } from "@/lib/api/invalidate";
import { deleteTimeEntry, type TimeEntry } from "@/lib/api/time";
import { EntryForm } from "@/components/time/TimeEntriesDialog";

/** 시간표에서 실제 기록 블록을 눌렀을 때: 기록 수정·삭제. 열 때마다 새로 마운트한다. */
export function EntryEditDialog({ entry, onClose }: { entry: TimeEntry; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const id = useId();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const remove = useMutation({
    mutationFn: async () => {
      try {
        await deleteTimeEntry(entry.id);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return;
        throw error;
      }
    },
    onSuccess: async () => {
      await invalidateWorkData(queryClient);
      onClose();
    },
  });
  const locked = busy || remove.isPending;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  function requestClose() {
    if (!locked) onClose();
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
      className="surface-card m-auto w-[calc(100%-2rem)] max-w-lg rounded-[20px] p-0 text-foreground backdrop:bg-primary-dark/30"
    >
      <div className="max-h-[85vh] overflow-y-auto p-5 md:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={`${id}-title`} className="text-xl font-bold text-primary-dark">실제 기록</h2>
            <p className="mt-1 break-words text-sm font-medium text-foreground">“{entry.task_title}”</p>
            <p className="text-xs text-muted">{entry.project_name ?? "개인 업무"} · {entry.source === "timer" ? "타이머 기록" : "직접 입력"}</p>
          </div>
          <button type="button" onClick={requestClose} disabled={locked} className="-mr-2 -mt-1 flex size-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-pale-green hover:text-primary-dark" aria-label="닫기">
            <X size={20} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        <EntryForm taskId={entry.task_id} entry={entry} onBusy={setBusy} onDone={onClose} />

        <div className="mt-4 border-t border-border pt-4">
          {confirming ? (
            <div className="flex flex-wrap items-center justify-end gap-2 rounded-xl bg-red-50 px-3 py-2" role="group" aria-label="기록 삭제 확인">
              <span className="mr-auto text-sm text-red-800">{entry.ended_at ? "이 기록을 삭제할까요?" : "진행 중인 타이머를 기록 없이 삭제할까요?"}</span>
              <button type="button" autoFocus onClick={() => setConfirming(false)} disabled={remove.isPending} className="min-h-11 rounded-xl border border-border bg-surface px-3 text-sm font-semibold text-primary-dark">취소</button>
              <button type="button" onClick={() => !remove.isPending && remove.mutate()} disabled={remove.isPending} aria-busy={remove.isPending} className="flex min-h-11 items-center gap-1.5 rounded-xl bg-red-700 px-3 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-75">
                {remove.isPending && <LoaderCircle size={16} strokeWidth={2} className="animate-spin" aria-hidden="true" />}
                삭제
              </button>
              {remove.isError && <p className="w-full text-xs text-red-700" role="alert">삭제하지 못했습니다. 다시 시도해 주세요.</p>}
            </div>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} disabled={busy} className="flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">
              <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
              기록 삭제
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
