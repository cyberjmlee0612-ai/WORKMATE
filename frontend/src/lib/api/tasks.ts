import { apiFetch } from "./client";

/** cancelled = 업무에서 제외. 삭제와 달리 보존되며 KPI·진행률 계산에서 빠진다. */
export type TaskStatus = "todo" | "in_progress" | "review" | "completed" | "cancelled";
export type ActiveTaskStatus = Exclude<TaskStatus, "cancelled">;
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type TaskScope = "all" | "project" | "personal";

/** 진행 상황으로 고를 수 있는 상태 (제외는 별도 동작) */
export const TASK_STATUSES: ActiveTaskStatus[] = ["todo", "in_progress", "review", "completed"];
/** 목록 필터용: 제외됨 포함 */
export const TASK_FILTER_STATUSES: TaskStatus[] = [...TASK_STATUSES, "cancelled"];
export const TASK_PRIORITIES: TaskPriority[] = ["urgent", "high", "medium", "low"];

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "할 일",
  in_progress: "진행 중",
  review: "검토",
  completed: "완료",
  cancelled: "제외됨",
};

export const CANCEL_REASON_MAX = 500;

export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  urgent: "긴급",
  high: "높음",
  medium: "보통",
  low: "낮음",
};

export const ESTIMATED_MINUTES_MAX = 10_000;

export type Task = {
  id: string;
  project_id: string | null; // null이면 개인 업무
  project_name: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null; // "YYYY-MM-DD"
  estimated_minutes: number | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  /** 실제 기록 시간 합계(분, 끝난 기록만). 진행 중인 타이머는 포함하지 않는다. */
  tracked_minutes: number;
  /** 시간표에 배치한 계획 시간 합계(분) */
  planned_minutes: number;
  created_at: string;
  updated_at: string;
};

export type TaskInput = {
  title: string;
  description: string | null;
  project_id: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  estimated_minutes: number | null;
};

export type TaskFilters = {
  scope?: TaskScope;
  project_id?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
};

export const taskKeys = {
  all: ["tasks"] as const,
  list: (filters: TaskFilters) => [...taskKeys.all, "list", filters] as const,
};

export function listTasks(filters: TaskFilters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return apiFetch<Task[]>(`/tasks${query ? `?${query}` : ""}`);
}

export const createTask = (input: TaskInput) => apiFetch<Task>("/tasks", { method: "POST", body: JSON.stringify(input) });
export type TaskUpdateInput = Partial<TaskInput> & { cancel_reason?: string | null };

export const updateTask = (id: string, input: TaskUpdateInput) =>
  apiFetch<Task>(`/tasks/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
export const deleteTask = (id: string) => apiFetch<void>(`/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
