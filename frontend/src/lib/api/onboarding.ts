import { apiFetch } from "./client";
import type { ScheduleBlockInput } from "./schedule";

/** 처음 사용자 안내 (2026-11-27 사용자 확정). 단계 완료는 실제 데이터로 판단한다. */
export type OnboardingState = "wizard" | "checklist" | "done";
export type Onboarding = {
  state: OnboardingState | null;
  steps: { schedule: boolean; task: boolean; plan: boolean };
  show_wizard: boolean;
  show_checklist: boolean;
};

export const onboardingKeys = { all: ["onboarding"] as const };
export const getOnboarding = () => apiFetch<Onboarding>("/onboarding");
export const setOnboarding = (state: OnboardingState) => apiFetch<Onboarding>("/onboarding", { method: "POST", body: JSON.stringify({ state }) });

const WEEKDAYS = [1, 2, 3, 4, 5];
const EVERYDAY = [0, 1, 2, 3, 4, 5, 6];

/** 1단계 시간표 유형 — 고르면 채워지고 시각만 고쳐서 저장한다 */
export const SCHEDULE_TEMPLATES: { key: string; label: string; hint: string; blocks: ScheduleBlockInput[] }[] = [
  {
    key: "worker",
    label: "직장인",
    hint: "평일 9–18시, 점심 1시간",
    blocks: [
      { title: "일하는 시간", kind: "work", weekdays: WEEKDAYS, start: "09:00", end: "18:00" },
      { title: "점심", kind: "break", weekdays: WEEKDAYS, start: "12:00", end: "13:00" },
    ],
  },
  {
    key: "student",
    label: "학생",
    hint: "평일 수업 후 공부, 주말 공부",
    blocks: [
      { title: "학교 수업", kind: "fixed", weekdays: WEEKDAYS, start: "09:00", end: "15:00" },
      { title: "공부 시간", kind: "work", weekdays: WEEKDAYS, start: "16:00", end: "21:00" },
      { title: "저녁", kind: "break", weekdays: WEEKDAYS, start: "18:00", end: "19:00" },
      { title: "주말 공부", kind: "work", weekdays: [0, 6], start: "10:00", end: "16:00" },
    ],
  },
  {
    key: "freelancer",
    label: "프리랜서",
    hint: "매일 10–18시, 점심 1시간",
    blocks: [
      { title: "작업 시간", kind: "work", weekdays: EVERYDAY, start: "10:00", end: "18:00" },
      { title: "점심", kind: "break", weekdays: EVERYDAY, start: "13:00", end: "14:00" },
    ],
  },
];
