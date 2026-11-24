import { apiFetch } from "./client";
import type { Project } from "./projects";
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
};

export const dashboardKeys = {
  all: ["dashboard"] as const,
  detail: (today: string, tz: string) => [...dashboardKeys.all, today, tz] as const,
};

export function getDashboard(today: string, tz: string) {
  const params = new URLSearchParams({ today, tz });
  return apiFetch<Dashboard>(`/dashboard?${params}`);
}
