import { apiFetch } from "./client";
import type { Task, TaskInput, TaskPriority } from "./tasks";

/** AI 사용 가능 여부와 오늘 사용량 (사용자 시간대 기준, 하루 한도) */
export type AiUsage = { configured: boolean; provider: string; model: string | null; used: number; limit: number; remaining: number };

/** AI가 제안한 업무. 저장되지 않은 상태이며, 사용자가 고치고 고른 것만 저장한다. */
export type SuggestedTask = {
  title: string;
  description: string | null;
  priority: TaskPriority;
  estimated_minutes: number | null;
  due_date: string | null;
};

/** project_name: 이 제안을 새 프로젝트로 저장할 때 미리 채울 이름 (비어 있을 수 있음) */
export type BreakdownResult = { summary: string; project_name: string; tasks: SuggestedTask[]; usage: AiUsage };

export const AI_TEXT_MAX = 2000;
export const BULK_CREATE_MAX = 30;

export const aiKeys = { usage: (tz: string) => ["ai", "usage", tz] as const };

export const getAiUsage = (tz: string) => apiFetch<AiUsage>(`/ai/usage?${new URLSearchParams({ tz }).toString()}`);
export const requestBreakdown = (input: { text: string; project_id: string | null; tz: string }) =>
  apiFetch<BreakdownResult>("/ai/breakdown", { method: "POST", body: JSON.stringify(input) });

/** AI 하루 계획 제안 (저장하지 않음). 시각은 "HH:MM", 쉬는 시간은 둘 다 null이면 없음 */
export type DayPlanInput = {
  date: string; // YYYY-MM-DD
  tz: string;
  work_start: string;
  work_end: string;
  lunch_start: string | null;
  lunch_end: string | null;
  note: string | null;
};
export type DayPlanBlock = { task_id: string; task_title: string; project_path: string | null; starts_at: string; ends_at: string; reason: string };
export type DayPlanResult = { summary: string; blocks: DayPlanBlock[]; usage: AiUsage };
export const requestDayPlan = (input: DayPlanInput) =>
  apiFetch<DayPlanResult>("/ai/day-plan", { method: "POST", body: JSON.stringify(input) });

/**
 * 여러 업무를 한 번에 저장 (하나라도 실패하면 아무것도 저장되지 않는다).
 * newProject를 주면 그 프로젝트를 만들고 모든 업무를 거기에 넣는다 (업무의 project_id는 null로).
 */
export const createTasksBulk = (tasks: TaskInput[], newProject?: { name: string }) =>
  apiFetch<Task[]>("/tasks/bulk", { method: "POST", body: JSON.stringify(newProject ? { tasks, new_project: newProject } : { tasks }) });
