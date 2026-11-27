"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, LoaderCircle, Repeat, Trash2 } from "lucide-react";
import { TimeSelect } from "@/components/common/TimeSelect";
import { EstimateHint } from "@/components/tasks/EstimateHint";
import { ApiError } from "@/lib/api/client";
import { invalidateWorkData } from "@/lib/api/invalidate";
import { listProjects, projectKeys } from "@/lib/api/projects";
import {
  ROUTINE_TITLE_MAX, createRoutine, deleteRoutine, materializeRoutines, routineKeys, ruleLabel, updateRoutine,
  type Routine, type RoutineFreq, type RoutineInput, type RoutineMode,
} from "@/lib/api/routines";
import { WEEKDAY_LABELS } from "@/lib/api/schedule";
import { TASK_PRIORITIES, TASK_PRIORITY_LABEL, type TaskPriority } from "@/lib/api/tasks";
import { userTimeZone } from "@/lib/date";
import { activeProjectOptions } from "@/lib/projectTree";

const field = (invalid = false) =>
  `mt-1.5 block min-h-11 w-full rounded-xl border bg-surface px-3.5 text-[15px] text-foreground focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 disabled:opacity-60 ${invalid ? "border-red-400" : "border-border focus:border-primary"}`;

const FREQS: { value: RoutineFreq; label: string }[] = [
  { value: "daily", label: "매일" },
  { value: "weekly", label: "요일마다" },
  { value: "monthly", label: "매월" },
  { value: "interval", label: "며칠마다" },
];

/** 반복 만들기·고치기 (열 때마다 새로 마운트). today: 기본 시작일 */
export function RoutineFormDialog({ routine, today, defaultMode = "task", onClose }: { routine?: Routine; today: string; defaultMode?: RoutineMode; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const id = useId();
  const queryClient = useQueryClient();
  const [tz] = useState(userTimeZone);

  const [f, setF] = useState<RoutineInput>(() =>
    routine
      ? {
          title: routine.title, mode: routine.mode, project_id: routine.project_id, priority: routine.priority, estimated_minutes: routine.estimated_minutes,
          freq: routine.freq, weekdays: routine.weekdays, every_weeks: routine.every_weeks, month_day: routine.month_day, interval_days: routine.interval_days,
          start_date: routine.start_date, start_time: routine.start_time, end_time: routine.end_time, active: routine.active,
        }
      : {
          title: "", mode: defaultMode, project_id: null, priority: "medium", estimated_minutes: null, freq: "daily", weekdays: [1, 2, 3, 4, 5],
          every_weeks: 1, month_day: Number(today.slice(8, 10)), interval_days: 2, start_date: today, start_time: null, end_time: null, active: true,
        },
  );
  const [minutesText, setMinutesText] = useState(routine?.estimated_minutes ? String(routine.estimated_minutes) : "");
  const [localError, setLocalError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (patch: Partial<RoutineInput>) => setF((cur) => ({ ...cur, ...patch }));

  const projectsQuery = useQuery({ queryKey: projectKeys.list(), queryFn: listProjects, enabled: f.mode === "task" });
  const options = activeProjectOptions(projectsQuery.data ?? []);
  if (routine?.project_id && !options.some((o) => o.id === routine.project_id)) options.unshift({ id: routine.project_id, label: routine.project_path ?? "현재 프로젝트" });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const done = () => {
    queryClient.invalidateQueries({ queryKey: routineKeys.all });
    // 오늘 반복하는 업무를 새로 만들었으면 오늘 업무도 바로 생기게 (서버가 중복 없이 처리)
    materializeRoutines(tz)
      .then((r) => (r.created > 0 || r.skipped > 0 ? invalidateWorkData(queryClient) : undefined))
      .catch(() => undefined);
    onClose();
  };
  const save = useMutation({ mutationFn: (input: RoutineInput) => (routine ? updateRoutine(routine.id, input, tz) : createRoutine(input, tz)), onSuccess: done });
  const remove = useMutation({ mutationFn: () => deleteRoutine(routine!.id), onSuccess: done });
  const pending = save.isPending || remove.isPending;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const minutes = minutesText.trim() ? Number(minutesText.trim()) : null;
    if (!f.title.trim()) return setLocalError("이름을 입력해 주세요.");
    if (f.freq === "weekly" && f.weekdays.length === 0) return setLocalError("반복할 요일을 하나 이상 골라 주세요.");
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440)) return setLocalError("예상 시간은 1~1440분으로 입력해 주세요.");
    if (f.start_time && f.end_time && f.end_time <= f.start_time) return setLocalError("끝 시각은 시작보다 늦어야 해요.");
    setLocalError(null);
    save.mutate({ ...f, title: f.title.trim(), estimated_minutes: f.mode === "task" ? minutes : null });
  }

  const serverError = save.error instanceof ApiError ? Object.values(save.error.fieldErrors)[0] ?? save.error.message : save.isError ? "저장하지 못했어요." : null;
  const error = localError ?? serverError ?? (remove.isError ? remove.error.message : null);
  const requestClose = () => !pending && onClose();
  const chip = (on: boolean) => `min-h-10 rounded-lg border px-3 text-sm font-semibold ${on ? "border-primary bg-pale-green text-primary-dark" : "border-border text-muted hover:bg-pale-green/40"}`;

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        requestClose();
      }}
      onClick={(e) => e.target === dialogRef.current && requestClose()}
      aria-labelledby={`${id}-title`}
      className="surface-card m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-[20px] p-5 text-foreground backdrop:bg-primary-dark/30 md:p-6"
    >
      <form onSubmit={submit} noValidate>
        <h2 id={`${id}-title`} className="flex items-center gap-2 text-lg font-bold text-primary-dark">
          <Repeat size={20} strokeWidth={2} aria-hidden="true" />
          {routine ? "반복 고치기" : "반복 만들기"}
        </h2>

        <fieldset disabled={pending}>
          <div className="mt-4 grid grid-cols-2 gap-2" role="radiogroup" aria-label="종류">
            {([["task", "반복 업무", "그날 업무로 만들어 타이머·체크인·리포트에 들어가요"], ["habit", "습관", "체크만 하고 연속 기록을 쌓아요"]] as const).map(([value, label, hint]) => (
              <button key={value} type="button" role="radio" aria-checked={f.mode === value} onClick={() => set({ mode: value })} className={`rounded-xl border p-3 text-left ${f.mode === value ? "border-primary bg-pale-green" : "border-border hover:bg-pale-green/40"}`}>
                <span className="block text-sm font-bold text-primary-dark">{label}</span>
                <span className="mt-0.5 block text-xs text-muted">{hint}</span>
              </button>
            ))}
          </div>

          <label className="mt-4 block text-sm font-medium">
            이름
            <input value={f.title} onChange={(e) => set({ title: e.target.value })} maxLength={ROUTINE_TITLE_MAX} placeholder={f.mode === "task" ? "예: 주간 보고서 쓰기" : "예: 스트레칭 10분"} autoFocus className={field(Boolean(localError) && !f.title.trim())} />
          </label>

          <p className="mt-4 text-sm font-medium">반복</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label="반복 규칙">
            {FREQS.map((x) => (
              <button key={x.value} type="button" role="radio" aria-checked={f.freq === x.value} onClick={() => set({ freq: x.value })} className={chip(f.freq === x.value)}>{x.label}</button>
            ))}
          </div>
          {f.freq === "weekly" && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {WEEKDAY_LABELS.map((label, day) => {
                const on = f.weekdays.includes(day);
                return (
                  <button key={day} type="button" aria-pressed={on} onClick={() => set({ weekdays: on ? f.weekdays.filter((d) => d !== day) : [...f.weekdays, day].sort() })} className={`size-10 rounded-lg text-sm font-semibold ${on ? "bg-primary text-white" : "border border-border text-muted hover:bg-pale-green"}`}>
                    {label}
                  </button>
                );
              })}
              <select value={f.every_weeks} onChange={(e) => set({ every_weeks: Number(e.target.value) })} aria-label="몇 주마다" className="ml-1 min-h-10 rounded-lg border border-border bg-surface px-2 text-sm">
                <option value={1}>매주</option>
                <option value={2}>격주</option>
                <option value={3}>3주마다</option>
                <option value={4}>4주마다</option>
              </select>
            </div>
          )}
          {f.freq === "monthly" && (
            <label className="mt-2 flex items-center gap-2 text-sm">
              매월
              <select value={f.month_day ?? 1} onChange={(e) => set({ month_day: Number(e.target.value) })} className="min-h-10 rounded-lg border border-border bg-surface px-2">
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d === 31 ? "말일" : `${d}일`}</option>)}
              </select>
              {f.month_day && f.month_day > 28 && f.month_day < 31 && <span className="text-xs text-muted">그날이 없는 달은 말일에</span>}
            </label>
          )}
          {f.freq === "interval" && (
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="number" min={2} max={365} value={f.interval_days ?? 2} onChange={(e) => set({ interval_days: Math.max(2, Math.min(365, Number(e.target.value) || 2)) })} className="min-h-10 w-20 rounded-lg border border-border bg-surface px-2" />
              일마다 (시작일부터)
            </label>
          )}
          <label className="mt-3 block text-sm font-medium">
            시작일
            <input type="date" value={f.start_date} onChange={(e) => set({ start_date: e.target.value })} className={field()} />
          </label>
          <p className="mt-1.5 text-xs text-muted">미리보기: {ruleLabel(f)}{f.start_time ? ` ${f.start_time}–${f.end_time}` : ""}</p>

          <div className="mt-4 rounded-xl border border-border p-3">
            <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={f.start_time !== null} onChange={(e) => set(e.target.checked ? { start_time: "07:00", end_time: "07:30" } : { start_time: null, end_time: null })} className="size-4 accent-[var(--color-primary)]" />
              정해진 시간이 있어요 {f.mode === "task" && <span className="text-xs font-normal text-muted">(시간표에 계획도 함께 만들어 알림·타이머가 바로 동작)</span>}
            </label>
            {f.start_time !== null && (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <TimeSelect label="시작" value={f.start_time} onChange={(v) => set({ start_time: v })} />
                <span className="text-muted" aria-hidden="true">–</span>
                <TimeSelect label="끝" value={f.end_time ?? "07:30"} onChange={(v) => set({ end_time: v })} invalid={Boolean(f.end_time && f.end_time <= f.start_time)} />
              </div>
            )}
          </div>

          {f.mode === "task" && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium">
                프로젝트 <span className="font-normal text-muted">(선택)</span>
                <select value={f.project_id ?? ""} onChange={(e) => set({ project_id: e.target.value || null })} className={field()}>
                  <option value="">개인 업무</option>
                  {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium">
                우선순위
                <select value={f.priority} onChange={(e) => set({ priority: e.target.value as TaskPriority })} className={field()}>
                  {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{TASK_PRIORITY_LABEL[p]}</option>)}
                </select>
              </label>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium">
                  예상 시간 (분) <span className="font-normal text-muted">(선택)</span>
                  <input inputMode="numeric" value={minutesText} onChange={(e) => setMinutesText(e.target.value.replace(/[^0-9]/g, ""))} placeholder="예: 30" className={field()} />
                </label>
                <EstimateHint value={minutesText} onApply={(m) => setMinutesText(String(m))} />
              </div>
            </div>
          )}

          {routine && (
            <label className="mt-4 flex min-h-11 items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={!f.active} onChange={(e) => set({ active: !e.target.checked })} className="size-4 accent-[var(--color-primary)]" />
              잠시 멈추기 <span className="text-xs font-normal text-muted">(다시 켤 때까지 만들지 않아요)</span>
            </label>
          )}
        </fieldset>

        {error && (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800" role="alert">
            <CircleAlert size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
        {routine && <p className="mt-3 text-xs text-muted">규칙을 바꾸거나 지워도 이미 만든 업무는 그대로 남아요.</p>}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {routine && (confirmDelete ? (
            <button type="button" onClick={() => remove.mutate()} disabled={pending} className="flex min-h-11 items-center gap-1.5 rounded-xl bg-red-700 px-3.5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60">
              {remove.isPending ? <LoaderCircle size={16} strokeWidth={2} className="animate-spin" aria-hidden="true" /> : <Trash2 size={16} strokeWidth={2} aria-hidden="true" />}
              정말 삭제
            </button>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} disabled={pending} className="flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-red-700 hover:bg-red-50">
              <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
              삭제
            </button>
          ))}
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={requestClose} disabled={pending} className="min-h-11 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-primary-dark hover:bg-pale-green disabled:opacity-60">취소</button>
            <button type="submit" disabled={pending} aria-busy={save.isPending} className="flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-60">
              {save.isPending && <LoaderCircle size={16} strokeWidth={2} className="animate-spin" aria-hidden="true" />}
              저장
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
