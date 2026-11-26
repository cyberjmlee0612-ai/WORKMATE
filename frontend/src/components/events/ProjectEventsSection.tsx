"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarHeart, Plus } from "lucide-react";
import { eventKeys, eventKind, listEvents, type WorkEvent } from "@/lib/api/events";
import { formatDate } from "@/lib/format";
import { useToday } from "@/lib/date";
import { EventDialog, dDay } from "./EventDialog";

/** 프로젝트 상세의 이벤트 날짜 (시험·발표·출품 등). 지난 이벤트는 뒤에 흐리게. */
export function ProjectEventsSection({ projectId }: { projectId: string }) {
  const today = useToday();
  const filters = { project_id: projectId };
  const query = useQuery({ queryKey: eventKeys.list(filters), queryFn: () => listEvents(filters) });
  const [dialog, setDialog] = useState<{ mode: "create" } | { mode: "edit"; event: WorkEvent } | null>(null);

  const events = query.data ?? [];
  const upcoming = today ? events.filter((e) => e.event_date >= today) : events;
  const past = today ? events.filter((e) => e.event_date < today).reverse() : [];

  return (
    <section className="surface-card mt-6 rounded-[20px] p-4 md:p-5 lg:p-6" aria-labelledby="project-events-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="project-events-heading" className="flex items-center gap-2 text-lg font-bold text-primary-dark">
          <CalendarHeart size={20} strokeWidth={2} aria-hidden="true" />
          이벤트 날짜
        </h2>
        <button type="button" onClick={() => setDialog({ mode: "create" })} disabled={!today} className="flex min-h-11 items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 text-sm font-semibold text-primary-dark hover:bg-pale-green disabled:opacity-60">
          <Plus size={16} strokeWidth={2} aria-hidden="true" />
          이벤트 추가
        </button>
      </div>
      <p className="mt-1 text-sm text-muted">시험, 발표, 출품·전시처럼 날짜가 중요한 일을 기록해요.</p>

      {query.isError ? (
        <p className="mt-3 text-sm text-red-700" role="alert">{query.error.message}</p>
      ) : query.isPending ? (
        <div className="mt-3 h-14 animate-pulse rounded-xl bg-pale-green/40" />
      ) : events.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-soft-sage px-4 py-4 text-center text-sm text-muted">아직 이벤트가 없어요.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {[...upcoming, ...past].map((e) => (
            <li key={e.id}>
              <EventRow event={e} today={today} past={today !== null && e.event_date < today} onOpen={() => setDialog({ mode: "edit", event: e })} />
            </li>
          ))}
        </ul>
      )}

      {dialog?.mode === "create" && today && <EventDialog mode="create" date={today} projectId={projectId} onClose={() => setDialog(null)} />}
      {dialog?.mode === "edit" && <EventDialog mode="edit" event={dialog.event} onClose={() => setDialog(null)} />}
    </section>
  );
}

export function EventRow({ event, today, past = false, showProject = false, onOpen }: { event: WorkEvent; today: string | null; past?: boolean; showProject?: boolean; onOpen: () => void }) {
  const kind = eventKind(event.kind);
  const dd = today ? dDay(event.event_date, today) : null;
  return (
    <button type="button" onClick={onOpen} className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-1 py-2 text-left hover:bg-pale-green/40 ${past ? "opacity-55" : ""}`}>
      <span className={`w-16 shrink-0 rounded-lg border px-1.5 py-1 text-center font-geist text-xs font-bold ${dd === "D-day" ? "border-red-300 bg-red-50 text-red-800" : kind.badge}`}>{dd ?? "–"}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-primary-dark">{event.title}</span>
        <span className="block truncate text-xs text-muted">
          {kind.label} · {formatDate(event.event_date)}
          {event.start_time && ` ${event.start_time}${event.end_time ? `–${event.end_time}` : ""}`}
          {showProject && ` · ${event.project_path ?? "개인 이벤트"}`}
        </span>
      </span>
    </button>
  );
}
