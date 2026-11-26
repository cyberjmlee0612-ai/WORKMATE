import { apiFetch } from "./client";
import type { AiUsage } from "./ai";

/** 기간 합계. 경계에 걸친 기록·계획은 기간 안에 든 부분만 센다 (진행 중 타이머는 지금까지). */
export type ReportTotals = {
  tracked_minutes: number;
  planned_minutes: number;
  completed_tasks: number;
  active_days: number; // 기록이 있는 날 수
  due_settled: number; // 마감일이 기간 안이고 완료했거나 마감이 지난 업무
  due_on_time: number; // 그중 마감일까지 완료
  due_overdue: number; // 마감이 지났는데 아직 미완료
};

export type ReportDay = { day: string; tracked_minutes: number; planned_minutes: number; completed_tasks: number };

/** tracked/planned는 하위 프로젝트 포함 합산, own_*는 그 프로젝트 자체 업무만 */
export type ReportProject = {
  id: string;
  name: string;
  parent_id: string | null;
  status: string;
  own_tracked_minutes: number;
  own_planned_minutes: number;
  tracked_minutes: number;
  planned_minutes: number;
};

export type ReportTopTask = { task_id: string; title: string; status: string; project_path: string | null; tracked_minutes: number; planned_minutes: number };
export type EstimateItem = { task_id: string; title: string; project_path: string | null; estimated_minutes: number; tracked_minutes: number };

export type Report = {
  start: string;
  end: string;
  previous: ReportTotals & { start: string; end: string };
  summary: ReportTotals;
  daily: ReportDay[];
  projects: ReportProject[];
  personal: { tracked_minutes: number; planned_minutes: number };
  top_tasks: ReportTopTask[];
  estimates: { items: EstimateItem[]; measured_count: number; unmeasured_count: number; estimated_total: number; tracked_total: number };
};

export type ReportReview = { headline: string; good: string[]; improve: string[]; suggestions: string[]; usage: AiUsage };

export const REPORT_MAX_DAYS = 92;

export const reportKeys = {
  all: ["report"] as const,
  detail: (start: string, end: string, tz: string) => [...reportKeys.all, start, end, tz] as const,
};

export const getReport = (start: string, end: string, tz: string) =>
  apiFetch<Report>(`/reports?${new URLSearchParams({ start, end, tz }).toString()}`);

/** AI 회고 (저장하지 않음, 하루 AI 사용 한도를 함께 쓴다) */
export const requestReportReview = (input: { start: string; end: string; tz: string }) =>
  apiFetch<ReportReview>("/ai/report-review", { method: "POST", body: JSON.stringify(input) });
