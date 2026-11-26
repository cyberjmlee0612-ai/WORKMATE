"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarHeart, CircleAlert, LoaderCircle, Trash2 } from "lucide-react";
import { TimeSelect } from "@/components/common/TimeSelect";
import { ApiError } from "@/lib/api/client";
import { dashboardKeys } from "@/lib/api/dashboard";
import {
  EVENT_KINDS, EVENT_NOTE_MAX, EVENT_TITLE_MAX, createEvent, deleteEvent, eventKeys, updateEvent,
  type EventInput, type EventKind, type WorkEvent,
} from "@/lib/api/events";
import { listProjects, projectKeys } from "@/lib/api/projects";
import { activeProjectOptions } from "@/lib/projectTree";

type Props =
  | { mode: "create"; date: string; projectId?: string | null; onClose: () => void }
  | { mode: "edit"; event: WorkEvent; onClose: () => void };

const field = (invalid = false) =>
  `mt-1.5 block min-h-11 w-full rounded-xl border bg-surface px-3.5 text-[15px] text-foreground focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 disabled:opacity-60 ${invalid ? "border-red-400" : "border-border focus:border-primary"}`;

/**
 * 이벤트 날짜 만들기·고치기·삭제 (2026-11-26 사용자 요청: 시험·출품·발표 날짜).
 * 열 때마다 새로 마운트해서 쓴다.
 */
export function EventDialog(props: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const id = useId();
  const queryClient = useQueryClient();
  const editing = props.mode === "edit" ? props.event : null;

  const [title, setTitle] = useState(editing?.title ?? "");
  const [kind, setKind] = useState<EventKind>(editing?.kind ?? "exam");
  const [date, setDate] = useState(editing?.event_date ?? (props.mode === "create" ? props.date : ""));
  const [allDay, setAllDay] = useState(!editing?.start_time);
  const [start, setStart] = useState(editing?.start_time ?? "09:00");
  const [end, setEnd] = useState(editing?.end_time ?? "");
  const [projectId, setProjectId] = useState<string>(editing?.project_id ?? (props.mode === "create" ? props.projectId ?? "" : ""));
  const [note, setNote] = useState(editing?.note ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const projectsQuery = useQuery({ queryKey: projectKeys.list(), queryFn: listProjects });
  const options = activeProjectOptions(projectsQuery.data ?? []);
  // 완료·보관한 프로젝트에 달린 이벤트를 고칠 때도 지금 프로젝트가 보이게
  if (editing?.project_id && !options.some((o) => o.id === editing.project_id)) {
    options.unshift({ id: editing.project_id, label: editing.project_path ?? "현재 프로젝트" });
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const done = () => {
    queryClient.invalidateQueries({ queryKey: eventKeys.all });
    queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    props.onClose();
  };
  const save = useMutation({
    mutationFn: (input: EventInput) => (editing ? updateEvent(editing.id, input) : createEvent(input)),
    onSuccess: done,
  });
  const remove = useMutation({
    mutationFn: async () => {
      try {
        await deleteEvent(editing!.id);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return; // 이미 지워짐
        throw error;
      }
    },
    onSuccess: done,
  });
  const pending = save.isPending || remove.isPending;
  const fieldErrors = save.error instanceof ApiError ? save.error.fieldErrors : {};

  function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (!title.trim()) return setLocalError("이름을 입력해 주세요.");
    if (!date) return setLocalError("날짜를 골라 주세요.");
    if (!allDay && end && end <= start) return setLocalError("끝 시각은 시작보다 늦어야 해요.");
    setLocalError(null);
    save.mutate({
      title: title.trim(),
      kind,
      event_date: date,
      start_time: allDay ? null : start,
      end_time: allDay || !end ? null : end,
      project_id: projectId || null,
      note: note.trim() || null,
    });
  }

  const requestClose = () => {
    if (!pending) props.onClose();
  };
  const serverError = save.isError ? Object.values(fieldErrors)[0] ?? save.error.message : remove.isError ? remove.error.message : null;
  const error = localError ?? serverError;

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        requestClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) requestClose();
      }}
      aria-labelledby={`${id}-title`}
      className="surface-card m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-[20px] p-5 text-foreground backdrop:bg-primary-dark/30 md:p-6"
    >
      <form onSubmit={submit} noValidate>
        <h2 id={`${id}-title`} className="flex items-center gap-2 text-lg font-bold text-primary-dark">
          <CalendarHeart size={20} strokeWidth={2} aria-hidden="true" />
          {editing ? "이벤트 고치기" : "이벤트 추가"}
        </h2>
        <p className="mt-1 text-sm text-muted">시험·발표·출품처럼 날짜가 중요한 일을 기록해요. 캘린더와 대시보드에 D-day로 보여요.</p>

        <fieldset disabled={pending}>
          <label className="mt-4 block text-sm font-medium">
            이름
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={EVENT_TITLE_MAX} placeholder="예: 정보처리기사 실기" autoFocus className={field(Boolean(localError && !title.trim()) || Boolean(fieldErrors.title))} />
          </label>

          <p className="mt-3 text-sm font-medium">종류</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label="종류">
            {EVENT_KINDS.map((k) => (
              <button key={k.value} type="button" role="radio" aria-checked={kind === k.value} onClick={() => setKind(k.value)} className={`min-h-10 rounded-lg border px-3 text-sm font-semibold ${kind === k.value ? k.badge + " ring-2 ring-primary/40" : "border-border bg-surface text-muted hover:bg-pale-green"}`}>
                {k.label}
              </button>
            ))}
          </div>

          <label className="mt-3 block text-sm font-medium">
            날짜
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field(Boolean(fieldErrors.event_date))} />
          </label>

          <label className="mt-3 flex min-h-11 items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="size-4 accent-[var(--color-primary)]" />
            종일
          </label>
          {!allDay && (
            <div className="flex flex-wrap items-center gap-2">
              <TimeSelect label="시작" value={start} onChange={setStart} />
              <span className="text-muted" aria-hidden="true">–</span>
              {end ? (
                <>
                  <TimeSelect label="끝" value={end} onChange={setEnd} allow24 invalid={end <= start} />
                  <button type="button" onClick={() => setEnd("")} className="min-h-11 text-xs text-muted hover:underline">끝 시각 빼기</button>
                </>
              ) : (
                <button type="button" onClick={() => setEnd(start < "23:00" ? `${String(Number(start.slice(0, 2)) + 1).padStart(2, "0")}${start.slice(2)}` : "24:00")} className="min-h-11 text-xs font-semibold text-primary hover:underline">
                  끝 시각 넣기
                </button>
              )}
            </div>
          )}

          <label className="mt-3 block text-sm font-medium">
            프로젝트 <span className="font-normal text-muted">(선택)</span>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={field(Boolean(fieldErrors.project_id))}>
              <option value="">개인 이벤트</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>

          <label className="mt-3 block text-sm font-medium">
            메모 <span className="font-normal text-muted">(선택)</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={EVENT_NOTE_MAX} rows={2} placeholder="장소, 준비물 등" className={`${field()} py-2.5`} />
          </label>
        </fieldset>

        {error && (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800" role="alert">
            <CircleAlert size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {editing && (
            confirmDelete ? (
              <button type="button" onClick={() => remove.mutate()} disabled={pending} className="flex min-h-11 items-center gap-1.5 rounded-xl bg-red-700 px-3.5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60">
                {remove.isPending ? <LoaderCircle size={16} strokeWidth={2} className="animate-spin" aria-hidden="true" /> : <Trash2 size={16} strokeWidth={2} aria-hidden="true" />}
                정말 삭제
              </button>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} disabled={pending} className="flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-red-700 hover:bg-red-50">
                <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
                삭제
              </button>
            )
          )}
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

/** "D-3", "D-day", "D+2" */
export function dDay(eventDate: string, today: string): string {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const diff = Math.round((toUtc(eventDate) - toUtc(today)) / 86_400_000);
  if (diff === 0) return "D-day";
  return diff > 0 ? `D-${diff}` : `D+${-diff}`;
}
