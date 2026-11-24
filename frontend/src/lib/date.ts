import { useSyncExternalStore } from "react";

/** 사용자 기기 기준 날짜 → "YYYY-MM-DD" */
export function toLocalDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function userTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function subscribe(onChange: () => void) {
  // 자정이 지나면 '오늘'이 바뀌도록 1분마다 확인 (값이 같으면 다시 렌더링되지 않는다)
  const id = window.setInterval(onChange, 60_000);
  return () => window.clearInterval(id);
}

/**
 * 오늘 날짜("YYYY-MM-DD"). 서버 렌더링·하이드레이션 중에는 null.
 * 빌드 시점 날짜와 브라우저 날짜가 달라 생기는 하이드레이션 불일치를 막는다.
 */
export function useToday(): string | null {
  return useSyncExternalStore(subscribe, () => toLocalDateString(new Date()), () => null);
}

/** "YYYY-MM-DD" 두 값의 날짜 차이(b - a). 시간대 영향을 받지 않도록 UTC 기준으로 계산 */
export function diffDays(a: string, b: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

export type DueStatus = "overdue" | "today" | "tomorrow" | null;

/** 마감 표시 기준: 지연(오늘 이전, 미완료) / 오늘 마감 / 내일 마감 */
export function dueStatus(dueDate: string | null, today: string | null, completed: boolean): DueStatus {
  if (!dueDate || !today || completed) return null;
  const diff = diffDays(today, dueDate);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  return null;
}
