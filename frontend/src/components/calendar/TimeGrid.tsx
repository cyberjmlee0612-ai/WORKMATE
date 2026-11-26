"use client";

import type { Ref } from "react";
import type { TimeEntry, TimePlan } from "@/lib/api/time";
import { toLocalDateString } from "@/lib/date";
import { formatMinutes } from "@/lib/format";
import { addDays, formatClock } from "@/lib/time";
import { DAY_MINUTES, HOUR_PX, MINUTE_PX, layoutDay } from "./layout";

/** 끌기 미리보기. guideMs: 자석처럼 붙은 경계 시각(없으면 10분 단위로 맞춘 것) */
export type Ghost = { startMs: number; endMs: number; label: string; guideMs?: number | null };

type Props = {
  days: Date[];
  plans: TimePlan[];
  entries: TimeEntry[];
  /** epoch 분. 진행 중인 타이머 블록 끝과 현재 시각 선에 쓴다 */
  nowMinute: number | null;
  ghost: Ghost | null;
  /** 끌어서 옮기는 중인 계획은 원래 자리에서 숨긴다 */
  hiddenPlanId: string | null;
  placing: boolean;
  dragging: boolean;
  scrollRef: Ref<HTMLDivElement>;
  contentRef: Ref<HTMLDivElement>;
  onContentClick: (event: React.MouseEvent) => void;
  onPlanPointerDown: (plan: TimePlan, kind: "move" | "resize", event: React.PointerEvent) => void;
  onPlanOpen: (plan: TimePlan) => void;
  onEntryOpen: (entry: TimeEntry) => void;
};

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
// 계획(점선)과 실제 기록(채움)이 같은 시간에 겹치면 계획은 왼쪽, 기록은 오른쪽에 나란히 그린다
const PLAN_WIDTH = 62;

const entryEnd = (entry: TimeEntry, nowMinute: number | null) =>
  entry.ended_at ? Date.parse(entry.ended_at) : Math.max(Date.parse(entry.started_at) + 60_000, (nowMinute ?? 0) * 60_000);

function overlapMinutes(s: number, e: number, dayStart: number, dayEnd: number) {
  return Math.max(0, (Math.min(e, dayEnd) - Math.max(s, dayStart)) / 60_000);
}

/** 0~24시 시간표. 1분 = 1px. 시각 계산은 브라우저 시간대 기준. 끌기 처리는 CalendarView가 맡는다. */
export function TimeGrid({
  days, plans, entries, nowMinute, ghost, hiddenPlanId, placing, dragging,
  scrollRef, contentRef, onContentClick, onPlanPointerDown, onPlanOpen, onEntryOpen,
}: Props) {
  const todayKey = nowMinute === null ? null : toLocalDateString(new Date(nowMinute * 60_000));
  const columns = { gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` };
  const visiblePlans = plans.filter((p) => p.id !== hiddenPlanId);

  return (
    <div ref={scrollRef} className={`relative h-[calc(100dvh-15rem)] min-h-[28rem] overflow-auto rounded-[20px] border border-border bg-surface ${dragging ? "select-none" : ""}`}>
      <div className={days.length > 1 ? "min-w-[42rem]" : ""}>
        {/* 날짜 머리글 (세로 스크롤해도 고정) */}
        <div className="sticky top-0 z-20 flex border-b border-border bg-surface/95 backdrop-blur">
          <div className="w-14 shrink-0" />
          <div className="grid flex-1" style={columns}>
            {days.map((day) => {
              const dayStart = day.getTime();
              const dayEnd = addDays(day, 1).getTime();
              const planned = plans.reduce((sum, p) => sum + overlapMinutes(Date.parse(p.starts_at), Date.parse(p.ends_at), dayStart, dayEnd), 0);
              const actual = entries.reduce((sum, e) => sum + overlapMinutes(Date.parse(e.started_at), entryEnd(e, nowMinute), dayStart, dayEnd), 0);
              const isToday = toLocalDateString(day) === todayKey;
              return (
                <div key={dayStart} className="min-w-0 border-l border-border px-1.5 py-2 text-center">
                  <p className={`text-xs ${day.getDay() === 0 ? "text-red-700" : "text-muted"}`}>{WEEKDAY[day.getDay()]}</p>
                  <p className={`mx-auto mt-0.5 flex size-8 items-center justify-center rounded-full font-geist text-base font-bold ${isToday ? "bg-primary text-white" : "text-primary-dark"}`}>{day.getDate()}</p>
                  <p className="mt-1 truncate text-[11px] text-muted" title="계획 / 실제">
                    {formatMinutes(Math.floor(planned)) ?? "0분"} <span aria-hidden="true">/</span><span className="sr-only">계획, 실제</span> <span className="font-semibold text-primary-dark">{formatMinutes(Math.floor(actual)) ?? "0분"}</span>
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex">
          {/* 시각 눈금 */}
          <div className="relative w-14 shrink-0" style={{ height: DAY_MINUTES * MINUTE_PX }} aria-hidden="true">
            {Array.from({ length: 23 }, (_, i) => i + 1).map((hour) => (
              <span key={hour} className="absolute right-2 -translate-y-1/2 font-geist text-[11px] text-muted" style={{ top: hour * HOUR_PX }}>
                {String(hour).padStart(2, "0")}:00
              </span>
            ))}
          </div>

          <div
            ref={contentRef}
            onClick={onContentClick}
            className={`relative grid flex-1 ${placing ? "cursor-copy" : ""}`}
            style={{
              ...columns,
              height: DAY_MINUTES * MINUTE_PX,
              backgroundImage: `repeating-linear-gradient(to bottom, var(--color-border) 0 1px, transparent 1px ${HOUR_PX}px)`,
            }}
          >
            {days.map((day) => {
              const dayStart = day.getTime();
              const dayEnd = addDays(day, 1).getTime();
              const planPos = layoutDay(visiblePlans, (p) => [Date.parse(p.starts_at), Date.parse(p.ends_at)], dayStart, dayEnd);
              const entryPos = layoutDay(entries, (e) => [Date.parse(e.started_at), entryEnd(e, nowMinute)], dayStart, dayEnd);
              const ghostPos = ghost ? layoutDay([ghost], (g) => [g.startMs, g.endMs], dayStart, dayEnd)[0] : undefined;
              const isToday = toLocalDateString(day) === todayKey;
              const nowTop = isToday && nowMinute !== null ? ((nowMinute * 60_000 - dayStart) / 60_000) * MINUTE_PX : null;

              // 실제 기록과 겹치는 계획 묶음만 왼쪽으로 좁히고, 나머지는 칸 전체 폭을 쓴다 (2026-11-26 사용자 요청)
              const overlapsEntry = (s: number, e: number) => entryPos.some((p) => p.clipStart < e && p.clipEnd > s);
              const overlapsPlan = (s: number, e: number) => planPos.some((p) => p.clipStart < e && p.clipEnd > s);
              const narrowClusters = new Set(planPos.filter((p) => overlapsEntry(p.clipStart, p.clipEnd)).map((p) => p.cluster));
              const ghostNarrow = ghostPos ? overlapsEntry(ghostPos.clipStart, ghostPos.clipEnd) : false;
              const guideTop =
                ghost?.guideMs != null && ghost.guideMs >= dayStart && ghost.guideMs <= dayEnd ? ((ghost.guideMs - dayStart) / 60_000) * MINUTE_PX : null;

              return (
                <div key={dayStart} className={`relative min-w-0 border-l border-border ${isToday ? "bg-pale-green/20" : ""}`}>
                  {planPos.map(({ item: plan, top, height, lane, lanes, cluster, cutTop, cutBottom }) => {
                    const width = (narrowClusters.has(cluster) ? PLAN_WIDTH : 100) / lanes;
                    const closed = plan.task_status === "completed" || plan.task_status === "cancelled";
                    return (
                      <div
                        key={plan.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`계획: ${plan.task_title}, ${formatClock(plan.starts_at)}부터 ${formatClock(plan.ends_at)}까지`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onPlanOpen(plan);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onPlanOpen(plan);
                          }
                        }}
                        onPointerDown={(event) => {
                          if (event.pointerType === "mouse" && event.button === 0) onPlanPointerDown(plan, "move", event);
                        }}
                        className={`group absolute z-[1] overflow-hidden border-2 border-dashed border-primary/70 bg-pale-green/70 px-1.5 text-left text-primary-dark hover:z-[3] hover:bg-pale-green focus-visible:z-[3] focus-visible:outline-2 focus-visible:outline-primary md:cursor-move ${cutTop ? "rounded-t-none border-t-0" : "rounded-t-lg"} ${cutBottom ? "rounded-b-none border-b-0" : "rounded-b-lg"} ${closed ? "opacity-60" : ""}`}
                        style={{ top, height: Math.max(height, 10), left: `calc(${lane * width}% + 2px)`, width: `calc(${width}% - 4px)` }}
                      >
                        {height >= 18 && <p className={`truncate text-[11px] font-semibold leading-4 ${closed ? "line-through" : ""}`}>{plan.task_title}</p>}
                        {height >= 34 && <p className="truncate text-[10px] leading-4 text-muted">{formatClock(plan.starts_at)} – {formatClock(plan.ends_at)}</p>}
                        {/* 아래 끝을 끌어 길이 조절 (10분 단위). 터치에서도 동작한다 */}
                        {!cutBottom && (
                          <div
                            aria-hidden="true"
                            onPointerDown={(event) => {
                              event.stopPropagation();
                              if (event.button === 0) onPlanPointerDown(plan, "resize", event);
                            }}
                            onClick={(event) => event.stopPropagation()}
                            className="absolute inset-x-0 bottom-0 h-2.5 cursor-ns-resize touch-none after:absolute after:bottom-0.5 after:left-1/2 after:h-1 after:w-6 after:-translate-x-1/2 after:rounded-full after:bg-primary/40 group-hover:after:bg-primary"
                          />
                        )}
                      </div>
                    );
                  })}

                  {entryPos.map(({ item: entry, top, height, cutTop, cutBottom, clipStart, clipEnd }) => {
                    // 같은 시간에 계획이 없으면 칸 전체 폭
                    const full = !overlapsPlan(clipStart, clipEnd);
                    return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onEntryOpen(entry);
                      }}
                      aria-label={`실제 기록: ${entry.task_title}, ${formatClock(entry.started_at)}부터 ${entry.ended_at ? `${formatClock(entry.ended_at)}까지` : "진행 중"}`}
                      className={`absolute z-[2] overflow-hidden bg-primary px-1.5 text-left text-white shadow-sm hover:z-[3] hover:bg-primary-dark ${cutTop ? "rounded-t-none" : "rounded-t-lg"} ${cutBottom ? "rounded-b-none" : "rounded-b-lg"} ${entry.ended_at ? "" : "animate-pulse"}`}
                      style={
                        full
                          ? { top, height: Math.max(height, 6), left: 2, width: "calc(100% - 4px)" }
                          : { top, height: Math.max(height, 6), left: `calc(${PLAN_WIDTH}% + 1px)`, width: `calc(${100 - PLAN_WIDTH}% - 3px)` }
                      }
                    >
                      {height >= 18 && <span className="block truncate text-[11px] font-semibold leading-4">{entry.task_title}</span>}
                    </button>
                    );
                  })}

                  {/* 자석처럼 붙은 경계 안내선 */}
                  {guideTop !== null && (
                    <div className="pointer-events-none absolute inset-x-0 z-[4] h-0.5 rounded-full bg-primary shadow-[0_0_6px_var(--color-primary)]" style={{ top: guideTop - 1 }} aria-hidden="true" />
                  )}

                  {ghostPos && (
                    <div
                      aria-hidden="true"
                      // 짧은 전환으로 칸·경계에 '착' 붙는 느낌을 준다
                      className={`pointer-events-none absolute z-[4] overflow-hidden rounded-lg border-2 bg-primary/15 px-1.5 text-primary-dark shadow-lg transition-[top,height] duration-100 ease-out ${ghost?.guideMs != null ? "border-primary ring-2 ring-primary/30" : "border-primary/80"}`}
                      style={{ top: ghostPos.top, height: Math.max(ghostPos.height, 10), left: 2, width: ghostNarrow ? `calc(${PLAN_WIDTH}% - 4px)` : "calc(100% - 4px)" }}
                    >
                      <p className="truncate text-[11px] font-semibold leading-4">{ghost?.label}</p>
                      {ghost && <p className="truncate text-[10px] leading-4">{formatClock(new Date(ghost.startMs).toISOString())} – {formatClock(new Date(ghost.endMs).toISOString())}</p>}
                    </div>
                  )}

                  {nowTop !== null && (
                    <div className="pointer-events-none absolute inset-x-0 z-[5] border-t-2 border-red-500" style={{ top: nowTop }} aria-hidden="true">
                      <span className="absolute -left-1 -top-[5px] size-2 rounded-full bg-red-500" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
