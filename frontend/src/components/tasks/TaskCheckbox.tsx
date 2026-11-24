"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, LoaderCircle } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { invalidateWorkData } from "@/lib/api/invalidate";
import { updateTask, type Task } from "@/lib/api/tasks";

type Props = {
  task: Task;
  onError: (message: string | null) => void;
};

/**
 * 완료 체크. 서버 저장이 성공한 뒤 업무·프로젝트·대시보드를 다시 조회한다(낙관적 업데이트 없음, PRD).
 * 해제하면 'todo'로 돌아간다 — 체크 전 상태는 저장되어 있지 않다.
 * completed_at은 DB 트리거가 상태에 맞춰 기록·초기화한다.
 */
export function TaskCheckbox({ task, onError }: Props) {
  const queryClient = useQueryClient();
  const checked = task.status === "completed";

  const mutation = useMutation({
    mutationFn: () => updateTask(task.id, { status: checked ? "todo" : "completed" }),
    onMutate: () => onError(null),
    onSuccess: () => invalidateWorkData(queryClient),
    onError: (error) => {
      // 실패하면 화면 값은 서버 값 그대로(체크 상태 복원)이고 오류만 안내한다
      onError(
        error instanceof ApiError && error.status === 404
          ? "이미 삭제된 업무입니다. 목록을 새로고침했어요."
          : error instanceof ApiError
            ? error.message
            : "완료 상태를 저장하지 못했습니다. 다시 시도해 주세요.",
      );
      if (error instanceof ApiError && error.status === 404) invalidateWorkData(queryClient);
    },
  });
  const pending = mutation.isPending;

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-busy={pending}
      aria-label={`${task.title} ${checked ? "완료 해제" : "완료 처리"}`}
      title={checked ? "완료 해제" : "완료 처리"}
      disabled={pending}
      onClick={() => !pending && mutation.mutate()}
      className="group -my-1 flex size-11 shrink-0 items-center justify-center rounded-full disabled:cursor-wait"
    >
      <span
        className={`flex size-7 items-center justify-center rounded-full border-2 transition-colors ${
          checked ? "border-primary bg-primary text-white" : "border-soft-sage bg-white text-transparent group-hover:border-primary group-hover:text-sage"
        }`}
      >
        {pending ? (
          <LoaderCircle size={16} strokeWidth={2.5} className={`animate-spin ${checked ? "text-white" : "text-primary"}`} aria-hidden="true" />
        ) : (
          <Check size={16} strokeWidth={2.5} aria-hidden="true" />
        )}
      </span>
    </button>
  );
}
