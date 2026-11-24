import { Archive, CircleCheck, CircleDashed, CirclePlay, Eye } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PROJECT_STATUS_LABEL, type ProjectStatus } from "@/lib/api/projects";

// 상태는 색만이 아니라 아이콘 + 텍스트로 함께 전달한다 (디자인 가이드 §11)
const ICONS: Record<ProjectStatus, LucideIcon> = {
  planning: CircleDashed,
  in_progress: CirclePlay,
  review: Eye,
  completed: CircleCheck,
  archived: Archive,
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const Icon = ICONS[status];
  const tone = status === "completed" || status === "archived" ? "bg-background text-muted border border-border" : "bg-pale-green text-primary-dark";
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold ${tone}`}>
      <Icon size={14} strokeWidth={2} aria-hidden="true" />
      {PROJECT_STATUS_LABEL[status]}
    </span>
  );
}
