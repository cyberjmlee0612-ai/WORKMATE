import { addDays, parseDateParam, startOfWeek } from "@/lib/time";
import { toLocalDateString } from "@/lib/date";
import { REPORT_MAX_DAYS } from "@/lib/api/reports";
import { formatMinutes } from "@/lib/format";

export const fmtMinutes = (minutes: number) => formatMinutes(minutes) ?? "0분";

/** 리포트 기간: 주간(일요일 시작, 캘린더와 같음) · 월간 · 직접 지정(최대 92일) — 2026-11-26 사용자 확정 */
export type PeriodMode = "week" | "month" | "custom";
export type Period = { mode: PeriodMode; start: Date; end: Date };

export function resolvePeriod(params: URLSearchParams, today: Date): Period {
  const mode = params.get("mode");
  if (mode === "custom") {
    const start = parseDateParam(params.get("start"));
    const end = parseDateParam(params.get("end"));
    if (start && end && validateCustom(start, end) === null) return { mode, start, end };
  }
  const anchor = parseDateParam(params.get("date")) ?? today;
  if (mode === "month") {
    return { mode, start: new Date(anchor.getFullYear(), anchor.getMonth(), 1), end: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0) };
  }
  const start = startOfWeek(anchor);
  return { mode: "week", start, end: addDays(start, 6) };
}

export function dayCount(start: Date, end: Date): number {
  return Math.round((Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / 86_400_000) + 1;
}

/** 직접 지정 기간 검사. 문제가 없으면 null */
export function validateCustom(start: Date, end: Date): string | null {
  if (end < start) return "끝 날짜는 시작 날짜와 같거나 뒤여야 해요.";
  if (dayCount(start, end) > REPORT_MAX_DAYS) return `기간은 최대 ${REPORT_MAX_DAYS}일까지 볼 수 있어요.`;
  return null;
}

/** 이전/다음 기간의 기준 날짜 */
export function shiftAnchor(period: Period, direction: -1 | 1): Date {
  if (period.mode === "month") return new Date(period.start.getFullYear(), period.start.getMonth() + direction, 1);
  return addDays(period.start, 7 * direction);
}

const monthDay = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" });
const yearMonth = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long" });

export function periodTitle(period: Period): string {
  if (period.mode === "month") return yearMonth.format(period.start);
  const sameYear = period.start.getFullYear() === period.end.getFullYear();
  const startText = sameYear ? monthDay.format(period.start) : `${period.start.getFullYear()}년 ${monthDay.format(period.start)}`;
  const endText = sameYear ? monthDay.format(period.end) : `${period.end.getFullYear()}년 ${monthDay.format(period.end)}`;
  return `${startText} – ${endText}`;
}

export const periodKey = (period: Period) => `${toLocalDateString(period.start)}_${toLocalDateString(period.end)}`;

/** "YYYY-MM-DD" → "11/3" (주간이면 요일도) */
export function dayLabel(value: string, withWeekday: boolean): string {
  const date = parseDateParam(value);
  if (!date) return value;
  const base = `${date.getMonth() + 1}/${date.getDate()}`;
  return withWeekday ? `${base} (${"일월화수목금토"[date.getDay()]})` : base;
}
