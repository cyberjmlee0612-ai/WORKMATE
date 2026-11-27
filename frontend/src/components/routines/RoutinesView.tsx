"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Flame, ListChecks, Pencil, Plus, Repeat } from "lucide-react";
import { EmptyState, ErrorState } from "@/components/common/QueryStates";
import { listRoutines, routineKeys, ruleLabel, type Routine, type RoutineMode } from "@/lib/api/routines";
import { formatDate, formatMinutes } from "@/lib/format";
import { useToday, userTimeZone } from "@/lib/date";
import { HabitCheck, RecentDots } from "./HabitsCard";
import { RoutineFormDialog } from "./RoutineFormDialog";

/** 반복 업무·습관 관리 화면 (2026-11-27 사용자 확정) */
export function RoutinesView() {
  const today = useToday();
  const [tz] = useState(userTimeZone);
  const query = useQuery({ queryKey: routineKeys.all, queryFn: () => listRoutines(tz) });
  const [dialog, setDialog] = useState<{ routine?: Routine; mode?: RoutineMode } | null>(null);

  if (query.isError) return <div className="mt-6"><ErrorState message={query.error.message} onRetry={() => query.refetch()} retrying={query.isRefetching} /></div>;
  if (!query.data || !today) return <div className="mt-6 h-64 animate-pulse rounded-[20px] bg-pale-green/40" aria-busy="true" aria-label="불러오는 중" />;

  const tasks = query.data.filter((r) => r.mode === "task");
  const habits = query.data.filter((r) => r.mode === "habit");

  return (
    <>
      <div className="mt-6 flex flex-wrap gap-2">
        <button type="button" onClick={() => setDialog({ mode: "task" })} className="flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark">
          <Plus size={18} strokeWidth={2} aria-hidden="true" />
          반복 업무
        </button>
        <button type="button" onClick={() => setDialog({ mode: "habit" })} className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-primary-dark hover:bg-pale-green">
          <Plus size={18} strokeWidth={2} aria-hidden="true" />
          습관
        </button>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section className="surface-card rounded-[20px] p-4 md:p-5" aria-labelledby="routine-tasks-heading">
          <h2 id="routine-tasks-heading" className="flex items-center gap-2 text-lg font-bold text-primary-dark"><Repeat size={20} strokeWidth={2} aria-hidden="true" />반복 업무</h2>
          <p className="mt-1 text-sm text-muted">반복하는 날마다 그날 업무로 만들어져요. 하지 못하고 지나간 날은 &lsquo;건너뜀&rsquo;으로 정리돼요.</p>
          {tasks.length === 0 ? (
            <div className="mt-4"><EmptyState icon={Repeat} title="반복 업무가 없어요" description="주간 보고서, 매일 메일 정리처럼 반복되는 일을 넣어 보세요." /></div>
          ) : (
            <ul className="mt-3 divide-y divide-border">{tasks.map((r) => <RoutineRow key={r.id} routine={r} onEdit={() => setDialog({ routine: r })} />)}</ul>
          )}
        </section>
        <section className="surface-card rounded-[20px] p-4 md:p-5" aria-labelledby="habits-heading">
          <h2 id="habits-heading" className="flex items-center gap-2 text-lg font-bold text-primary-dark"><ListChecks size={20} strokeWidth={2} aria-hidden="true" />습관</h2>
          <p className="mt-1 text-sm text-muted">체크만 하면 돼요. 7일 전까지는 지난 날도 체크할 수 있어요.</p>
          {habits.length === 0 ? (
            <div className="mt-4"><EmptyState icon={ListChecks} title="습관이 없어요" description="물 마시기, 스트레칭처럼 꾸준히 하고 싶은 일을 넣어 보세요." /></div>
          ) : (
            <ul className="mt-3 divide-y divide-border">{habits.map((r) => <RoutineRow key={r.id} routine={r} onEdit={() => setDialog({ routine: r })} />)}</ul>
          )}
        </section>
      </div>

      {dialog && <RoutineFormDialog routine={dialog.routine} defaultMode={dialog.mode} today={today} onClose={() => setDialog(null)} />}
    </>
  );
}

function RoutineRow({ routine: r, onEdit }: { routine: Routine; onEdit: () => void }) {
  const today = useToday();
  return (
    <li className={`flex items-center gap-3 py-3 ${r.active ? "" : "opacity-55"}`}>
      {r.mode === "habit" && r.active && <HabitCheck routine={r} />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-primary-dark">{r.title}</p>
        <p className="truncate text-xs text-muted">
          {r.active ? ruleLabel(r) : "멈춤"}
          {r.start_time && ` · ${r.start_time}–${r.end_time}`}
          {r.mode === "task" && r.estimated_minutes ? ` · ${formatMinutes(r.estimated_minutes)}` : ""}
          {r.mode === "task" && ` · ${r.project_path ?? "개인 업무"}`}
          {r.active && r.next_date && r.next_date !== today && ` · 다음 ${formatDate(r.next_date)}`}
        </p>
        {r.mode === "habit" && <RecentDots routine={r} />}
      </div>
      {r.mode === "habit" && r.streak > 0 && (
        <span className="flex shrink-0 items-center gap-0.5 text-sm font-bold text-amber-700" title={`${r.streak}번 연속`}>
          <Flame size={16} strokeWidth={2} aria-hidden="true" />
          {r.streak}
        </span>
      )}
      {r.mode === "task" && r.occurs_today && r.active && <span className="shrink-0 rounded-lg bg-pale-green px-2 py-1 text-xs font-semibold text-primary-dark">오늘</span>}
      <button type="button" onClick={onEdit} className="flex size-10 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-pale-green hover:text-primary-dark" aria-label={`${r.title} 고치기`}>
        <Pencil size={16} strokeWidth={2} aria-hidden="true" />
      </button>
    </li>
  );
}
