import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";

/**
 * 예상 시간 자동 보정 (2026-11-26 사용자 확정).
 * ratio = 최근 60일 완료 업무의 실제 합계 ÷ 예상 합계. 짧은 일(1시간 미만)·긴 일을 따로, 5개 이상일 때만.
 */
export type CalibrationBucket = { ratio: number | null; samples: number };
export type Calibration = {
  short: CalibrationBucket;
  long: CalibrationBucket;
  overall: CalibrationBucket;
  lookback_days: number;
  min_samples: number;
  short_limit: number;
};

export const estimateKeys = { calibration: ["estimates", "calibration"] as const };
export const getCalibration = () => apiFetch<Calibration>("/estimates/calibration");

/** 업무 입력 창·AI 나누기·리포트가 같은 캐시를 쓴다 (5분) */
export function useCalibration() {
  return useQuery({ queryKey: estimateKeys.calibration, queryFn: getCalibration, staleTime: 5 * 60_000 });
}

const NEUTRAL: [number, number] = [0.9, 1.1];

/** 서버 규칙과 같은 보정값 (5분 단위). 근거가 없거나 차이가 작으면 null */
export function adjustMinutes(minutes: number | null | undefined, cal: Calibration | undefined): { minutes: number; ratio: number } | null {
  if (!minutes || minutes <= 0 || !cal) return null;
  const ratio = (minutes < cal.short_limit ? cal.short : cal.long).ratio;
  if (ratio === null || (ratio >= NEUTRAL[0] && ratio <= NEUTRAL[1])) return null;
  return { minutes: Math.max(5, Math.round((minutes * ratio) / 5) * 5), ratio };
}

/** 1.5 → "1.5배", 0.8 → "0.8배" */
export const ratioLabel = (ratio: number) => `${Number(ratio.toFixed(1))}배`;
