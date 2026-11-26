import { apiFetch } from "./client";
import type { WorkEvent } from "./events";
import type { Project } from "./projects";
import type { ScheduleBlock } from "./schedule";
import type { Task } from "./tasks";

export type DashboardKpi = {
  total_projects: number; // 보관 제외
  active_projects: number;
  total_tasks: number;
  completed_tasks: number;
  progress: number; // 0–100, 내림
};

export type Dashboard = {
  today: string;
  kpi: DashboardKpi;
  projects: Project[]; // 진행 중, 최대 6개
  today_tasks: Task[]; // 최대 20개
  today_has_more: boolean;
  upcoming_events: WorkEvent[]; // 오늘부터 60일 안, 최대 5개
  today_planned_minutes: number; // 오늘 시간표에 계획한 시간
  today_schedule: ScheduleBlock[]; // 오늘 요일의 반복 블록
};

export const dashboardKeys = {
  all: ["dashboard"] as const,
  detail: (today: string, tz: string) => [...dashboardKeys.all, today, tz] as const,
};

export function getDashboard(today: string, tz: string) {
  const params = new URLSearchParams({ today, tz });
  return apiFetch<Dashboard>(`/dashboard?${params}`);
}
