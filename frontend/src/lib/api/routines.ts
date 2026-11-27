import { apiFetch } from "./client";
import type { TaskPriority } from "./tasks";
import { WEEKDAY_LABELS } from "./schedule";

/**
 * 반복 업무 · 습관 (2026-11-27 사용자 확정).
 * mode task: 반복하는 날마다 그날 업무를 만들어 준다(시각을 정하면 계획 블록도). 하지 않고 지나간 것은 '건너뜀'.
 * mode habit: 체크만, 연속 기록.
 */
export type RoutineMode = "task" | "habit";
export type RoutineFreq = "daily" | "weekly" | "monthly" | "interval";
export type Routine = {
  id: string;
  title: string;
  mode: RoutineMode;
  project_id: string | null;
  project_path: string | null;
  priority: TaskPriority;
  estimated_minutes: number | null;
  freq: RoutineFreq;
  weekdays: number[]; // 0=일 … 6=토
  every_weeks: number;
  month_day: number | null;
  interval_days: number | null;
  start_date: string;
  start_time: string | null;
  end_time: string | null;
  active: boolean;
  occurs_today: boolean;
  next_date: string | null;
  checked_today: boolean;
  streak: number;
  recent: { date: string; due: boolean; checked: boolean }[]; // 최근 7일 (오래된 순)
};
export type RoutineInput = Omit<Routine, "id" | "project_path" | "occurs_today" | "next_date" | "checked_today" | "streak" | "recent">;

export const ROUTINE_TITLE_MAX = 100;
export const routineKeys = { all: ["routines"] as const };

const tzQuery = (tz: string) => `?${new URLSearchParams({ tz }).toString()}`;
export const listRoutines = (tz: string) => apiFetch<Routine[]>(`/routines${tzQuery(tz)}`);
export const createRoutine = (input: RoutineInput, tz: string) =>
  apiFetch<Routine>(`/routines${tzQuery(tz)}`, { method: "POST", body: JSON.stringify(input) });
export const updateRoutine = (id: string, input: RoutineInput, tz: string) =>
  apiFetch<Routine>(`/routines/${encodeURIComponent(id)}${tzQuery(tz)}`, { method: "PATCH", body: JSON.stringify(input) });
export const deleteRoutine = (id: string) => apiFetch<void>(`/routines/${encodeURIComponent(id)}`, { method: "DELETE" });
export const checkHabit = (id: string, date: string, checked: boolean, tz: string) =>
  apiFetch<Routine>(`/routines/${encodeURIComponent(id)}/check`, { method: "POST", body: JSON.stringify({ date, checked, tz }) });
export const materializeRoutines = (tz: string) =>
  apiFetch<{ created: number; skipped: number }>("/routines/materialize", { method: "POST", body: JSON.stringify({ tz }) });

/** 반복 규칙 → "매일", "월·수·금", "격주 월요일", "매월 15일", "3일마다" */
export function ruleLabel(r: Pick<Routine, "freq" | "weekdays" | "every_weeks" | "month_day" | "interval_days">): string {
  if (r.freq === "daily") return "매일";
  if (r.freq === "monthly") return r.month_day === 31 ? "매월 말일" : `매월 ${r.month_day}일`;
  if (r.freq === "interval") return `${r.interval_days}일마다`;
  const days = [...r.weekdays].sort((a, b) => a - b);
  const label = days.join() === "1,2,3,4,5" ? "평일" : days.join() === "0,6" ? "주말" : days.length === 7 ? "매일" : days.map((d) => WEEKDAY_LABELS[d]).join("·");
  const every = r.every_weeks === 1 ? "" : r.every_weeks === 2 ? "격주 " : `${r.every_weeks}주마다 `;
  return `${every}${label}${days.length === 1 && !every ? "요일마다" : ""}`;
}
