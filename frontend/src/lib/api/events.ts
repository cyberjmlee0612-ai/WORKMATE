import { apiFetch } from "./client";

/** 이벤트 날짜 (시험·발표·출품/전시·마감·기타). 프로젝트에 달거나 개인 이벤트. 시각이 없으면 종일. */
export type EventKind = "exam" | "presentation" | "exhibition" | "deadline" | "other";
export type WorkEvent = {
  id: string;
  project_id: string | null;
  project_path: string | null;
  title: string;
  kind: EventKind;
  event_date: string; // YYYY-MM-DD
  start_time: string | null; // HH:MM
  end_time: string | null;
  note: string | null;
};
export type EventInput = {
  title: string;
  kind: EventKind;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  project_id: string | null;
  note: string | null;
};

export const EVENT_KINDS: { value: EventKind; label: string; badge: string }[] = [
  { value: "exam", label: "시험", badge: "border-rose-300 bg-rose-50 text-rose-900" },
  { value: "presentation", label: "발표", badge: "border-sky-300 bg-sky-50 text-sky-900" },
  { value: "exhibition", label: "출품·전시", badge: "border-violet-300 bg-violet-50 text-violet-900" },
  { value: "deadline", label: "마감", badge: "border-amber-300 bg-amber-50 text-amber-900" },
  { value: "other", label: "기타", badge: "border-soft-sage bg-pale-green text-primary-dark" },
];
export const eventKind = (kind: EventKind) => EVENT_KINDS.find((k) => k.value === kind) ?? EVENT_KINDS[4];
export const EVENT_TITLE_MAX = 100;
export const EVENT_NOTE_MAX = 500;

export type EventFilters = { start?: string; end?: string; project_id?: string };
export const eventKeys = {
  all: ["events"] as const,
  list: (filters: EventFilters) => [...eventKeys.all, filters] as const,
};

export function listEvents(filters: EventFilters) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
  return apiFetch<WorkEvent[]>(`/events?${params.toString()}`);
}
export const createEvent = (input: EventInput) => apiFetch<WorkEvent>("/events", { method: "POST", body: JSON.stringify(input) });
export const updateEvent = (id: string, input: Partial<EventInput>) =>
  apiFetch<WorkEvent>(`/events/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
export const deleteEvent = (id: string) => apiFetch<void>(`/events/${encodeURIComponent(id)}`, { method: "DELETE" });
