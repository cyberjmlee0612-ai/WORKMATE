import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { getTimer, timeKeys } from "@/lib/api/time";
import { toLocalDateString } from "@/lib/date";

/**
 * 진행 중인 타이머. 창에 돌아올 때 다시 조회하고, poll=true(상단 타이머 바)면 1분마다도 조회해
 * 다른 탭·기기에서 바뀐 것을 반영한다. 업무 행 버튼들은 같은 캐시를 공유만 한다.
 * offset: 서버 시각 - 브라우저 시각. 사용자 PC 시계가 틀려도 경과 시간이 맞게 보이도록 보정한다.
 */
export function useRunningTimer({ poll = false }: { poll?: boolean } = {}) {
  const query = useQuery({ queryKey: timeKeys.timer(), queryFn: getTimer, refetchInterval: poll ? 60_000 : false });
  const offset = query.data ? Date.parse(query.data.server_now) - query.dataUpdatedAt : 0;
  return { ...query, running: query.data?.running ?? null, offset };
}

function subscribeSecond(onChange: () => void) {
  const id = window.setInterval(onChange, 1000);
  return () => window.clearInterval(id);
}

/** 1초마다 바뀌는 현재 시각(초 단위 epoch). 서버 렌더링 중에는 null. */
export function useNowSeconds(): number | null {
  return useSyncExternalStore(subscribeSecond, () => Math.floor(Date.now() / 1000), () => null);
}

/** 경과 시간 → "12:03" / "1:02:03" */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const timeFormatter = new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit" });
const dayFormatter = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" });

/** "오후 2:05" (브라우저 시간대) */
export const formatClock = (iso: string) => timeFormatter.format(new Date(iso));
/** "11월 25일 (수)" */
export const formatDay = (iso: string) => dayFormatter.format(new Date(iso));

/** 기록 구간 → "오후 2:00 – 오후 3:30", 날짜를 넘기면 "오후 11:00 – 다음 날 오전 1:00" */
export function formatRange(startIso: string, endIso: string | null): string {
  if (!endIso) return `${formatClock(startIso)} – 진행 중`;
  const sameDay = toLocalDateString(new Date(startIso)) === toLocalDateString(new Date(endIso));
  return `${formatClock(startIso)} – ${sameDay ? "" : "다음 날 "}${formatClock(endIso)}`;
}

/** 기록 길이(분, 내림) */
export const entryMinutes = (startIso: string, endIso: string) => Math.floor((Date.parse(endIso) - Date.parse(startIso)) / 60_000);

/** Date → <input type="time"> 값 "HH:MM" */
export function toTimeInput(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** <input type="date">·<input type="time"> 값 → 브라우저 시간대의 Date. 잘못된 값이면 null */
export function fromLocalInputs(dateValue: string, timeValue: string): Date | null {
  const [y, mo, d] = dateValue.split("-").map(Number);
  const [h, mi] = timeValue.split(":").map(Number);
  if (!y || !mo || !d || Number.isNaN(h) || Number.isNaN(mi) || timeValue === "") return null;
  const date = new Date(y, mo - 1, d, h, mi);
  return Number.isNaN(date.getTime()) ? null : date;
}
