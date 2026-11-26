"use client";

import { LoaderCircle, Play, Square } from "lucide-react";
import type { Task } from "@/lib/api/tasks";
import { useTimerControls } from "./useTimerControls";

type Props = {
  task: Task;
  onError: (message: string | null) => void;
  onNotice: (message: string | null) => void;
};

/**
 * 업무 행의 ▶/■ 버튼. 타이머는 한 번에 하나라서, 다른 업무에서 시작하면 기존 타이머가 멈춘다.
 * 완료·제외한 업무는 시작할 수 없어 버튼을 숨긴다(이미 돌고 있으면 멈춤 버튼은 보인다).
 */
export function TaskTimerButton({ task, onError, onNotice }: Props) {
  const { running, start, stop, pending, dialog } = useTimerControls({ onError, onNotice });
  const isRunning = running?.task_id === task.id;
  const closed = task.status === "completed" || task.status === "cancelled";
  if (closed && !isRunning) return dialog;

  const label = isRunning ? `${task.title} 타이머 멈춤` : `${task.title} 타이머 시작`;
  return (
    <>
      <button
        type="button"
        onClick={() => (isRunning ? stop() : start(task.id))}
        disabled={pending}
        aria-busy={pending}
        aria-pressed={isRunning}
        aria-label={label}
        title={isRunning ? "타이머 멈춤" : running ? "이 업무로 타이머 바꾸기" : "타이머 시작"}
        className={`flex size-11 items-center justify-center rounded-xl disabled:cursor-wait ${
          isRunning ? "bg-primary text-white hover:bg-primary-dark" : "text-muted hover:bg-pale-green hover:text-primary-dark"
        }`}
      >
        {pending ? (
          <LoaderCircle size={18} strokeWidth={2} className="animate-spin" aria-hidden="true" />
        ) : isRunning ? (
          <Square size={14} strokeWidth={2.5} fill="currentColor" aria-hidden="true" />
        ) : (
          <Play size={18} strokeWidth={2} aria-hidden="true" />
        )}
      </button>
      {dialog}
    </>
  );
}
