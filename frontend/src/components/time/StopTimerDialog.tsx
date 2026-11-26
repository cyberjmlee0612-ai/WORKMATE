"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, LoaderCircle, Square } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { invalidateWorkData } from "@/lib/api/invalidate";
import { MAX_ENTRY_MS, conflictCode, stopTimer, type TimeEntry, type TimerStopResult } from "@/lib/api/time";
import { toLocalDateString } from "@/lib/date";
import { formatClock, formatDay, fromLocalInputs, toTimeInput } from "@/lib/time";

type Props = {
  entry: TimeEntry;
  /** 서버 시각 - 브라우저 시각 */
  offset: number;
  onClose: () => void;
  onStopped?: (result: TimerStopResult) => void;
};

/**
 * 오래 켜 둔 타이머(12시간 이상)를 멈출 때 실제로 끝난 시각을 확인받는다 (2026-11-26 사용자 확정).
 * 기본값은 지금 시각(24시간을 넘으면 시작 후 24시간). 열 때마다 새로 마운트해서 사용한다.
 */
export function StopTimerDialog({ entry, offset, onClose, onStopped }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const id = useId();
  const queryClient = useQueryClient();

  const [initial] = useState(() => {
    const started = Date.parse(entry.started_at);
    const end = new Date(Math.min(Date.now() + offset, started + MAX_ENTRY_MS));
    return { date: toLocalDateString(end), time: toTimeInput(end) };
  });
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (endedAt: string) => stopTimer(endedAt),
    onSuccess: (result) => {
      invalidateWorkData(queryClient);
      onStopped?.(result);
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && conflictCode(err.body) === "no_running_timer") {
        invalidateWorkData(queryClient);
        onClose();
        return;
      }
      setError(err instanceof ApiError ? (err.fieldErrors.ended_at ?? err.message) : "멈추지 못했습니다. 다시 시도해 주세요.");
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

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    const end = fromLocalInputs(date, time);
    if (!end) {
      setError("끝난 날짜와 시각을 입력해 주세요.");
      return;
    }
    if (end.getTime() <= Date.parse(entry.started_at)) {
      setError("끝난 시각은 시작 시각보다 늦어야 해요.");
      return;
    }
    setError(null);
    mutation.mutate(end.toISOString());
  }

  const inputClass = `mt-1.5 block min-h-11 w-full rounded-xl border bg-surface px-3.5 text-[15px] text-foreground focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 ${error ? "border-red-400" : "border-border focus:border-primary"}`;

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
      <form onSubmit={submit} noValidate>
        <span className="flex size-11 items-center justify-center rounded-2xl bg-pale-green text-primary-dark">
          <Square size={18} strokeWidth={2} aria-hidden="true" />
        </span>
        <h2 id={`${id}-title`} className="mt-4 text-lg font-bold text-primary-dark">언제 끝났나요?</h2>
        <p className="mt-1 break-words text-sm font-medium text-foreground">“{entry.task_title}”</p>
        <p id={`${id}-desc`} className="mt-3 text-sm leading-6 text-muted">
          타이머가 12시간 넘게 켜져 있었어요. 실제로 일을 마친 시각을 입력하면 그때까지만 기록해요.
          <br />
          시작: {formatDay(entry.started_at)} {formatClock(entry.started_at)}
        </p>

        <fieldset disabled={pending} className="mt-4 grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium">
            끝난 날짜
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} aria-invalid={Boolean(error) || undefined} />
          </label>
          <label className="block text-sm font-medium">
            끝난 시각
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputClass} aria-invalid={Boolean(error) || undefined} />
          </label>
        </fieldset>

        {error && (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800" role="alert">
            <CircleAlert size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={requestClose} disabled={pending} className="min-h-11 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-primary-dark hover:bg-pale-green disabled:opacity-60">
            취소
          </button>
          <button type="submit" disabled={pending} aria-busy={pending} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-75">
            {pending && <LoaderCircle size={18} strokeWidth={2} className="animate-spin" aria-hidden="true" />}
            {pending ? "멈추는 중…" : "이 시각으로 멈추기"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
