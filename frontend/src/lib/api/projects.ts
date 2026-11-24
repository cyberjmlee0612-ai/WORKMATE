import { apiFetch } from "./client";
import type { Task } from "./tasks";

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

// ---- 프로젝트 삭제 (PRD: A 개인 업무로 이동 / B 취소 / C 함께 삭제) ----

export type DeletionPreview = { project_id: string; project_name: string; tasks: Task[] };

/** move = A(선택한 업무는 개인 업무로 이동, 나머지 삭제), delete = C(업무도 모두 삭제) */
export type DeletionMode = "move" | "delete";

export type ProjectDeleteInput = {
  mode: DeletionMode;
  /** 사용자가 확인한 소속 업무 ID 전체. 서버 목록과 다르면 409 */
  expected_task_ids: string[];
  keep_task_ids: string[];
};

export type ProjectDeleteResult = { moved_tasks: number; deleted_tasks: number };

/** 409 응답 본문: 다른 곳에서 업무가 바뀜 → 최신 목록으로 다시 확인 */
export type TasksChangedBody = { detail: string; code: "tasks_changed"; tasks: Task[] };

export function isTasksChanged(body: unknown): body is TasksChangedBody {
  return typeof body === "object" && body !== null && (body as { code?: unknown }).code === "tasks_changed";
}

export const getDeletionPreview = (id: string) =>
  apiFetch<DeletionPreview>(`/projects/${encodeURIComponent(id)}/deletion-preview`);

export const deleteProject = (id: string, input: ProjectDeleteInput) =>
  apiFetch<ProjectDeleteResult>(`/projects/${encodeURIComponent(id)}/delete`, { method: "POST", body: JSON.stringify(input) });
