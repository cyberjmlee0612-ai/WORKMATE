"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/client";
import { invalidateWorkData } from "@/lib/api/invalidate";
import { LONG_RUNNING_MS, conflictCode, startTimer, stopTimer, type TimeEntry, type TimerStopResult } from "@/lib/api/time";
import { formatMinutes } from "@/lib/format";
import { entryMinutes, useRunningTimer } from "@/lib/time";
import { StopTimerDialog } from "./StopTimerDialog";

type Options = {
  onError?: (message: string | null) => void;
  /** 저장 결과 안내 (예: "25분 기록했어요") */
  onNotice?: (message: string | null) => void;
  /** 상단 타이머 바만 true: 1분마다 다시 조회 */
  poll?: boolean;
};

function stopNotice(result: TimerStopResult): string {
  if (result.discarded || !result.entry?.ended_at) return "1분 미만이라 기록하지 않았어요.";
  return `${formatMinutes(entryMinutes(result.entry.started_at, result.entry.ended_at)) ?? "1분"} 기록했어요.`;
}

/**
 * 타이머 시작·멈춤 공통 처리 (상단 타이머 바와 업무 행 버튼이 함께 쓴다).
 * - 서버 저장 성공 후 다시 조회 (낙관적 업데이트 없음)
 * - 12시간 이상 켜 둔 타이머는 멈추기 전에 끝난 시각을 확인받는다 → dialog를 화면에 그려야 한다
 */
export function useTimerControls({ onError, onNotice, poll = false }: Options = {}) {
  const queryClient = useQueryClient();
  const { running, offset } = useRunningTimer({ poll });
  const [review, setReview] = useState<TimeEntry | null>(null);

  function handleError(err: unknown, fallback: string) {
    const code = err instanceof ApiError ? conflictCode(err.body) : null;
    if (code === "timer_needs_review" && running) {
      setReview(running);
      return;
    }
    if (code) invalidateWorkData(queryClient); // 다른 곳에서 상태가 바뀜 → 최신으로
    onError?.(err instanceof ApiError ? err.message : fallback);
  }

  const stopMutation = useMutation({
    mutationFn: () => stopTimer(),
    onMutate: () => onError?.(null),
    onSuccess: (result) => {
      invalidateWorkData(queryClient);
      onNotice?.(stopNotice(result));
    },
    onError: (err) => {
      if (err instanceof ApiError && conflictCode(err.body) === "no_running_timer") {
        invalidateWorkData(queryClient);
        return;
      }
      handleError(err, "타이머를 멈추지 못했습니다. 다시 시도해 주세요.");
    },
  });

  const startMutation = useMutation({
    mutationFn: (taskId: string) => startTimer(taskId),
    onMutate: () => {
      onError?.(null);
      onNotice?.(null);
    },
    onSuccess: (result) => {
      invalidateWorkData(queryClient);
      if (result.stopped) onNotice?.(`‘${result.stopped.task_title}’ 타이머를 멈추고 시작했어요.`);
      else if (result.discarded) onNotice?.("이전 타이머는 1분 미만이라 기록하지 않았어요.");
    },
    onError: (err) => handleError(err, "타이머를 시작하지 못했습니다. 다시 시도해 주세요."),
  });

  function stop() {
    if (!running || stopMutation.isPending) return;
    if (Date.now() + offset - Date.parse(running.started_at) >= LONG_RUNNING_MS) setReview(running);
    else stopMutation.mutate();
  }

  function start(taskId: string) {
    if (startMutation.isPending) return;
    startMutation.mutate(taskId);
  }

  const dialog = review ? (
    <StopTimerDialog entry={review} offset={offset} onClose={() => setReview(null)} onStopped={(result) => onNotice?.(stopNotice(result))} />
  ) : null;

  return { running, offset, start, stop, pending: startMutation.isPending || stopMutation.isPending, dialog };
}
