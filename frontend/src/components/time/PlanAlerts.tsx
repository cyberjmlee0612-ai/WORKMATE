"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlarmClock, BellRing, LoaderCircle, Play, Square, X } from "lucide-react";
import { useTimerControls } from "@/components/time/useTimerControls";
import { markSent, useAlertPrefs, wasSent } from "@/lib/alerts";
import { listTimePlans, timeKeys, type TimePlan } from "@/lib/api/time";
import { toLocalDateString } from "@/lib/date";
import { addDays, formatClock, startOfDay, useNowMinute } from "@/lib/time";

type Kind = "pre" | "start" | "end";
type Alert = { key: string; kind: Kind; plan: TimePlan };

const PRE_MINUTES = 5; // 시작 5분 전 예고
const WINDOW_MINUTES = 10; // 이 시간 안에 화면을 열면 늦게라도 알린다
const SNOOZE_MINUTES = 10;
const MAX_TOASTS = 3;

/**
 * 계획 시작 알림 + 원클릭 타이머 (2026-11-26 사용자 확정).
 * - 시작 5분 전 예고, 시작 시각에 '지금 시작' + 타이머 버튼
 * - 계획이 끝났는데 그 업무 타이머가 켜져 있으면 '멈추기 / 10분 더 / 계속'
 * - WORKMATE 탭이 열려 있을 때만 동작 (다른 탭을 보고 있으면 브라우저 알림도). 같은 알림은 하루에 한 번.
 * 모든 화면에 붙는다 (AppShell).
 */
export function PlanAlerts() {
  const prefs = useAlertPrefs();
  const nowMinute = useNowMinute();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [snoozed, setSnoozed] = useState<Record<string, number>>({}); // planId → 다시 물을 시각(ms)
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useTimerControls({ onError: setNotice, onNotice: setNotice });

  const day = nowMinute === null ? null : startOfDay(new Date(nowMinute * 60_000));
  const range = day ? { start: day.toISOString(), end: addDays(day, 1).toISOString() } : null;
  const plansQuery = useQuery({
    queryKey: timeKeys.plans(range ?? { start: "", end: "" }),
    queryFn: () => listTimePlans(range!),
    enabled: range !== null && prefs.enabled,
    refetchInterval: 5 * 60_000, // 다른 기기에서 바꾼 계획도 반영
  });

  // 최신 값은 ref로 읽고, 확인은 15초 타이머 콜백에서 한다 (effect 안에서 바로 상태를 바꾸지 않게)
  const latest = useRef({ prefs, plans: plansQuery.data, snoozed, runningTaskId: timer.running?.task_id ?? null });
  useEffect(() => {
    latest.current = { prefs, plans: plansQuery.data, snoozed, runningTaskId: timer.running?.task_id ?? null };
  });
  useEffect(() => {
    const check = () => {
      const { prefs, plans, snoozed, runningTaskId } = latest.current;
      if (!prefs.enabled || !plans) return;
      const now = Date.now();
      const dayKey = toLocalDateString(new Date(now));
      const fresh: Alert[] = [];

      for (const plan of plans) {
        if (plan.resolution || plan.task_status === "completed" || plan.task_status === "cancelled") continue;
        const start = Date.parse(plan.starts_at);
        const end = snoozed[plan.id] ?? Date.parse(plan.ends_at);
        const candidates: [Kind, boolean, string][] = [
          ["pre", now >= start - PRE_MINUTES * 60_000 && now < start, `${plan.id}:pre`],
          ["start", now >= start && now < start + WINDOW_MINUTES * 60_000, `${plan.id}:start`],
          ["end", now >= end && now < end + WINDOW_MINUTES * 60_000 && runningTaskId === plan.task_id, `${plan.id}:end:${end}`],
        ];
        for (const [kind, due, key] of candidates) {
          if (!due || wasSent(dayKey, key)) continue;
          markSent(dayKey, key);
          fresh.push({ key, kind, plan });
        }
      }
      if (fresh.length === 0) return;
      // 같은 계획의 예고는 시작 알림으로 바꾼다
      setAlerts((cur) => [...cur.filter((a) => !fresh.some((f) => f.plan.id === a.plan.id)), ...fresh].slice(-MAX_TOASTS));
      if (prefs.browser && document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
        for (const a of fresh) {
          const n = new Notification(TITLE[a.kind](a.plan), { body: BODY[a.kind](a.plan), tag: a.key });
          n.onclick = () => {
            window.focus();
            n.close();
          };
        }
      }
    };
    const first = window.setTimeout(check, 1000); // 계획을 불러온 직후에도 한 번
    const id = window.setInterval(check, 15_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [plansQuery.data]);

  const dismiss = (key: string) => setAlerts((cur) => cur.filter((a) => a.key !== key));

  if (alerts.length === 0 && !notice) return timer.dialog;
  return (
    <>
    {/* 멈춤 확인 창은 클릭이 막힌 알림 영역 밖에 둔다 */}
    {timer.dialog}
    <div className="pointer-events-none fixed inset-x-3 bottom-24 z-50 flex flex-col items-end gap-2 md:bottom-6 md:left-auto md:right-6 md:w-96" aria-live="polite">
      {alerts.map((a) => (
        <div key={a.key} className="pointer-events-auto w-full rounded-2xl border border-primary/30 bg-surface p-3.5 shadow-[var(--floating-shadow)]" role="status">
          <div className="flex items-start gap-2.5">
            <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${a.kind === "end" ? "bg-amber-100 text-amber-900" : "bg-pale-green text-primary-dark"}`}>
              {a.kind === "end" ? <AlarmClock size={18} strokeWidth={2} aria-hidden="true" /> : <BellRing size={18} strokeWidth={2} aria-hidden="true" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-primary-dark">{TITLE[a.kind](a.plan)}</p>
              <p className="mt-0.5 text-xs text-muted">{BODY[a.kind](a.plan)}</p>
            </div>
            <button type="button" onClick={() => dismiss(a.key)} className="-mr-1 -mt-1 flex size-9 items-center justify-center rounded-lg text-muted hover:bg-pale-green" aria-label="알림 닫기">
              <X size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5 pl-11">
            {a.kind !== "end" ? (
              timer.running?.task_id === a.plan.task_id ? (
                <span className="text-xs font-semibold text-primary">타이머가 이미 켜져 있어요</span>
              ) : (
                <button type="button" disabled={timer.pending} onClick={() => { timer.start(a.plan.task_id); dismiss(a.key); }} className="flex min-h-10 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-white hover:bg-primary-dark disabled:opacity-60">
                  {timer.pending ? <LoaderCircle size={14} strokeWidth={2} className="animate-spin" aria-hidden="true" /> : <Play size={14} strokeWidth={2} aria-hidden="true" />}
                  {timer.running ? "이 업무로 타이머 바꾸기" : "타이머 시작"}
                </button>
              )
            ) : (
              <>
                <button type="button" disabled={timer.pending} onClick={() => { timer.stop(); dismiss(a.key); }} className="flex min-h-10 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-white hover:bg-primary-dark disabled:opacity-60">
                  <Square size={12} strokeWidth={2.5} fill="currentColor" aria-hidden="true" />
                  멈추기
                </button>
                <button type="button" onClick={() => { setSnoozed((s) => ({ ...s, [a.plan.id]: Date.now() + SNOOZE_MINUTES * 60_000 })); dismiss(a.key); }} className="min-h-10 rounded-lg border border-border px-3 text-xs font-semibold text-primary-dark hover:bg-pale-green">
                  {SNOOZE_MINUTES}분 더
                </button>
                <button type="button" onClick={() => dismiss(a.key)} className="min-h-10 rounded-lg px-2 text-xs text-muted hover:underline">계속하기</button>
              </>
            )}
          </div>
        </div>
      ))}
      {notice && (
        <p className="pointer-events-auto w-full rounded-xl border border-soft-sage bg-pale-green px-3.5 py-2.5 text-sm text-primary-dark shadow" role="status">
          {notice}
          <button type="button" onClick={() => setNotice(null)} className="ml-2 text-xs text-muted underline">닫기</button>
        </p>
      )}
    </div>
    </>
  );
}

const TITLE: Record<Kind, (p: TimePlan) => string> = {
  pre: (p) => `곧 시작: ${p.task_title}`,
  start: (p) => `지금 시작할 시간이에요: ${p.task_title}`,
  end: (p) => `계획 시간이 끝났어요: ${p.task_title}`,
};
const BODY: Record<Kind, (p: TimePlan) => string> = {
  pre: (p) => `${formatClock(p.starts_at)}부터 ${formatClock(p.ends_at)}까지 계획했어요.`,
  start: (p) => `${formatClock(p.ends_at)}까지예요. 타이머를 켜고 시작해 볼까요?`,
  end: () => "타이머가 아직 켜져 있어요. 멈출까요, 조금 더 할까요?",
};
