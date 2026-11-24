import { apiFetch } from "./client";

export type ProjectStatus = "planning" | "in_progress" | "review" | "completed" | "archived";
/** 폼에서 직접 고를 수 있는 상태. completed/archived는 완료·보관 흐름(P1)에서만 바꾼다. */
export type EditableProjectStatus = "planning" | "in_progress" | "review";

export const EDITABLE_PROJECT_STATUSES: EditableProjectStatus[] = ["planning", "in_progress", "review"];

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  planning: "계획",
  in_progress: "진행 중",
  review: "검토",
  completed: "완료",
  archived: "보관",
};

export function isEditableStatus(status: ProjectStatus): status is EditableProjectStatus {
  return (EDITABLE_PROJECT_STATUSES as string[]).includes(status);
}

export type Project = {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  start_date: string | null; // "YYYY-MM-DD"
  due_date: string | null;
  created_at: string;
  updated_at: string;
  total_tasks: number; // 제외된 업무는 빠진 수
  completed_tasks: number;
  cancelled_tasks: number;
  progress: number; // 0–100 정수(내림)
};

export type ProjectInput = {
  name: string;
  description: string | null;
  status?: EditableProjectStatus;
  start_date: string | null;
  due_date: string | null;
};

export const projectKeys = {
  all: ["projects"] as const,
  list: () => [...projectKeys.all, "list"] as const,
  detail: (id: string) => [...projectKeys.all, "detail", id] as const,
};

export const listProjects = () => apiFetch<Project[]>("/projects");
export const getProject = (id: string) => apiFetch<Project>(`/projects/${encodeURIComponent(id)}`);
export const createProject = (input: ProjectInput) =>
  apiFetch<Project>("/projects", { method: "POST", body: JSON.stringify(input) });
export const updateProject = (id: string, input: Partial<ProjectInput>) =>
  apiFetch<Project>(`/projects/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
