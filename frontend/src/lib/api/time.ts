import { apiFetch } from "./client";

/** 업무 시간 기록. ended_at이 null이면 진행 중인 타이머 (사용자당 하나). */
export type TimeEntry = {
  id: string;
  task_id: string;
  task_title: string;
  task_status: string;
  project_id: string | null;
  project_name: string | null;
  started_at: string;
  ended_at: string | null;
  source: "timer" | "manual";
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type TimerState = { running: TimeEntry | null; server_now: string };
export type TimerStartResult = { running: TimeEntry; stopped: TimeEntry | null; discarded: boolean; server_now: string };
export type TimerStopResult = { entry: TimeEntry | null; discarded: boolean };

export type TimeEntryInput = { task_id: string; started_at: string; ended_at: string; note: string | null };
export type TimeEntryUpdateInput = Partial<Pick<TimeEntryInput, "started_at" | "ended_at" | "note">>;

/** 12시간 이상 켜 둔 타이머는 멈출 때 실제 끝난 시각을 확인받는다 (서버 규칙과 같음) */
export const LONG_RUNNING_MS = 12 * 60 * 60 * 1000;
export const MAX_ENTRY_MS = 24 * 60 * 60 * 1000;
export const NOTE_MAX = 500;

export type TimeEntryFilters = { task_id?: string; start?: string; end?: string };

/** 시간표에 배치한 계획 블록. 같은 업무를 여러 번 배치할 수 있고 계획끼리는 겹쳐도 된다. */
export type TimePlan = {
  id: string;
  task_id: string;
  task_title: string;
  task_status: string;
  project_id: string | null;
  project_name: string | null;
  starts_at: string;
  ends_at: string;
  created_at: string;
  updated_at: string;
};

export type TimeRange = { start: string; end: string };

export const timeKeys = {
  all: ["time"] as const,
  timer: () => [...timeKeys.all, "timer"] as const,
  entries: (filters: TimeEntryFilters) => [...timeKeys.all, "entries", filters] as const,
  plans: (range: TimeRange) => [...timeKeys.all, "plans", range] as const,
};

/** 날짜별 메모 (시간표 일간 보기). 업무 데이터와 무관하므로 invalidateWorkData 대상(timeKeys)과 분리한다. */
export type DailyNote = { note_date: string; content: string; updated_at: string | null };
export const NOTE_CONTENT_MAX = 5000;
export const noteKeys = { day: (date: string) => ["daily-note", date] as const };
export const getDailyNote = (date: string) => apiFetch<DailyNote>(`/daily-notes/${encodeURIComponent(date)}`);
export const saveDailyNote = (date: string, content: string) =>
  apiFetch<DailyNote>(`/daily-notes/${encodeURIComponent(date)}`, { method: "PUT", body: JSON.stringify({ content }) });

export const listTimePlans = (range: TimeRange) => apiFetch<TimePlan[]>(`/time-plans?${new URLSearchParams(range).toString()}`);
export const createTimePlan = (input: { task_id: string; starts_at: string; ends_at: string }) =>
  apiFetch<TimePlan>("/time-plans", { method: "POST", body: JSON.stringify(input) });
/** 여러 계획을 한 번에 저장 (AI 하루 계획 승인용, 하나라도 실패하면 아무것도 저장되지 않음) */
export const createTimePlansBulk = (plans: { task_id: string; starts_at: string; ends_at: string }[]) =>
  apiFetch<TimePlan[]>("/time-plans/bulk", { method: "POST", body: JSON.stringify({ plans }) });
export const updateTimePlan = (id: string, input: { starts_at?: string; ends_at?: string }) =>
  apiFetch<TimePlan>(`/time-plans/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
export const deleteTimePlan = (id: string) => apiFetch<void>(`/time-plans/${encodeURIComponent(id)}`, { method: "DELETE" });

export const getTimer = () => apiFetch<TimerState>("/timer");
export const startTimer = (taskId: string) =>
  apiFetch<TimerStartResult>("/timer/start", { method: "POST", body: JSON.stringify({ task_id: taskId }) });
export const stopTimer = (endedAt?: string) =>
  apiFetch<TimerStopResult>("/timer/stop", { method: "POST", body: JSON.stringify(endedAt ? { ended_at: endedAt } : {}) });

export function listTimeEntries(filters: TimeEntryFilters) {
  // URLSearchParams가 시각의 '+'를 %2B로 바꿔 준다 (그대로 보내면 공백으로 해석됨)
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  return apiFetch<TimeEntry[]>(`/time-entries?${params.toString()}`);
}

export const createTimeEntry = (input: TimeEntryInput) =>
  apiFetch<TimeEntry>("/time-entries", { method: "POST", body: JSON.stringify(input) });
export const updateTimeEntry = (id: string, input: TimeEntryUpdateInput) =>
  apiFetch<TimeEntry>(`/time-entries/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
export const deleteTimeEntry = (id: string) => apiFetch<void>(`/time-entries/${encodeURIComponent(id)}`, { method: "DELETE" });

/** 409 응답의 code (overlap, task_closed, timer_needs_review, no_running_timer, concurrent_change) */
export function conflictCode(body: unknown): string | null {
  return typeof body === "object" && body !== null && "code" in body && typeof body.code === "string" ? body.code : null;
}

export function overlapConflict(body: unknown): TimeEntry | null {
  if (conflictCode(body) !== "overlap") return null;
  const conflict = (body as { conflict?: TimeEntry }).conflict;
  return conflict ?? null;
}
