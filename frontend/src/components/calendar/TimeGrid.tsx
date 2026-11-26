"use client";

import type { Ref } from "react";
import { eventKind, type WorkEvent } from "@/lib/api/events";
import { toMinutes, type BlockKind, type ScheduleBlock } from "@/lib/api/schedule";
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
  /** AI 하루 계획 미리보기 (저장 전) */
  previews?: Ghost[];
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
  /** 요일별 반복 블록 (일·공부 / 수업·고정 / 쉬는 시간) — 배경으로 표시하고 누를 수 없다 */
  blocks?: ScheduleBlock[];
  /** 이벤트 날짜 — 날짜 머리글 아래에 표시 */
  events?: WorkEvent[];
  onEventOpen?: (event: WorkEvent) => void;
};

/** 반복 블록 배경 (계획·기록보다 아래, 클릭은 칸으로 통과) */
const BAND_STYLE: Record<BlockKind, { band: string; text: string }> = {
  work: { band: "bg-pale-green/45 border-l-[3px] border-primary/35", text: "text-primary/80" },
  fixed: { band: "bg-[repeating-linear-gradient(135deg,rgba(14,165,233,0.10)_0_6px,rgba(14,165,233,0.04)_6px_12px)] border-l-[3px] border-sky-400/60", text: "text-sky-800/80" },
  break: { band: "bg-[repeating-linear-gradient(135deg,rgba(245,158,11,0.12)_0_6px,rgba(245,158,11,0.04)_6px_12px)] border-l-[3px] border-amber-400/60", text: "text-amber-800/80" },
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
  days, plans, entries, nowMinute, ghost, previews = [], hiddenPlanId, placing, dragging,
  scrollRef, contentRef, onContentClick, onPlanPointerDown, onPlanOpen, onEntryOpen,
  blocks = [], events = [], onEventOpen,
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
                  {events
                    .filter((ev) => ev.event_date === toLocalDateString(day))
                    .map((ev) => (
                      <button
                        key={ev.id}
                        type="button"
                        onClick={() => onEventOpen?.(ev)}
                        title={`${eventKind(ev.kind).label}: ${ev.title}${ev.start_time ? ` (${ev.start_time}${ev.end_time ? `–${ev.end_time}` : ""})` : ""}${ev.project_path ? ` · ${ev.project_path}` : ""}`}
                        className={`mt-1 block w-full truncate rounded-md border px-1.5 py-0.5 text-left text-[11px] font-semibold leading-4 hover:brightness-95 ${eventKind(ev.kind).badge}`}
                      >
                        {ev.start_time && <span className="font-normal">{ev.start_time} </span>}
                        {ev.title}
                      </button>
                    ))}
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
                  {blocks
                    .filter((b) => b.weekdays.includes(day.getDay()))
                    .map((b) => {
                      const top = toMinutes(b.start) * MINUTE_PX;
                      const height = (toMinutes(b.end) - toMinutes(b.start)) * MINUTE_PX;
                      return (
                        <div
                          key={b.id}
                          aria-hidden="true"
                          className={`pointer-events-none absolute inset-x-0 z-0 ${BAND_STYLE[b.kind].band}`}
                          style={{ top, height }}
                        >
                          {height >= 16 && <span className={`absolute bottom-0.5 right-1 max-w-full truncate text-[10px] font-semibold ${BAND_STYLE[b.kind].text}`}>{b.title}</span>}
                        </div>
                      );
                    })}
                  {planPos.map(({ item: plan, top, height, lane, lanes, cluster, cutTop, cutBottom }) => {
                    const width = (narrowClusters.has(cluster) ? PLAN_WIDTH : 100) / lanes;
                    const closed = plan.task_status === "completed" || plan.task_status === "cancelled";
                    // 밀린 계획: 빨간 점선 / 다시 배치했거나 놓아준 원래 블록: 흐린 '놓침' (2026-11-26 사용자 확정)
                    const skipped = plan.resolution === "rescheduled" || plan.resolution === "let_go";
                    const tone = plan.missed
                      ? "border-red-400 bg-red-50/85 text-red-900 hover:bg-red-50"
                      : skipped
                        ? "border-muted/40 bg-background/80 text-muted opacity-60 hover:opacity-90"
                        : "border-primary/70 bg-pale-green/70 text-primary-dark hover:bg-pale-green";
                    return (
                      <div
                        key={plan.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`${plan.missed ? "밀린 " : skipped ? "놓친 " : ""}계획: ${plan.task_title}, ${formatClock(plan.starts_at)}부터 ${formatClock(plan.ends_at)}까지`}
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
                        className={`group absolute z-[1] overflow-hidden border-2 border-dashed px-1.5 text-left hover:z-[3] focus-visible:z-[3] ${tone} focus-visible:outline-2 focus-visible:outline-primary md:cursor-move ${cutTop ? "rounded-t-none border-t-0" : "rounded-t-lg"} ${cutBottom ? "rounded-b-none border-b-0" : "rounded-b-lg"} ${closed ? "opacity-60" : ""}`}
                        style={{ top, height: Math.max(height, 10), left: `calc(${lane * width}% + 2px)`, width: `calc(${width}% - 4px)` }}
                      >
                        {height >= 18 && (
                          <p className={`truncate text-[11px] font-semibold leading-4 ${closed || skipped ? "line-through" : ""}`}>
                            {plan.missed && <span className="mr-1 rounded bg-red-600 px-1 text-[9px] font-bold text-white no-underline">밀림</span>}
                            {skipped && <span className="mr-1 text-[9px] font-bold no-underline">놓침</span>}
                            {plan.task_title}
                          </p>
                        )}
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

                  {/* AI 하루 계획 미리보기: 아직 저장 전이라 누를 수 없다 */}
                  {layoutDay(previews, (g) => [g.startMs, g.endMs], dayStart, dayEnd).map(({ item, top, height }) => (
                    <div
                      key={`preview-${item.startMs}-${item.label}`}
                      aria-hidden="true"
                      className="pointer-events-none absolute z-[3] overflow-hidden rounded-lg border-2 border-dashed border-violet-500 bg-violet-100/80 px-1.5 text-violet-900"
                      style={{ top, height: Math.max(height, 10), left: 2, width: "calc(100% - 4px)" }}
                    >
                      {height >= 18 && <p className="truncate text-[11px] font-semibold leading-4">{item.label}</p>}
                      {height >= 34 && <p className="truncate text-[10px] leading-4">{formatClock(new Date(item.startMs).toISOString())} – {formatClock(new Date(item.endMs).toISOString())}</p>}
                    </div>
                  ))}

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
