import Link from "next/link";
import { ArrowUpRight, CalendarDays, FolderKanban } from "lucide-react";
import type { Project } from "@/lib/api/projects";
import { formatDate } from "@/lib/format";
import { ProgressBar } from "./ProgressBar";
import { ProjectStatusBadge } from "./ProjectStatusBadge";

/** 카드 전체가 상세 화면 링크. 카드 안에 다른 버튼을 두지 않아 클릭 영역이 겹치지 않는다. */
export function ProjectCard({ project }: { project: Project }) {
  const due = formatDate(project.due_date);
  return (
    <Link
      href={`/projects/${project.id}`}
      className="group flex flex-col rounded-2xl border border-border bg-background/80 p-4 transition-colors hover:border-sage hover:bg-surface md:p-5"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-pale-green text-primary-dark">
          <FolderKanban size={20} strokeWidth={2} aria-hidden="true" />
        </span>
        <div className="flex items-center gap-2">
          <ProjectStatusBadge status={project.status} />
          <ArrowUpRight size={16} strokeWidth={2} className="text-sage group-hover:text-primary" aria-hidden="true" />
        </div>
      </div>
      <h3 className="mt-5 break-words text-base font-semibold text-primary-dark">{project.name}</h3>
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
        <CalendarDays size={14} strokeWidth={2} aria-hidden="true" />
        {due ? `마감 ${due}` : "마감일 없음"}
      </p>
      <div className="mt-5 flex justify-between text-sm">
        <span className="text-muted">
          진행률 <span className="font-geist text-xs">({project.completed_tasks}/{project.total_tasks} 완료)</span>
        </span>
        <span className="font-geist font-semibold text-primary-dark">{project.progress}%</span>
      </div>
      <div className="mt-3">
        <ProgressBar value={project.progress} label={`${project.name} 진행률`} />
      </div>
    </Link>
  );
}
