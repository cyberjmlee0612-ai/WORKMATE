"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarHeart, Plus, Sun } from "lucide-react";
import { EventDialog, dDay } from "@/components/events/EventDialog";
import { EventRow } from "@/components/events/ProjectEventsSection";
import type { Dashboard } from "@/lib/api/dashboard";
import type { WorkEvent } from "@/lib/api/events";
import { toMinutes } from "@/lib/api/schedule";
import { formatMinutes } from "@/lib/format";

/**
 * 오늘 브리핑 (2026-11-26 사용자 확정: 내 데이터로 만드는 브리핑, 외부 전송·AI 없음).
 * 마감 지난/오늘 마감 업무, 오늘 계획 시간, 오늘 수업·고정 일정, 가장 가까운 이벤트를 한눈에.
 */
export function Briefing({ data, today }: { data: Dashboard; today: string }) {
  const [dialog, setDialog] = useState<{ mode: "create" } | { mode: "edit"; event: WorkEvent } | null>(null);

  const open = data.today_tasks.filter((t) => t.status !== "completed");
  const overdue = open.filter((t) => t.due_date !== null && t.due_date < today).length;
  const dueToday = open.filter((t) => t.due_date === today).length;
  const fixed = data.today_schedule.filter((b) => b.kind === "fixed");
  const workMinutes = data.today_schedule.filter((b) => b.kind === "work").reduce((sum, b) => sum + toMinutes(b.end) - toMinutes(b.start), 0);
  const next = data.upcoming_events[0];

  const lines: { key: string; text: string; tone?: "warn" }[] = [];
  if (overdue > 0) lines.push({ key: "overdue", text: `마감이 지난 업무가 ${overdue}개 있어요. 먼저 정리해 볼까요?`, tone: "warn" });
  if (dueToday > 0) lines.push({ key: "today", text: `오늘 마감인 업무가 ${dueToday}개예요.` });
  if (fixed.length > 0) lines.push({ key: "fixed", text: `오늘 일정: ${fixed.map((b) => `${b.title} ${b.start}–${b.end}`).join(", ")}` });
  if (data.today_planned_minutes > 0) lines.push({ key: "plan", text: `시간표에 ${formatMinutes(data.today_planned_minutes)}을 계획해 두었어요.` });
  else if (workMinutes > 0) lines.push({ key: "plan", text: `오늘 일·공부 시간은 ${formatMinutes(workMinutes)}이에요. 캘린더에서 계획을 세워 보세요.` });
  if (next) lines.push({ key: "event", text: `${next.title} ${dDay(next.event_date, today)}${next.event_date === today ? " — 오늘이에요!" : ""}` });
  if (lines.length === 0) lines.push({ key: "free", text: "오늘은 정해진 마감이 없어요. 미뤄 둔 일을 하나 골라 볼까요?" });

  return (
    <section className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]" aria-label="오늘 브리핑">
      <div className="liquid-accent rounded-[20px] p-4 md:p-5">
        <h2 className="flex items-center gap-2 text-base font-bold text-primary-dark">
          <Sun size={18} strokeWidth={2} aria-hidden="true" />
          오늘 브리핑
        </h2>
        <ul className="mt-2 space-y-1.5">
          {lines.map((line) => (
            <li key={line.key} className={`flex items-start gap-2 text-sm leading-6 ${line.tone === "warn" ? "font-semibold text-red-800" : "text-foreground"}`}>
              <span className={`mt-2.5 size-1.5 shrink-0 rounded-full ${line.tone === "warn" ? "bg-red-600" : "bg-primary"}`} aria-hidden="true" />
              {line.text}
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-x-4 text-xs">
          <Link href="/calendar" className="min-h-11 content-center font-semibold text-primary hover:underline">캘린더에서 계획하기</Link>
          {data.today_schedule.length === 0 && <Link href="/settings" className="min-h-11 content-center text-muted hover:underline">요일별 시간표 정하기</Link>}
        </div>
      </div>

      <div className="glass-panel rounded-[20px] p-4 md:p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-bold text-primary-dark">
            <CalendarHeart size={18} strokeWidth={2} aria-hidden="true" />
            다가오는 이벤트
          </h2>
          <button type="button" onClick={() => setDialog({ mode: "create" })} className="flex size-11 items-center justify-center rounded-xl text-primary-dark hover:bg-pale-green" aria-label="이벤트 추가" title="이벤트 추가">
            <Plus size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        {data.upcoming_events.length === 0 ? (
          <p className="mt-2 text-sm text-muted">60일 안에 예정된 시험·발표·출품 같은 이벤트가 없어요.</p>
        ) : (
          <ul className="mt-1">
            {data.upcoming_events.map((e) => (
              <li key={e.id}><EventRow event={e} today={today} showProject onOpen={() => setDialog({ mode: "edit", event: e })} /></li>
            ))}
          </ul>
        )}
      </div>

      {dialog?.mode === "create" && <EventDialog mode="create" date={today} onClose={() => setDialog(null)} />}
      {dialog?.mode === "edit" && <EventDialog mode="edit" event={dialog.event} onClose={() => setDialog(null)} />}
    </section>
  );
}
