"use client";

import { useQuery } from "@tanstack/react-query";
import { Archive, CircleCheck, History, RotateCcw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PROJECT_STATUS_LABEL, getProjectHistory, projectKeys, type ProjectAction, type ProjectStatusEvent } from "@/lib/api/projects";
import { formatDateTime } from "@/lib/format";

const ICON: Record<ProjectAction, LucideIcon> = { complete: CircleCheck, archive: Archive, restore: RotateCcw };

function describe(event: ProjectStatusEvent): string {
  if (event.action === "complete") {
    return event.open_tasks ? `완료 · 완료 당시 미완료 업무 ${event.open_tasks}개` : "완료 · 모든 업무 완료";
  }
  if (event.action === "archive") return `보관 (${PROJECT_STATUS_LABEL[event.from_status]} 상태에서)`;
  return `다시 열기 → ${PROJECT_STATUS_LABEL[event.to_status]}`;
}

/** 완료·보관·복원 이력 (최신순). 기록이 없으면 표시하지 않는다. */
export function ProjectHistory({ projectId }: { projectId: string }) {
  const { data } = useQuery({ queryKey: projectKeys.history(projectId), queryFn: () => getProjectHistory(projectId) });
  if (!data || data.length === 0) return null;

  return (
    <section className="surface-card mt-6 rounded-[20px] p-4 md:p-5 lg:p-6" aria-labelledby="project-history-heading">
      <h2 id="project-history-heading" className="flex items-center gap-2 text-base font-bold text-primary-dark">
        <History size={18} strokeWidth={2} aria-hidden="true" />
        상태 이력
      </h2>
      <ol className="mt-3 space-y-2.5">
        {data.map((event) => {
          const Icon = ICON[event.action];
          return (
            <li key={event.id} className="flex items-start gap-2.5 text-sm">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-pale-green text-primary-dark">
                <Icon size={14} strokeWidth={2} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-foreground">{describe(event)}</p>
                <p className="text-xs text-muted">
                  <time dateTime={event.occurred_at}>{formatDateTime(event.occurred_at)}</time>
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
