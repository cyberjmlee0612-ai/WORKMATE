"use client";

import { Gauge } from "lucide-react";
import { adjustMinutes, ratioLabel, useCalibration } from "@/lib/api/estimates";
import { formatMinutes } from "@/lib/format";

/**
 * 예상 시간 옆 보정 제안 (2026-11-26 사용자 확정: 제안만, 누르면 적용).
 * 내 기록으로 보통 몇 배 걸리는지 알려 주고, 누르면 보정값으로 바꾼다. 근거가 없으면 아무것도 보이지 않는다.
 */
export function EstimateHint({ value, onApply, compact = false }: { value: string; onApply: (minutes: number) => void; compact?: boolean }) {
  const { data: cal } = useCalibration();
  const minutes = /^\d+$/.test(value.trim()) ? Number(value.trim()) : null;
  const adjusted = adjustMinutes(minutes, cal);
  if (!adjusted || adjusted.minutes === minutes) return null;

  const slower = adjusted.ratio > 1;
  return (
    <p className={`flex flex-wrap items-center gap-x-1.5 text-xs ${compact ? "mt-0.5" : "mt-1.5"} ${slower ? "text-amber-900" : "text-sky-900"}`}>
      <Gauge size={13} strokeWidth={2} aria-hidden="true" className="shrink-0" />
      <span>
        {compact ? "" : "내 기록으로는 "}보통 {ratioLabel(adjusted.ratio)} {slower ? "더 걸려요" : "걸려요"}.
      </span>
      <button type="button" onClick={() => onApply(adjusted.minutes)} className="min-h-8 font-semibold underline underline-offset-2 hover:no-underline">
        {formatMinutes(adjusted.minutes)}으로 바꾸기
      </button>
    </p>
  );
}
