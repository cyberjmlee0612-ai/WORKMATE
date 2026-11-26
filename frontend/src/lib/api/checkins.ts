import { apiFetch } from "./client";
import type { Task } from "./tasks";

/**
 * 아침 체크인 / 저녁 마무리 (2026-11-26 사용자 확정).
 * outcome: done(완료) / retry(내일 다시) / postponed(마감일 미룸) / kept(그대로) — 저녁 마무리에서 정한다.
 */
export type FocusOutcome = "done" | "retry" | "postponed" | "kept";
export type FocusItem = { position: number; outcome: FocusOutcome | null; task: Task };
export type Checkin = {
  date: string;
  focus: FocusItem[];
  review: { mood: number | null; note: string | null } | null;
  suggestions: { reason: string; task: Task }[];
};
export type OutcomeInput = { task_id: string; outcome: "retry" | "postponed" | "kept"; due_date?: string | null };
export type PlacementBlock = { task_id: string; task_title: string; starts_at: string; ends_at: string };

export const MAX_FOCUS = 3;
export const REVIEW_NOTE_MAX = 500;
export const MOODS = [
  { value: 1, emoji: "😣", label: "힘들었어요" },
  { value: 2, emoji: "😕", label: "아쉬워요" },
  { value: 3, emoji: "🙂", label: "보통이에요" },
  { value: 4, emoji: "😊", label: "좋았어요" },
  { value: 5, emoji: "🤩", label: "최고였어요" },
];

export const checkinKeys = {
  all: ["checkin"] as const,
  day: (date: string) => [...checkinKeys.all, date] as const,
};

const base = (date: string) => `/checkins/${encodeURIComponent(date)}`;
export const getCheckin = (date: string) => apiFetch<Checkin>(base(date));
export const saveFocus = (date: string, taskIds: string[]) =>
  apiFetch<Checkin>(`${base(date)}/focus`, { method: "PUT", body: JSON.stringify({ task_ids: taskIds }) });
export const saveReview = (date: string, input: { mood: number | null; note: string | null; outcomes: OutcomeInput[] }) =>
  apiFetch<Checkin>(`${base(date)}/review`, { method: "POST", body: JSON.stringify(input) });
export const getPlacement = (date: string, tz: string) =>
  apiFetch<{ blocks: PlacementBlock[]; unplaced: string[] }>(`${base(date)}/placement?${new URLSearchParams({ tz }).toString()}`);
