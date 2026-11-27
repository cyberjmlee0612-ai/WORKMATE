"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Flame, ListChecks, LoaderCircle } from "lucide-react";
import { checkHabit, listRoutines, routineKeys, type Routine } from "@/lib/api/routines";
import { useToday, userTimeZone } from "@/lib/date";

/** 습관 체크 버튼 (오늘) */
export function HabitCheck({ routine }: { routine: Routine }) {
  const queryClient = useQueryClient();
  const today = useToday();
  const mutation = useMutation({
    mutationFn: () => checkHabit(routine.id, today!, !routine.checked_today, userTimeZone()),
    onSuccess: (updated) => queryClient.setQueryData<Routine[]>(routineKeys.all, (cur) => cur?.map((r) => (r.id === updated.id ? updated : r))),
  });
  if (!routine.occurs_today) return <span className="size-9 shrink-0" aria-hidden="true" />;
  return (
    <button
      type="button"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending || !today}
      aria-pressed={routine.checked_today}
      aria-label={`${routine.title} ${routine.checked_today ? "체크 해제" : "오늘 했어요"}`}
      className={`flex size-9 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${routine.checked_today ? "border-primary bg-primary text-white" : "border-soft-sage text-transparent hover:border-primary hover:text-primary/40"}`}
    >
      {mutation.isPending ? <LoaderCircle size={16} strokeWidth={2} className="animate-spin text-primary" aria-hidden="true" /> : <Check size={18} strokeWidth={3} aria-hidden="true" />}
    </button>
  );
}

/** 최근 7일: 반복 날이면 체크 여부를 점으로 (반복 날이 아니면 흐린 점) */
export function RecentDots({ routine }: { routine: Routine }) {
  return (
    <span className="mt-1 flex gap-1" aria-label={`최근 7일 중 ${routine.recent.filter((d) => d.checked).length}번 했어요`}>
      {routine.recent.map((d) => (
        <span key={d.date} title={d.date} className={`size-2 rounded-full ${!d.due ? "bg-border" : d.checked ? "bg-primary" : "bg-soft-sage/60 ring-1 ring-soft-sage"}`} aria-hidden="true" />
      ))}
    </span>
  );
}

/**
 * 대시보드 '나의 하루'의 오늘 습관 카드 (2026-11-27 사용자 확정). 오늘 반복하는 습관만, 체크와 연속 기록.
 * 습관이 하나도 없으면 작은 안내만 보여 준다.
 */
export function HabitsCard() {
  const [tz] = useState(userTimeZone);
  const query = useQuery({ queryKey: routineKeys.all, queryFn: () => listRoutines(tz) });
  const habits = (query.data ?? []).filter((r) => r.mode === "habit" && r.active && r.occurs_today);
  if (!query.data) return null;
  if (habits.length === 0) {
    return query.data.some((r) => r.mode === "habit") ? null : (
      <p className="mt-6 text-sm text-muted">
        <ListChecks size={16} strokeWidth={2} className="mr-1 inline align-[-3px]" aria-hidden="true" />
        반복되는 일이나 습관이 있나요? <Link href="/routines" className="font-semibold text-primary hover:underline">반복·습관 만들기</Link>
      </p>
    );
  }
  const done = habits.filter((h) => h.checked_today).length;

  return (
    <section className="mt-6 rounded-[20px] border border-soft-sage bg-surface p-4 shadow-[var(--card-shadow)] md:p-5" aria-labelledby="habits-today-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="habits-today-heading" className="flex items-center gap-2 text-lg font-bold text-primary-dark">
          <ListChecks size={20} strokeWidth={2} aria-hidden="true" />
          오늘의 습관 <span className="text-sm font-semibold text-muted">{done}/{habits.length}</span>
        </h2>
        <Link href="/routines" className="min-h-11 content-center text-sm font-semibold text-primary hover:underline">관리</Link>
      </div>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {habits.map((h) => (
          <li key={h.id} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2">
            <HabitCheck routine={h} />
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-sm font-semibold ${h.checked_today ? "text-muted line-through" : "text-primary-dark"}`}>{h.title}</span>
              <RecentDots routine={h} />
            </span>
            {h.streak > 0 && (
              <span className="flex items-center gap-0.5 text-sm font-bold text-amber-700" title={`${h.streak}번 연속`}>
                <Flame size={16} strokeWidth={2} aria-hidden="true" />
                {h.streak}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
