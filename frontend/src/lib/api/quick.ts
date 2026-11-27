import { apiFetch } from "./client";
import type { EventKind } from "./events";
import type { RoutineFreq, RoutineMode } from "./routines";
import type { TaskPriority } from "./tasks";

/** 빠른 입력 해석 결과 (저장 전 미리보기, 화면에서 고칠 수 있다) — 2026-11-27 사용자 확정 */
export type QuickKind = "task" | "event" | "routine";
export type QuickDraft = {
  kind: QuickKind;
  title: string;
  date: string | null;
  start: string | null; // HH:MM
  end: string | null;
  duration: number | null; // 분
  priority: TaskPriority | null;
  project_id: string | null;
  project_name: string | null;
  project_query: string | null; // #태그를 썼는데 맞는 프로젝트가 없을 때
  event_kind: EventKind | null;
  mode: RoutineMode;
  freq: RoutineFreq | null;
  weekdays: number[];
  every_weeks: number;
  month_day: number | null;
  interval_days: number | null;
  matched: string[];
};
export type SearchResult = {
  tasks: { id: string; title: string; status: string; due_date: string | null; project_path: string | null }[];
  projects: { id: string; name: string; status: string }[];
  events: { id: string; title: string; kind: EventKind; event_date: string }[];
};

export const QUICK_TEXT_MAX = 300;

export const parseQuick = (text: string, tz: string) => apiFetch<QuickDraft>("/quick/parse", { method: "POST", body: JSON.stringify({ text, tz }) });
export const aiParseQuick = (text: string, tz: string) => apiFetch<QuickDraft>("/quick/ai-parse", { method: "POST", body: JSON.stringify({ text, tz }) });
export const createQuick = (d: QuickDraft, tz: string) =>
  apiFetch<{ kind: QuickKind; id: string; title: string; message: string }>("/quick/create", {
    method: "POST",
    body: JSON.stringify({
      kind: d.kind, title: d.title, date: d.date, start: d.start, end: d.end, duration: d.duration, priority: d.priority,
      project_id: d.project_id, event_kind: d.event_kind, mode: d.mode, freq: d.freq, weekdays: d.weekdays,
      every_weeks: d.every_weeks, month_day: d.month_day, interval_days: d.interval_days, tz,
    }),
  });
export const searchAll = (q: string) => apiFetch<SearchResult>(`/search?${new URLSearchParams({ q }).toString()}`);

/** 사이드바 버튼 등에서 입력창 열기 */
export const QUICK_OPEN_EVENT = "workmate:quick-open";
export const openQuick = () => window.dispatchEvent(new Event(QUICK_OPEN_EVENT));
