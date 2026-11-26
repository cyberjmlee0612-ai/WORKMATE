import { apiFetch } from "./client";

/**
 * 요일별 반복 시간 블록 (2026-11-26 사용자 확정).
 * work: 일·공부 시간(AI 하루 계획이 업무를 넣는 곳), fixed: 수업·고정 일정, break: 쉬는 시간.
 * weekdays: 0=일 … 6=토. 시각 "HH:MM" (끝은 "24:00" 가능).
 */
export type BlockKind = "work" | "fixed" | "break";
export type ScheduleBlock = { id: string; title: string; kind: BlockKind; weekdays: number[]; start: string; end: string };
export type ScheduleBlockInput = Omit<ScheduleBlock, "id">;

export const BLOCK_KINDS: { value: BlockKind; label: string; hint: string }[] = [
  { value: "work", label: "일·공부 시간", hint: "AI가 업무를 배치해요" },
  { value: "fixed", label: "수업·고정 일정", hint: "AI가 피해요" },
  { value: "break", label: "쉬는 시간", hint: "AI가 피해요" },
];
export const BLOCK_TITLE_MAX = 40;
export const MAX_BLOCKS = 50;
export const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

/** 블록이 하나도 없을 때 AI 하루 계획에 쓰는 기본값 */
export const DEFAULT_WINDOWS = [{ start: "09:00", end: "18:00" }];
export const DEFAULT_BLOCKED = [{ start: "12:00", end: "13:00", label: "점심" }];

export const scheduleKeys = { all: ["schedule-blocks"] as const };

export const getScheduleBlocks = () => apiFetch<ScheduleBlock[]>("/schedule-blocks");
/** 전체 바꾸기 (하나라도 잘못되면 아무것도 바뀌지 않는다) */
export const replaceScheduleBlocks = (blocks: ScheduleBlockInput[]) =>
  apiFetch<ScheduleBlock[]>("/schedule-blocks", { method: "PUT", body: JSON.stringify({ blocks }) });

export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** 요일 목록 → "월–금", "매일", "월·수·금" */
export function weekdaysLabel(days: number[]): string {
  const set = [...new Set(days)].sort((a, b) => a - b);
  if (set.length === 7) return "매일";
  if (set.join() === "1,2,3,4,5") return "월–금";
  if (set.join() === "0,6") return "주말";
  return set.map((d) => WEEKDAY_LABELS[d]).join("·");
}
