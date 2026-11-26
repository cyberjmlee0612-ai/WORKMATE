"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CircleAlert, LoaderCircle, Play, Square, Trash2, X } from "lucide-react";
import { TimeSelect } from "@/components/common/TimeSelect";
import { ResolvePlanActions } from "@/components/time/ResolvePlanActions";
import { useTimerControls } from "@/components/time/useTimerControls";
import { ApiError } from "@/lib/api/client";
import { invalidateWorkData } from "@/lib/api/invalidate";
import { createTimePlan, deleteTimePlan, updateTimePlan, type TimePlan } from "@/lib/api/time";
import { toLocalDateString } from "@/lib/date";
import { formatMinutes } from "@/lib/format";
import { fromLocalInputs, toTimeInput } from "@/lib/time";
import { MAX_PLAN_MIN, SNAP_MIN } from "./layout";

type Props =
  | { mode: "edit"; plan: TimePlan; onClose: () => void }
  | { mode: "create"; task: { id: string; title: string }; start: Date; minutes: number; onClose: () => void };

type Errors = Partial<Record<"starts_at" | "ends_at" | "_form", string>>;

/** 계획 블록에서 바로 그 업무의 타이머를 켜고 끈다 (2026-11-26 사용자 요청) */
function PlanTimer({ plan }: { plan: TimePlan }) {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { running, start, stop, pending, dialog } = useTimerControls({ onError: setError, onNotice: setNotice });
  const isRunning = running?.task_id === plan.task_id;
  const closed = plan.task_status === "completed" || plan.task_status === "cancelled";
  if (closed && !isRunning) return dialog;

  return (
    <div className="mt-3 rounded-xl bg-pale-green/60 px-3 py-2.5">
      <button
        type="button"
        onClick={() => (isRunning ? stop() : start(plan.task_id))}
        disabled={pending}
        aria-busy={pending}
        className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:opacity-75 ${isRunning ? "bg-primary-dark text-white" : "bg-primary text-white hover:bg-primary-dark"}`}
      >
        {pending ? <LoaderCircle size={16} strokeWidth={2} className="animate-spin" aria-hidden="true" /> : isRunning ? <Square size={14} strokeWidth={2.5} fill="currentColor" aria-hidden="true" /> : <Play size={16} strokeWidth={2} aria-hidden="true" />}
        {isRunning ? "타이머 멈춤" : running ? "이 업무로 타이머 바꾸기" : "타이머 시작"}
      </button>
      {(error || notice) && <p className={`mt-1.5 text-xs ${error ? "text-red-700" : "text-primary-dark"}`} role={error ? "alert" : "status"}>{error ?? notice}</p>}
      {dialog}
    </div>
  );
}

/**
 * 계획 블록 시각 입력 창. 끌어놓기 대신 키보드·직접 입력으로 배치하거나, 블록을 눌러 시각을 고치고 삭제한다.
 * 열 때마다 새로 마운트해서 사용한다.
 */
export function PlanDialog(props: Props) {
  const { onClose } = props;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const id = useId();
  const queryClient = useQueryClient();
  const title = props.mode === "edit" ? props.plan.task_title : props.task.title;

  const [fields, setFields] = useState(() => {
    const start = props.mode === "edit" ? new Date(props.plan.starts_at) : props.start;
    const end = props.mode === "edit" ? new Date(props.plan.ends_at) : new Date(start.getTime() + props.minutes * 60_000);
    return { date: toLocalDateString(start), start: toTimeInput(start), end: toTimeInput(end) };
  });
  const [errors, setErrors] = useState<Errors>({});
  const [confirming, setConfirming] = useState(false);

  const handleError = (err: unknown) => {
    if (err instanceof ApiError) {
      if (err.status === 404 || err.status === 409) invalidateWorkData(queryClient);
      setErrors(Object.keys(err.fieldErrors).length > 0 ? (err.fieldErrors as Errors) : { _form: err.message });
    } else {
      setErrors({ _form: "저장하지 못했습니다. 다시 시도해 주세요." });
    }
  };

  const save = useMutation({
    mutationFn: (range: { starts_at: string; ends_at: string }) =>
      props.mode === "edit" ? updateTimePlan(props.plan.id, range) : createTimePlan({ task_id: props.task.id, ...range }),
    onSuccess: async () => {
      await invalidateWorkData(queryClient);
      onClose();
    },
    onError: handleError,
  });
  const remove = useMutation({
    mutationFn: async () => {
      if (props.mode !== "edit") return;
      try {
        await deleteTimePlan(props.plan.id);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return;
        throw error;
      }
    },
    onSuccess: async () => {
      await invalidateWorkData(queryClient);
      onClose();
    },
    onError: handleError,
  });
  const pending = save.isPending || remove.isPending;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  function requestClose() {
    if (!pending) onClose();
  }

  // 끝 시각이 시작보다 이르면 자정을 넘긴 계획으로 본다
  const overnight = fields.start !== "" && fields.end !== "" && fields.end < fields.start;
  const start = fromLocalInputs(fields.date, fields.start);
  let end = fromLocalInputs(fields.date, fields.end);
  if (end && overnight) end = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1, end.getHours(), end.getMinutes());
  const minutes = start && end ? Math.round((end.getTime() - start.getTime()) / 60_000) : null;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    const next: Errors = {};
    if (!start) next.starts_at = "날짜와 시작 시각을 입력해 주세요.";
    if (!end) next.ends_at = "끝 시각을 입력해 주세요.";
    else if (minutes !== null && minutes < SNAP_MIN) next.ends_at = "계획은 10분 이상이어야 해요.";
    else if (minutes !== null && minutes > MAX_PLAN_MIN) next.ends_at = "계획 하나는 최대 24시간이에요.";
    setErrors(next);
    if (Object.keys(next).length > 0 || !start || !end) return;
    save.mutate({ starts_at: start.toISOString(), ends_at: end.toISOString() });
  }

  const inputClass = (invalid: boolean) =>
    `mt-1.5 block min-h-11 w-full rounded-xl border bg-surface px-3 text-[15px] text-foreground focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 disabled:opacity-60 ${invalid ? "border-red-400" : "border-border focus:border-primary"}`;

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
      className="surface-card m-auto w-[calc(100%-2rem)] max-w-md rounded-[20px] p-0 text-foreground backdrop:bg-primary-dark/30"
    >
      <form onSubmit={submit} noValidate className="max-h-[85vh] overflow-y-auto p-5 md:p-6">
        <div className="flex items-start justify-between gap-3">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-pale-green text-primary-dark">
            <CalendarClock size={20} strokeWidth={2} aria-hidden="true" />
          </span>
          <button type="button" onClick={requestClose} disabled={pending} className="-mr-2 -mt-1 flex size-11 items-center justify-center rounded-xl text-muted hover:bg-pale-green hover:text-primary-dark" aria-label="닫기">
            <X size={20} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <h2 id={`${id}-title`} className="mt-3 text-lg font-bold text-primary-dark">{props.mode === "edit" ? "계획 수정" : "계획 배치"}</h2>
        <p className="mt-1 break-words text-sm font-medium text-foreground">“{title}”</p>
        {props.mode === "edit" && props.plan.missed && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50/70 px-3 py-2.5">
            <p className="text-sm font-semibold text-red-900">밀린 계획이에요. 어떻게 할까요?</p>
            <p className="text-xs text-red-800">다시 배치하면 이 블록은 &lsquo;놓침&rsquo;으로 남아요.</p>
            <ResolvePlanActions plan={props.plan} onDone={() => onClose()} />
          </div>
        )}
        {props.mode === "edit" && <PlanTimer plan={props.plan} />}

        <fieldset disabled={pending} className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block w-full text-sm font-medium">
            날짜
            <input type="date" value={fields.date} onChange={(e) => setFields((f) => ({ ...f, date: e.target.value }))} className={inputClass(Boolean(errors.starts_at))} />
          </label>
          {/* 브라우저 기본 시각 칸 대신 시·분(10분 단위) 선택 (12시 선택 문제, 2026-11-26) */}
          <div className="block text-sm font-medium">
            시작
            <TimeSelect label="시작" value={fields.start} onChange={(v) => setFields((f) => ({ ...f, start: v }))} invalid={Boolean(errors.starts_at)} className="mt-1.5" />
          </div>
          <div className="block text-sm font-medium">
            끝
            <TimeSelect label="끝" value={fields.end} onChange={(v) => setFields((f) => ({ ...f, end: v }))} invalid={Boolean(errors.ends_at)} className="mt-1.5" />
          </div>
        </fieldset>
        <div className="mt-1.5 space-y-1 text-xs">
          {errors.starts_at && <p className="text-red-700" role="alert">{errors.starts_at}</p>}
          {errors.ends_at && <p className="text-red-700" role="alert">{errors.ends_at}</p>}
          {!errors.ends_at && minutes !== null && minutes > 0 && (
            <p className="text-muted">{overnight ? "다음 날까지 · " : ""}{formatMinutes(minutes)}</p>
          )}
        </div>

        {errors._form && (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800" role="alert">
            <CircleAlert size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
            {errors._form}
          </p>
        )}

        {confirming ? (
          <div className="mt-5 flex flex-wrap items-center justify-end gap-2 rounded-xl bg-red-50 px-3 py-2" role="group" aria-label="계획 삭제 확인">
            <span className="mr-auto text-sm text-red-800">이 계획을 삭제할까요? 업무와 실제 기록은 그대로예요.</span>
            <button type="button" autoFocus onClick={() => setConfirming(false)} disabled={pending} className="min-h-11 rounded-xl border border-border bg-surface px-3 text-sm font-semibold text-primary-dark">취소</button>
            <button type="button" onClick={() => !pending && remove.mutate()} disabled={pending} aria-busy={remove.isPending} className="flex min-h-11 items-center gap-1.5 rounded-xl bg-red-700 px-3 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-75">
              {remove.isPending && <LoaderCircle size={16} strokeWidth={2} className="animate-spin" aria-hidden="true" />}
              삭제
            </button>
          </div>
        ) : (
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
            {props.mode === "edit" && (
              <button type="button" onClick={() => setConfirming(true)} disabled={pending} className="flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 sm:mr-auto">
                <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
                계획 삭제
              </button>
            )}
            <button type="button" onClick={requestClose} disabled={pending} className="min-h-11 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-primary-dark hover:bg-pale-green disabled:opacity-60 sm:ml-auto">
              취소
            </button>
            <button type="submit" disabled={pending} aria-busy={save.isPending} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-75">
              {save.isPending && <LoaderCircle size={18} strokeWidth={2} className="animate-spin" aria-hidden="true" />}
              {save.isPending ? "저장 중…" : "저장"}
            </button>
          </div>
        )}
      </form>
    </dialog>
  );
}
