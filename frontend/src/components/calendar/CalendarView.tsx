"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, CircleAlert, Clock, ListTodo, MousePointerClick, X } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { invalidateWorkData } from "@/lib/api/invalidate";
import type { Task } from "@/lib/api/tasks";
import { createTimePlan, listTimeEntries, listTimePlans, timeKeys, updateTimePlan, type TimeEntry, type TimePlan } from "@/lib/api/time";
import { toLocalDateString, useToday } from "@/lib/date";
import { addDays, parseDateParam, startOfDay, startOfWeek, useNowMinute } from "@/lib/time";
import { DAY_MINUTES, INITIAL_SCROLL_HOUR, HOUR_PX, MAX_PLAN_MIN, MINUTE_PX, SNAP_MIN, defaultPlanMinutes, snap, snapDown } from "./layout";
import { TimeGrid, type Ghost } from "./TimeGrid";
import { TaskPicker } from "./TaskPicker";
import { PlanDialog } from "./PlanDialog";
import { EntryEditDialog } from "./EntryEditDialog";
import { DayPanel } from "./DayPanel";

type View = "week" | "day";

/** 자석 효과가 걸리는 거리(분). 1분 = 1px이라 8px 안으로 가까워지면 붙는다 */
const MAGNET_MIN = 8;

function subscribeMedia(onChange: () => void) {
  const media = window.matchMedia("(min-width: 768px)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** 데스크톱이면 true. 서버 렌더링 중에는 null (하이드레이션 불일치 방지) */
function useIsWide(): boolean | null {
  return useSyncExternalStore(subscribeMedia, () => window.matchMedia("(min-width: 768px)").matches, () => null);
}

/** 시간표 (2026-11-26 사용자 확정: 데스크톱 주간·모바일 일간, 일요일 시작, 0~24시·8시로 스크롤) */
export function CalendarView() {
  const searchParams = useSearchParams();
  const today = useToday();
  const isWide = useIsWide();

  const viewParam = searchParams.get("view");
  const view: View | null = viewParam === "week" || viewParam === "day" ? viewParam : isWide === null ? null : isWide ? "week" : "day";
  const anchor = parseDateParam(searchParams.get("date")) ?? parseDateParam(today);

  if (!view || !anchor) {
    return <div className="mt-6 h-[calc(100dvh-15rem)] min-h-[28rem] animate-pulse rounded-[20px] bg-pale-green/40" aria-busy="true" aria-label="불러오는 중" />;
  }
  return <CalendarBody view={view} anchor={anchor} />;
}

type DragState =
  | { kind: "new"; task: Task; minutes: number }
  | { kind: "move"; plan: TimePlan; grabMinutes: number; minutes: number }
  | { kind: "resize"; plan: TimePlan };

const dayLabel = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" });
const monthLabel = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long" });

function CalendarBody({ view, anchor }: { view: View; anchor: Date }) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const nowMinute = useNowMinute();

  const first = view === "week" ? startOfWeek(anchor) : startOfDay(anchor);
  const days = Array.from({ length: view === "week" ? 7 : 1 }, (_, i) => addDays(first, i));
  const range = { start: days[0].toISOString(), end: addDays(days[days.length - 1], 1).toISOString() };

  const plansQuery = useQuery({ queryKey: timeKeys.plans(range), queryFn: () => listTimePlans(range) });
  const entriesQuery = useQuery({ queryKey: timeKeys.entries(range), queryFn: () => listTimeEntries(range) });

  const [selected, setSelected] = useState<Task | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [hiddenPlanId, setHiddenPlanId] = useState<string | null>(null);
  const [floating, setFloating] = useState<{ x: number; y: number; label: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [planDialog, setPlanDialog] = useState<
    { mode: "edit"; plan: TimePlan } | { mode: "create"; task: Task; start: Date; minutes: number } | null
  >(null);
  const [entryDialog, setEntryDialog] = useState<TimeEntry | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const justDragged = useRef(false);

  // 처음 열었을 때 8시 근처로 스크롤
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = INITIAL_SCROLL_HOUR * HOUR_PX - 8;
  }, []);

  function navigate(next: { date?: Date; view?: View }) {
    const params = new URLSearchParams();
    params.set("date", toLocalDateString(next.date ?? anchor));
    params.set("view", next.view ?? view);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  // 저장 성공 후 다시 조회가 끝날 때까지 미리보기를 유지해 블록이 원래 자리로 튀지 않게 한다
  const clearPreview = () => {
    setGhost(null);
    setHiddenPlanId(null);
  };
  const onMutationError = (err: unknown) => {
    if (err instanceof ApiError && (err.status === 404 || err.status === 409)) invalidateWorkData(queryClient);
    const fieldMessage = err instanceof ApiError ? Object.values(err.fieldErrors)[0] : undefined;
    setActionError(fieldMessage ?? (err instanceof ApiError ? err.message : "저장하지 못했습니다. 다시 시도해 주세요."));
  };
  const createPlan = useMutation({
    mutationFn: createTimePlan,
    onMutate: () => setActionError(null),
    onSuccess: () => invalidateWorkData(queryClient),
    onError: onMutationError,
    onSettled: clearPreview,
  });
  const changePlan = useMutation({
    mutationFn: ({ id, ...input }: { id: string; starts_at?: string; ends_at?: string }) => updateTimePlan(id, input),
    onMutate: () => setActionError(null),
    onSuccess: () => invalidateWorkData(queryClient),
    onError: onMutationError,
    onSettled: clearPreview,
  });

  /** 화면 좌표 → (날짜 칸, 그날 0시부터 분) */
  function hitTest(clientX: number, clientY: number): { day: Date; minute: number } | null {
    const content = contentRef.current;
    if (!content) return null;
    const rect = content.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (x < 0 || x >= rect.width) return null;
    const index = Math.min(days.length - 1, Math.floor(x / (rect.width / days.length)));
    return { day: days[index], minute: Math.min(DAY_MINUTES, Math.max(0, y / MINUTE_PX)) };
  }

  const at = (day: Date, minute: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minute).getTime();

  /**
   * 자석 효과 (2026-11-26 사용자 요청): 블록 끝이 다른 계획·실제 기록의 경계나 현재 시각에서
   * MAGNET_MIN분 안에 들어오면 그 경계에 붙인다. 붙을 곳이 없으면 10분 단위로 맞춘다.
   */
  function edgeTargets(excludePlanId: string | null): number[] {
    const now = (nowMinute ?? 0) * 60_000;
    const targets: number[] = nowMinute ? [now] : [];
    for (const p of plansQuery.data ?? []) {
      if (p.id !== excludePlanId) targets.push(Date.parse(p.starts_at), Date.parse(p.ends_at));
    }
    for (const e of entriesQuery.data ?? []) targets.push(Date.parse(e.started_at), e.ended_at ? Date.parse(e.ended_at) : now);
    return targets;
  }

  function nearestEdge(ms: number, targets: number[]): number | null {
    let best: number | null = null;
    for (const t of targets) {
      if (Math.abs(t - ms) <= MAGNET_MIN * 60_000 && (best === null || Math.abs(t - ms) < Math.abs(best - ms))) best = t;
    }
    return best;
  }

  /** 길이가 정해진 블록(새로 놓기·옮기기)의 시작 시각: 시작 또는 끝 중 더 가까운 경계에 붙인다 */
  function placeBlock(day: Date, rawStartMinute: number, minutes: number, label: string, excludePlanId: string | null): Ghost {
    const rawStart = at(day, rawStartMinute);
    const duration = minutes * 60_000;
    const targets = edgeTargets(excludePlanId);
    const byStart = nearestEdge(rawStart, targets);
    const byEnd = nearestEdge(rawStart + duration, targets);
    const startGap = byStart === null ? Infinity : Math.abs(byStart - rawStart);
    const endGap = byEnd === null ? Infinity : Math.abs(byEnd - (rawStart + duration));
    if (byStart !== null && startGap <= endGap) return { startMs: byStart, endMs: byStart + duration, label, guideMs: byStart };
    if (byEnd !== null) return { startMs: byEnd - duration, endMs: byEnd, label, guideMs: byEnd };
    const start = at(day, snap(rawStartMinute));
    return { startMs: start, endMs: start + duration, label, guideMs: null };
  }

  function ghostFor(drag: DragState, hit: { day: Date; minute: number }): Ghost {
    if (drag.kind === "new") {
      return placeBlock(hit.day, Math.min(DAY_MINUTES - SNAP_MIN, hit.minute), drag.minutes, drag.task.title, null);
    }
    if (drag.kind === "move") {
      return placeBlock(hit.day, hit.minute - drag.grabMinutes, drag.minutes, drag.plan.task_title, drag.plan.id);
    }
    const start = Date.parse(drag.plan.starts_at);
    const magnet = nearestEdge(at(hit.day, hit.minute), edgeTargets(drag.plan.id).filter((t) => t >= start + SNAP_MIN * 60_000));
    const raw = magnet ?? at(hit.day, snap(hit.minute));
    const end = Math.min(start + MAX_PLAN_MIN * 60_000, Math.max(start + SNAP_MIN * 60_000, raw));
    return { startMs: start, endMs: end, label: drag.plan.task_title, guideMs: magnet !== null && end === magnet ? magnet : null };
  }

  function beginDrag(drag: DragState, event: React.PointerEvent) {
    event.preventDefault(); // 글자 선택 방지
    const origin = { x: event.clientX, y: event.clientY };
    let started = false;
    let last: Ghost | null = null;

    const move = (e: PointerEvent) => {
      if (!started) {
        if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) < 4) return;
        started = true;
        setDragging(true);
        setActionError(null);
        if (drag.kind !== "new") setHiddenPlanId(drag.plan.id);
      }
      // 시간표 위·아래 끝 근처면 자동으로 스크롤
      const scroller = scrollRef.current;
      if (scroller) {
        const r = scroller.getBoundingClientRect();
        if (e.clientY < r.top + 90 && e.clientY > r.top - 40) scroller.scrollTop -= 14;
        else if (e.clientY > r.bottom - 40 && e.clientY < r.bottom + 40) scroller.scrollTop += 14;
      }
      const hit = hitTest(e.clientX, e.clientY);
      if (hit) last = ghostFor(drag, hit);
      else if (drag.kind === "new") last = null; // 시간표 밖에서 놓으면 취소
      setGhost(last);
      setFloating(drag.kind === "new" && !hit ? { x: e.clientX, y: e.clientY, label: drag.task.title } : null);
    };

    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      setFloating(null);
      if (!started) return; // 그냥 누른 것 → 각 요소의 onClick이 처리
      setDragging(false);
      justDragged.current = true;
      window.setTimeout(() => (justDragged.current = false), 0);
      if (!commit || !last) {
        clearPreview();
        return;
      }
      const range = { starts_at: new Date(last.startMs).toISOString(), ends_at: new Date(last.endMs).toISOString() };
      if (drag.kind === "new") {
        createPlan.mutate({ task_id: drag.task.id, ...range });
      } else if (drag.kind === "move") {
        if (range.starts_at === new Date(drag.plan.starts_at).toISOString()) clearPreview();
        else changePlan.mutate({ id: drag.plan.id, ...range });
      } else if (range.ends_at === new Date(drag.plan.ends_at).toISOString()) {
        clearPreview();
      } else {
        changePlan.mutate({ id: drag.plan.id, ends_at: range.ends_at });
      }
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  }

  function startTaskDrag(task: Task, event: React.PointerEvent) {
    beginDrag({ kind: "new", task, minutes: defaultPlanMinutes(task.estimated_minutes) }, event);
  }

  function startPlanDrag(plan: TimePlan, kind: "move" | "resize", event: React.PointerEvent) {
    if (kind === "resize") {
      beginDrag({ kind: "resize", plan }, event);
      return;
    }
    const hit = hitTest(event.clientX, event.clientY);
    const grab = hit ? (at(hit.day, hit.minute) - Date.parse(plan.starts_at)) / 60_000 : 0;
    const minutes = (Date.parse(plan.ends_at) - Date.parse(plan.starts_at)) / 60_000;
    beginDrag({ kind: "move", plan, grabMinutes: grab, minutes }, event);
  }

  // 누르고 배치: 업무를 고른 상태에서 빈 칸을 누르면 그 시각(10분 단위 내림)에 배치
  function handleContentClick(event: React.MouseEvent) {
    if (justDragged.current || !selected || createPlan.isPending) return;
    const hit = hitTest(event.clientX, event.clientY);
    if (!hit) return;
    const minutes = defaultPlanMinutes(selected.estimated_minutes);
    const start = at(hit.day, Math.min(DAY_MINUTES - SNAP_MIN, snapDown(hit.minute)));
    setGhost({ startMs: start, endMs: start + minutes * 60_000, label: selected.title });
    createPlan.mutate({ task_id: selected.id, starts_at: new Date(start).toISOString(), ends_at: new Date(start + minutes * 60_000).toISOString() });
    setSelected(null);
  }

  function selectTask(task: Task) {
    setSelected((current) => (current?.id === task.id ? null : task));
    setPickerOpen(false);
  }

  const step = view === "week" ? 7 : 1;
  const title =
    view === "week"
      ? `${monthLabel.format(days[0])} · ${days[0].getDate()}일 – ${days[6].getMonth() !== days[0].getMonth() ? `${days[6].getMonth() + 1}월 ` : ""}${days[6].getDate()}일`
      : dayLabel.format(days[0]);
  const loadError = plansQuery.error ?? entriesQuery.error;
  const picker = <TaskPicker selectedId={selected?.id ?? null} onSelect={selectTask} onDragStart={startTaskDrag} />;
  const toggleClass = (active: boolean) =>
    `min-h-11 rounded-lg px-3.5 text-sm font-semibold ${active ? "bg-surface text-primary-dark shadow-sm" : "text-muted hover:text-primary-dark"}`;

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => navigate({ date: addDays(anchor, -step) })} className="flex size-11 items-center justify-center rounded-xl border border-border bg-surface text-primary-dark hover:bg-pale-green" aria-label={view === "week" ? "이전 주" : "이전 날"}>
            <ChevronLeft size={20} strokeWidth={2} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => navigate({ date: new Date() })} className="min-h-11 rounded-xl border border-border bg-surface px-3.5 text-sm font-semibold text-primary-dark hover:bg-pale-green">
            오늘
          </button>
          <button type="button" onClick={() => navigate({ date: addDays(anchor, step) })} className="flex size-11 items-center justify-center rounded-xl border border-border bg-surface text-primary-dark hover:bg-pale-green" aria-label={view === "week" ? "다음 주" : "다음 날"}>
            <ChevronRight size={20} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <h2 className="min-w-0 text-lg font-bold text-primary-dark" aria-live="polite">{title}</h2>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-xl bg-pale-green/70 p-1" role="group" aria-label="보기 방식">
            <button type="button" aria-pressed={view === "week"} onClick={() => navigate({ view: "week" })} className={toggleClass(view === "week")}>주간</button>
            <button type="button" aria-pressed={view === "day"} onClick={() => navigate({ view: "day" })} className={toggleClass(view === "day")}>일간</button>
          </div>
          <button type="button" onClick={() => setPickerOpen((v) => !v)} aria-expanded={pickerOpen} aria-controls="calendar-picker" className="flex min-h-11 items-center gap-2 rounded-xl bg-primary px-3.5 text-sm font-semibold text-white hover:bg-primary-dark lg:hidden">
            <ListTodo size={18} strokeWidth={2} aria-hidden="true" />
            업무 배치
          </button>
        </div>
      </div>

      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded border-2 border-dashed border-primary/70 bg-pale-green" aria-hidden="true" />계획</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded bg-primary" aria-hidden="true" />실제 기록</span>
        <span>날짜 아래 숫자: 계획 / 실제 합계</span>
      </p>

      {pickerOpen && (
        <div id="calendar-picker" className="surface-card mt-3 h-[min(60dvh,28rem)] rounded-[20px] p-4 lg:hidden">
          {picker}
        </div>
      )}

      {selected && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-pale-green px-4 py-2.5 text-sm text-primary-dark" role="status">
          <MousePointerClick size={16} strokeWidth={2} className="shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1"><strong className="font-semibold">‘{selected.title}’</strong> 배치할 시간 칸을 누르세요.</span>
          <button
            type="button"
            onClick={() => {
              const start = new Date(days[0].getFullYear(), days[0].getMonth(), days[0].getDate(), 9);
              setPlanDialog({ mode: "create", task: selected, start, minutes: defaultPlanMinutes(selected.estimated_minutes) });
              setSelected(null);
            }}
            className="flex min-h-11 items-center gap-1.5 rounded-xl border border-primary/40 bg-surface px-3 font-semibold hover:bg-pale-green"
          >
            <Clock size={16} strokeWidth={2} aria-hidden="true" />
            시각 입력
          </button>
          <button type="button" onClick={() => setSelected(null)} className="flex size-11 items-center justify-center rounded-xl hover:bg-surface" aria-label="배치 취소">
            <X size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      )}

      {(actionError || loadError) && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800" role="alert">
          <CircleAlert size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
          {actionError ?? "시간표를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."}
        </p>
      )}

      <div className="mt-4 flex gap-4">
        <aside className="surface-card hidden h-[calc(100dvh-15rem)] min-h-[28rem] w-64 shrink-0 rounded-[20px] p-4 lg:block" aria-label="배치할 업무">
          {picker}
        </aside>
        <div className="min-w-0 flex-1 xl:flex xl:gap-4">
          <div className="min-w-0 flex-1">
          <TimeGrid
            days={days}
            plans={plansQuery.data ?? []}
            entries={entriesQuery.data ?? []}
            nowMinute={nowMinute}
            ghost={ghost}
            hiddenPlanId={hiddenPlanId}
            placing={selected !== null}
            dragging={dragging}
            scrollRef={scrollRef}
            contentRef={contentRef}
            onContentClick={handleContentClick}
            onPlanPointerDown={startPlanDrag}
            onPlanOpen={(plan) => !justDragged.current && setPlanDialog({ mode: "edit", plan })}
            onEntryOpen={(entry) => !justDragged.current && setEntryDialog(entry)}
          />
          </div>
          {/* 일간 보기: 오른쪽(좁은 화면은 아래)에 업무별 계획/실제·타이머·메모 */}
          {view === "day" && (
            <aside className="mt-4 xl:mt-0 xl:h-[calc(100dvh-15rem)] xl:min-h-[28rem] xl:w-80 xl:shrink-0 xl:overflow-y-auto" aria-label="이날의 업무와 메모">
              <DayPanel day={days[0]} plans={plansQuery.data ?? []} entries={entriesQuery.data ?? []} nowMinute={nowMinute} />
            </aside>
          )}
        </div>
      </div>

      {floating && (
        <div className="pointer-events-none fixed z-50 max-w-56 truncate rounded-lg border border-primary bg-surface px-3 py-1.5 text-sm font-semibold text-primary-dark shadow-lg" style={{ left: floating.x + 12, top: floating.y + 12 }} aria-hidden="true">
          {floating.label}
        </div>
      )}

      {planDialog?.mode === "edit" && <PlanDialog mode="edit" plan={planDialog.plan} onClose={() => setPlanDialog(null)} />}
      {planDialog?.mode === "create" && (
        <PlanDialog mode="create" task={planDialog.task} start={planDialog.start} minutes={planDialog.minutes} onClose={() => setPlanDialog(null)} />
      )}
      {entryDialog && <EntryEditDialog entry={entryDialog} onClose={() => setEntryDialog(null)} />}
    </>
  );
}
