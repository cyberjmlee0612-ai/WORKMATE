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

/** 분 → "1시간 30분" */
export function formatMinutes(minutes: number | null | undefined): string | null {
  if (!minutes || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}분`;
  return rest === 0 ? `${hours}시간` : `${hours}시간 ${rest}분`;
}
