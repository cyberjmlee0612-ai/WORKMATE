import { apiFetch } from "./client";

export type TaskStatus = "todo" | "in_progress" | "review" | "completed";
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type TaskScope = "all" | "project" | "personal";

export const TASK_STATUSES: TaskStatus[] = ["todo", "in_progress", "review", "completed"];
export const TASK_PRIORITIES: TaskPriority[] = ["urgent", "high", "medium", "low"];

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "할 일",
  in_progress: "진행 중",
  review: "검토",
  completed: "완료",
};

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
export const updateTask = (id: string, input: Partial<TaskInput>) =>
  apiFetch<Task>(`/tasks/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
export const deleteTask = (id: string) => apiFetch<void>(`/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
