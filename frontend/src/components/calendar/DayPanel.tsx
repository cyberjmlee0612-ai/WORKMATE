"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Info, LoaderCircle, NotebookPen, Target } from "lucide-react";
import type { TaskStatus } from "@/lib/api/tasks";
import { NOTE_CONTENT_MAX, getDailyNote, noteKeys, saveDailyNote, type TimeEntry, type TimePlan } from "@/lib/api/time";
import { toLocalDateString } from "@/lib/date";
import { formatMinutes } from "@/lib/format";
import { addDays } from "@/lib/time";
import { TaskTimerButton } from "@/components/time/TaskTimerButton";

type Props = { day: Date; plans: TimePlan[]; entries: TimeEntry[]; nowMinute: number | null };

const overlap = (s: number, e: number, dayStart: number, dayEnd: number) => Math.max(0, (Math.min(e, dayEnd) - Math.max(s, dayStart)) / 60_000);

/** 일간 보기 오른쪽 패널: 그날 업무별 계획/실제 + 타이머, 날짜 메모 (2026-11-26 사용자 요청) */
export function DayPanel({ day, plans, entries, nowMinute }: Props) {
  const dayStart = day.getTime();
  const dayEnd = addDays(day, 1).getTime();
  const now = (nowMinute ?? 0) * 60_000;

  // 그날 계획하거나 기록한 업무별 합계 (계획 많은 순)
  const byTask = new Map<string, { id: string; title: string; project: string | null; status: TaskStatus; planned: number; actual: number }>();
  const row = (id: string, title: string, project: string | null, status: string) => {
    let r = byTask.get(id);
    if (!r) {
      r = { id, title, project, status: status as TaskStatus, planned: 0, actual: 0 };
      byTask.set(id, r);
    }
    return r;
  };
  for (const p of plans) {
    const m = overlap(Date.parse(p.starts_at), Date.parse(p.ends_at), dayStart, dayEnd);
    if (m > 0) row(p.task_id, p.task_title, p.project_name, p.task_status).planned += m;
  }
  for (const e of entries) {
    const m = overlap(Date.parse(e.started_at), e.ended_at ? Date.parse(e.ended_at) : now, dayStart, dayEnd);
    if (m > 0) row(e.task_id, e.task_title, e.project_name, e.task_status).actual += m;
  }
  const rows = [...byTask.values()].sort((a, b) => b.planned - a.planned || b.actual - a.actual);
  const totalPlanned = rows.reduce((s, r) => s + r.planned, 0);
  const totalActual = rows.reduce((s, r) => s + r.actual, 0);

  return (
    <div className="space-y-4">
      <section className="surface-card rounded-[20px] p-4" aria-labelledby="day-plan-heading">
        <h3 id="day-plan-heading" className="flex items-center gap-2 text-base font-bold text-primary-dark">
          <Target size={18} strokeWidth={2} aria-hidden="true" />
          이날의 업무
        </h3>
        <dl className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-dashed border-primary/50 px-3 py-2">
            <dt className="text-xs text-muted">계획</dt>
            <dd className="font-geist text-lg font-bold text-primary-dark">{formatMinutes(Math.floor(totalPlanned)) ?? "0분"}</dd>
          </div>
          <div className="rounded-xl bg-pale-green/70 px-3 py-2">
            <dt className="text-xs text-muted">실제</dt>
            <dd className="font-geist text-lg font-bold text-primary-dark">{formatMinutes(Math.floor(totalActual)) ?? "0분"}</dd>
          </div>
        </dl>
        {rows.length === 0 ? (
          <p className="mt-3 rounded-xl bg-background px-3 py-4 text-center text-sm text-muted">이날 계획이나 기록이 없어요. 업무를 시간표에 배치해 보세요.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {rows.map((r) => (
              <TaskTimeRow key={r.id} {...r} />
            ))}
          </ul>
        )}
      </section>

      <DailyNoteCard date={toLocalDateString(day)} />
    </div>
  );
}

function TaskTimeRow({ id, title, project, status, planned, actual }: { id: string; title: string; project: string | null; status: TaskStatus; planned: number; actual: number }) {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(t);
  }, [notice]);
  const ratio = planned > 0 ? Math.min(100, Math.round((actual / planned) * 100)) : null;
  const closed = status === "completed" || status === "cancelled";

  return (
    <li className="py-2.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className={`truncate text-sm font-medium ${closed ? "text-muted line-through" : "text-foreground"}`}>{title}</p>
          <p className="truncate text-xs text-muted">
            {project ?? "개인 업무"} · 계획 {formatMinutes(Math.floor(planned)) ?? "0분"} / 실제 {formatMinutes(Math.floor(actual)) ?? "0분"}
          </p>
        </div>
        <TaskTimerButton task={{ id, title, status }} onError={setError} onNotice={setNotice} />
      </div>
      {ratio !== null && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-pale-green" role="progressbar" aria-valuenow={ratio} aria-valuemin={0} aria-valuemax={100} aria-label={`${title} 계획 대비 실제`}>
          <div className="h-full rounded-full bg-primary" style={{ width: `${ratio}%` }} />
        </div>
      )}
      {error && (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-red-700" role="alert">
          <CircleAlert size={14} strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}
      {notice && !error && (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-primary-dark" role="status">
          <Info size={14} strokeWidth={2} aria-hidden="true" />
          {notice}
        </p>
      )}
    </li>
  );
}

function DailyNoteCard({ date }: { date: string }) {
  const query = useQuery({ queryKey: noteKeys.day(date), queryFn: () => getDailyNote(date) });
  return (
    <section className="surface-card rounded-[20px] p-4" aria-labelledby="day-note-heading">
      <h3 id="day-note-heading" className="flex items-center gap-2 text-base font-bold text-primary-dark">
        <NotebookPen size={18} strokeWidth={2} aria-hidden="true" />
        메모
      </h3>
      {query.isPending ? (
        <div className="mt-3 h-40 animate-pulse rounded-xl bg-pale-green/40" aria-busy="true" aria-label="불러오는 중" />
      ) : query.isError ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-red-700" role="alert">
          메모를 불러오지 못했습니다.
          <button type="button" onClick={() => query.refetch()} className="font-semibold underline">다시 시도</button>
        </p>
      ) : (
        // 날짜가 바뀌면 새 편집기로 (입력 중 내용이 다른 날짜로 섞이지 않게)
        <NoteEditor key={date} date={date} initial={query.data.content} />
      )}
    </section>
  );
}

/** 입력을 멈추고 0.8초 뒤, 또는 입력칸을 벗어날 때 자동 저장. 같은 날짜 저장은 순서대로 실행한다. */
function NoteEditor({ date, initial }: { date: string; initial: string }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(initial);
  const saved = useRef(initial);
  const latest = useRef(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const { mutate } = useMutation({
    mutationFn: (content: string) => saveDailyNote(date, content),
    scope: { id: `daily-note-${date}` }, // 앞선 저장이 끝난 뒤 다음 저장 (늦게 도착한 옛 내용이 덮어쓰지 않게)
    onMutate: () => setStatus("saving"),
    onSuccess: (note, content) => {
      saved.current = content;
      queryClient.setQueryData(noteKeys.day(date), note);
      setStatus(latest.current === content ? "saved" : "saving");
    },
    onError: () => setStatus("error"),
  });

  useEffect(() => {
    latest.current = draft;
    if (draft === saved.current) return;
    const t = window.setTimeout(() => mutate(draft), 800);
    return () => window.clearTimeout(t);
  }, [draft, mutate]);

  // 다른 날짜로 이동하거나 화면을 떠날 때 저장하지 못한 내용이 있으면 저장
  useEffect(
    () => () => {
      if (latest.current !== saved.current) saveDailyNote(date, latest.current).catch(() => undefined);
    },
    [date],
  );

  const flush = () => {
    if (draft !== saved.current) mutate(draft);
  };

  return (
    <div className="mt-3">
      <label className="sr-only" htmlFor={`note-${date}`}>{date} 메모</label>
      <textarea
        id={`note-${date}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={flush}
        maxLength={NOTE_CONTENT_MAX}
        rows={8}
        placeholder="오늘 할 일, 회고, 떠오른 생각을 적어 두세요."
        className="block w-full resize-y rounded-xl border border-border bg-surface px-3 py-2.5 text-sm leading-6 text-foreground focus:border-primary focus:outline-none focus-visible:outline-2"
      />
      <p className="mt-1.5 flex items-center justify-between text-xs text-muted" aria-live="polite">
        <span className="flex items-center gap-1">
          {status === "saving" && <><LoaderCircle size={12} strokeWidth={2} className="animate-spin" aria-hidden="true" />저장 중…</>}
          {status === "saved" && "저장됨"}
          {status === "error" && (
            <span className="text-red-700">
              저장하지 못했어요.{" "}
              <button type="button" onClick={flush} className="font-semibold underline">다시 시도</button>
            </span>
          )}
        </span>
        <span>{draft.length.toLocaleString()} / {NOTE_CONTENT_MAX.toLocaleString()}</span>
      </p>
    </div>
  );
}
