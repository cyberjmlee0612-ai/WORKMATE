import { apiFetch } from "./client";

/** 사용자 설정 (표시 이름). 일하는 시간·쉬는 시간은 요일별 반복 블록(schedule.ts)에 있다. */
export type UserSettings = { email: string | null; display_name: string | null };

export const DISPLAY_NAME_MAX = 30;
export const MIN_PASSWORD_LENGTH = 8; // 가입 화면과 같은 기준

export const settingsKeys = { all: ["settings"] as const };

export const getSettings = () => apiFetch<UserSettings>("/settings");
export const saveSettings = (input: { display_name: string | null }) =>
  apiFetch<UserSettings>("/settings", { method: "PUT", body: JSON.stringify(input) });

/** 계정과 모든 데이터를 삭제 (되돌릴 수 없음). 서버가 이메일·비밀번호를 다시 확인한다. */
export const deleteAccount = (input: { email: string; password: string }) =>
  apiFetch<void>("/me/delete", { method: "POST", body: JSON.stringify(input) });
