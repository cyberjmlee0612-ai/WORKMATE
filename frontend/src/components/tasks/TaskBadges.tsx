import { ArrowDown, ArrowUp, Ban, Circle, CircleCheck, CirclePlay, Eye, Flame, Minus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { TASK_PRIORITY_LABEL, TASK_STATUS_LABEL, type TaskPriority, type TaskStatus } from "@/lib/api/tasks";

// 상태·우선순위는 색만이 아니라 아이콘 + 텍스트로 전달한다 (디자인 가이드 §11)
export const STATUS_ICON: Record<TaskStatus, LucideIcon> = {
  todo: Circle,
  in_progress: CirclePlay,
  review: Eye,
  completed: CircleCheck,
  cancelled: Ban,
};

export function statusTone(status: TaskStatus) {
  if (status === "completed") return "bg-primary text-white";
  if (status === "cancelled") return "border border-border bg-background text-muted";
  return "bg-pale-green text-primary-dark";
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const Icon = STATUS_ICON[status];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold ${statusTone(status)}`}>
      <Icon size={14} strokeWidth={2} aria-hidden="true" />
      {TASK_STATUS_LABEL[status]}
    </span>
  );
}

const PRIORITY_ICON: Record<TaskPriority, LucideIcon> = {
  urgent: Flame,
  high: ArrowUp,
  medium: Minus,
  low: ArrowDown,
};

export function TaskPriorityBadge({ priority }: { priority: TaskPriority }) {
  const Icon = PRIORITY_ICON[priority];
  // 오류·경고 전용 색은 디자인 가이드에서 미확정 → 긴급만 기존 오류 표시와 같은 붉은 계열로 구분
  const tone =
    priority === "urgent"
      ? "border-red-200 bg-red-50 text-red-800"
      : priority === "high"
        ? "border-soft-sage bg-surface text-primary-dark"
        : "border-border bg-surface text-muted";
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-medium ${tone}`}>
      <Icon size={12} strokeWidth={2} aria-hidden="true" />
      <span className="sr-only">우선순위 </span>
      {TASK_PRIORITY_LABEL[priority]}
    </span>
  );
}
