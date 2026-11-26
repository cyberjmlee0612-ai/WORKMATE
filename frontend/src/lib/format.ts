const dateFormatter = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric" });

/**
 * "YYYY-MM-DD"(DATE 컬럼) → "2026년 12월 1일".
 * new Date("2026-12-01")은 UTC 자정으로 해석되어 시간대에 따라 하루 밀릴 수 있으므로 직접 나눠서 만든다.
 */
export function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return dateFormatter.format(new Date(year, month - 1, day));
}

const dateTimeFormatter = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });

/** ISO 시각(timestamptz) → 사용자 시간대 기준 "2026년 11월 24일 오후 3:20" */
export function formatDateTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : dateTimeFormatter.format(date);
}

/** 분 → "1시간 30분" */
export function formatMinutes(minutes: number | null | undefined): string | null {
  if (!minutes || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}분`;
  return rest === 0 ? `${hours}시간` : `${hours}시간 ${rest}분`;
}
