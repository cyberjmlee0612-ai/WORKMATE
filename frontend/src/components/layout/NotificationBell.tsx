"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Bell, CalendarClock, CalendarHeart, History, TriangleAlert, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { dDay } from "@/components/events/EventDialog";
import { dashboardKeys, getDashboard } from "@/lib/api/dashboard";
import { listMissedPlans, listTimePlans, timeKeys } from "@/lib/api/time";
import { useToday, userTimeZone } from "@/lib/date";
import { addDays, formatClock, startOfDay, useNowMinute } from "@/lib/time";
import { AlertSettings } from "./AlertSettings";

const EVENT_ALERT_DAYS = 3;

type Item = { key: string; icon: LucideIcon; tone: string; text: string; href: string };

/**
 * 알림 센터 (2026-11-26 사용자 확정). 지금 챙길 것을 모아 보여 준다:
 * 밀린 계획, 마감 지난/오늘 마감 업무, 3일 안 이벤트, 오늘 남은 계획. 숫자 배지는 '챙겨야 할 것' 개수.
 */
export function NotificationBell() {
  const id = useId();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const today = useToday();
  const nowMinute = useNowMinute();
  const tz = today ? userTimeZone() : "UTC";

  const dashboard = useQuery({ queryKey: dashboardKeys.detail(today ?? "", tz), queryFn: () => getDashboard(today!, tz), enabled: today !== null });
  const missed = useQuery({ queryKey: timeKeys.missed(), queryFn: listMissedPlans });
  const day = nowMinute === null ? null : startOfDay(new Date(nowMinute * 60_000));
  const range = day ? { start: day.toISOString(), end: addDays(day, 1).toISOString() } : null;
  const plans = useQuery({ queryKey: timeKeys.plans(range ?? { start: "", end: "" }), queryFn: () => listTimePlans(range!), enabled: range !== null });

  // 바깥을 누르거나 Esc를 누르면 닫는다
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items: Item[] = [];
  const missedCount = missed.data?.length ?? 0;
  if (missedCount > 0) items.push({ key: "missed", icon: History, tone: "text-amber-800", text: `밀린 계획 ${missedCount}개 — 어떻게 할지 정해 주세요`, href: "/" });
  if (dashboard.data && today) {
    const open = dashboard.data.today_tasks.filter((t) => t.status !== "completed");
    const overdue = open.filter((t) => t.due_date !== null && t.due_date < today).length;
    const dueToday = open.filter((t) => t.due_date === today).length;
    if (overdue > 0) items.push({ key: "overdue", icon: TriangleAlert, tone: "text-red-700", text: `마감이 지난 업무 ${overdue}개`, href: "/tasks" });
    if (dueToday > 0) items.push({ key: "today", icon: CalendarClock, tone: "text-primary-dark", text: `오늘 마감 업무 ${dueToday}개`, href: "/tasks" });
    for (const e of dashboard.data.upcoming_events) {
      const dd = dDay(e.event_date, today);
      if (dd === "D-day" || Number(dd.replace("D-", "")) <= EVENT_ALERT_DAYS) {
        items.push({ key: `event-${e.id}`, icon: CalendarHeart, tone: "text-violet-800", text: `${e.title} ${dd}`, href: `/calendar?date=${e.event_date}` });
      }
    }
  }
  const now = (nowMinute ?? 0) * 60_000;
  const upcoming = (plans.data ?? [])
    .filter((p) => !p.resolution && Date.parse(p.ends_at) > now && p.task_status !== "completed" && p.task_status !== "cancelled")
    .slice(0, 4);
  const count = items.length;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        aria-label={count > 0 ? `알림 ${count}개` : "알림"}
        title="알림"
        className="relative flex size-11 items-center justify-center rounded-xl border border-border bg-surface text-primary-dark hover:bg-pale-green"
      >
        <Bell size={20} strokeWidth={2} aria-hidden="true" />
        {count > 0 && (
          <span className="absolute -right-1 -top-1 flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold leading-5 text-white" aria-hidden="true">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <div id={`${id}-panel`} role="dialog" aria-label="알림" className="surface-card absolute right-0 top-full z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <p className="text-base font-bold text-primary-dark">알림</p>
            <button type="button" onClick={() => setOpen(false)} className="-mr-2 flex size-9 items-center justify-center rounded-lg text-muted hover:bg-pale-green" aria-label="닫기">
              <X size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>

          {items.length === 0 ? (
            <p className="mt-2 text-sm text-muted">지금 챙길 알림이 없어요.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {items.map(({ key, icon: Icon, tone, text, href }) => (
                <li key={key}>
                  <Link href={href} onClick={() => setOpen(false)} className="flex min-h-11 items-center gap-2.5 rounded-xl px-2 text-sm hover:bg-pale-green/60">
                    <Icon size={16} strokeWidth={2} className={`shrink-0 ${tone}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-foreground">{text}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-3 text-xs font-semibold text-muted">오늘 남은 계획</p>
          {upcoming.length === 0 ? (
            <p className="mt-1 text-sm text-muted">남은 계획이 없어요.</p>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {upcoming.map((p) => (
                <li key={p.id}>
                  <Link href="/calendar?view=day" onClick={() => setOpen(false)} className="flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm hover:bg-pale-green/60">
                    <span className="w-16 shrink-0 font-geist text-xs text-muted">{formatClock(p.starts_at)}</span>
                    <span className="min-w-0 flex-1 truncate">{p.task_title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 border-t border-border pt-3">
            <AlertSettings />
          </div>
        </div>
      )}
    </div>
  );
}
