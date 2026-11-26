"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarArrowUp, Check, CalendarClock, LoaderCircle, Wind } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { invalidateWorkData } from "@/lib/api/invalidate";
import { resolvePlan, type ResolveAction, type TimePlan } from "@/lib/api/time";
import { userTimeZone } from "@/lib/date";
import { formatClock } from "@/lib/time";

export const RESOLVE_ACTIONS: { action: ResolveAction; label: string; icon: LucideIcon }[] = [
  { action: "today", label: "오늘 빈칸에", icon: CalendarClock },
  { action: "tomorrow", label: "내일로", icon: CalendarArrowUp },
  { action: "done", label: "실제로 했어요", icon: Check },
  { action: "let_go", label: "놓아주기", icon: Wind },
];

/**
 * 밀린 계획 처리 버튼 (2026-11-26 사용자 확정).
 * 다시 배치하면 원래 블록은 '놓침'으로 남고 새 블록이 생긴다. '실제로 했어요'는 계획 시간을 기록으로 바꾼다.
 */
export function ResolvePlanActions({ plan, onDone, compact = false }: { plan: TimePlan; onDone?: (message: string) => void; compact?: boolean }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (action: ResolveAction) => resolvePlan(plan.id, action, userTimeZone()),
    onSuccess: async (result, action) => {
      await invalidateWorkData(queryClient);
      const message =
        action === "let_go" ? `'${plan.task_title}' 계획을 놓아줬어요.`
        : action === "done" ? `'${plan.task_title}'을(를) 실제 기록으로 남겼어요.`
        : `'${plan.task_title}'을(를) ${result.new_plan ? formatClock(result.new_plan.starts_at) : ""}에 다시 넣었어요.`;
      onDone?.(message);
    },
  });

  return (
    <div>
      <div className={`flex flex-wrap gap-1.5 ${compact ? "" : "mt-2"}`} role="group" aria-label={`${plan.task_title} 밀린 계획 처리`}>
        {RESOLVE_ACTIONS.map(({ action, label, icon: Icon }) => (
          <button
            key={action}
            type="button"
            onClick={() => mutation.mutate(action)}
            disabled={mutation.isPending}
            className={`flex min-h-10 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold disabled:opacity-60 ${action === "let_go" ? "border-border text-muted hover:bg-pale-green/40" : "border-primary/40 bg-surface text-primary-dark hover:bg-pale-green"}`}
          >
            {mutation.isPending && mutation.variables === action ? <LoaderCircle size={14} strokeWidth={2} className="animate-spin" aria-hidden="true" /> : <Icon size={14} strokeWidth={2} aria-hidden="true" />}
            {label}
          </button>
        ))}
      </div>
      {mutation.isError && <p className="mt-1.5 text-xs font-semibold text-red-700" role="alert">{mutation.error.message}</p>}
    </div>
  );
}
