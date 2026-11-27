import { apiFetch } from "./client";

/** 집중 모드 기록 (2026-11-27 사용자 확정). 카운트다운·휴식은 화면이 관리하고 서버는 집중 한 번과 방해만 기록한다. */
export type FocusReason = "message" | "call" | "thought" | "noise" | "other";
export type FocusSession = {
  id: string;
  task_id: string | null;
  focus_minutes: number;
  started_at: string;
  ended_at: string | null;
  completed: boolean;
  interruptions: number;
};
export type FocusStats = {
  sessions: number;
  completed: number;
  focus_minutes: number;
  interruptions: number;
  by_reason: { reason: FocusReason | null; count: number }[];
};

export const FOCUS_REASONS: { value: FocusReason; label: string }[] = [
  { value: "message", label: "메시지·알림" },
  { value: "call", label: "전화·말 걸기" },
  { value: "thought", label: "떠오른 생각" },
  { value: "noise", label: "주변 소음" },
  { value: "other", label: "기타" },
];
export const reasonLabel = (r: FocusReason | null) => FOCUS_REASONS.find((x) => x.value === r)?.label ?? "이유 없음";

export const focusKeys = { stats: (start: string, end: string, tz: string) => ["focus", "stats", start, end, tz] as const };

export const startFocus = (taskId: string | null, minutes: number) =>
  apiFetch<FocusSession>("/focus/sessions", { method: "POST", body: JSON.stringify({ task_id: taskId, focus_minutes: minutes }) });
export const finishFocus = (id: string, completed: boolean) =>
  apiFetch<FocusSession>(`/focus/sessions/${encodeURIComponent(id)}/finish`, { method: "POST", body: JSON.stringify({ completed }) });
export const interruptFocus = (id: string, reason: FocusReason | null) =>
  apiFetch<FocusSession>(`/focus/sessions/${encodeURIComponent(id)}/interruptions`, { method: "POST", body: JSON.stringify({ reason }) });
export const getFocusStats = (start: string, end: string, tz: string) =>
  apiFetch<FocusStats>(`/focus/stats?${new URLSearchParams({ start, end, tz }).toString()}`);
