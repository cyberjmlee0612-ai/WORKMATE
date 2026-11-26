"use client";

import Link from "next/link";
import { ArrowUpRight, CalendarDays, Check, CornerDownRight, FolderKanban, FolderTree } from "lucide-react";
import type { Project } from "@/lib/api/projects";
import { endDrag, startDrag, useDropTarget, type DragItem } from "@/lib/dnd";
import { formatDate } from "@/lib/format";
import type { ProjectTree } from "@/lib/projectTree";
import { ProgressBar } from "./ProgressBar";
import { ProjectStatusBadge } from "./ProjectStatusBadge";
import { acceptInto } from "./useNestActions";

type Props = {
  project: Project;
  /** 상위 프로젝트 이름 표시 (목록에서 상위와 다른 구역에 보일 때 등) */
  showParent?: boolean;
  /** 주면 끌어다 놓기 사용: 이 카드를 끌 수 있고, 프로젝트·업무를 이 카드(폴더)에 놓을 수 있다 */
  nest?: { tree: ProjectTree; onDrop: (item: DragItem, point: { x: number; y: number }, element: HTMLElement) => void };
  /** 편집 모드: 카드를 누르면 상세로 가는 대신 선택된다. 고른 카드를 끌면 selectedIds 전부가 함께 끌린다 */
  selection?: { checked: boolean; onToggle: () => void; selectedIds: string[] };
};

/** 카드 전체가 상세 화면 링크. 카드 안에 다른 버튼을 두지 않아 클릭 영역이 겹치지 않는다. */
export function ProjectCard({ project, showParent = false, nest, selection }: Props) {
  const due = formatDate(project.due_date);
  const drop = useDropTarget(
    (item) => (nest ? acceptInto(nest.tree, project.id)(item) : "끌어다 놓을 수 없어요."),
    (item, point, element) => nest?.onDrop(item, point, element),
  );
  const tone =
    drop.state === "valid"
      ? "border-primary bg-pale-green/70 ring-4 ring-primary/20 scale-[1.02]"
      : drop.state === "invalid"
        ? "border-red-300 bg-red-50/40"
        : "border-border bg-background/80 hover:border-sage hover:bg-surface";

  const body = (
    <>
      {selection && (
        <span
          className={`absolute right-3 top-3 z-[1] flex size-6 items-center justify-center rounded-md border-2 ${selection.checked ? "border-primary bg-primary text-white" : "border-soft-sage bg-surface"}`}
          aria-hidden="true"
        >
          {selection.checked && <Check size={16} strokeWidth={3} />}
        </span>
      )}
      <div className={`flex items-start justify-between gap-2 ${selection ? "pr-8" : ""}`}>
        <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl text-primary-dark transition-colors ${drop.state === "valid" ? "bg-primary text-white" : "bg-pale-green"}`}>
          <FolderKanban size={20} strokeWidth={2} aria-hidden="true" />
        </span>
        <div className="flex items-center gap-2">
          <ProjectStatusBadge status={project.status} />
          <ArrowUpRight size={16} strokeWidth={2} className="text-sage group-hover:text-primary" aria-hidden="true" />
        </div>
      </div>
      {showParent && project.parent_name && (
        <p className="mt-4 flex items-center gap-1 truncate text-xs text-muted">
          <CornerDownRight size={12} strokeWidth={2} aria-hidden="true" />
          {project.parent_name}
        </p>
      )}
      <h3 className={`${showParent && project.parent_name ? "mt-1" : "mt-5"} break-words text-base font-semibold text-primary-dark`}>{project.name}</h3>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <CalendarDays size={14} strokeWidth={2} aria-hidden="true" />
          {due ? `마감 ${due}` : "마감일 없음"}
        </span>
        {project.subproject_count > 0 && (
          <span className="inline-flex items-center gap-1">
            <FolderTree size={14} strokeWidth={2} aria-hidden="true" />
            하위 {project.subproject_count}개
          </span>
        )}
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
      {drop.state === "valid" && (
        <span className="pointer-events-none absolute inset-x-4 bottom-2 rounded-lg bg-primary px-2 py-1 text-center text-xs font-semibold text-white" aria-hidden="true">
          여기에 넣기
        </span>
      )}
    </>
  );
  const base = "group relative flex flex-col rounded-2xl border p-4 text-left transition-[transform,background-color,border-color,box-shadow] duration-150 md:p-5";

  const onDragStart = (event: React.DragEvent) => {
    const ids = selection?.checked && selection.selectedIds.length > 1 ? selection.selectedIds : [project.id];
    startDrag(event, { kind: "project", ids, name: ids.length > 1 ? `프로젝트 ${ids.length}개` : project.name });
  };

  if (selection) {
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={selection.checked}
        aria-label={`${project.name} 선택`}
        onClick={selection.onToggle}
        draggable={Boolean(nest)}
        onDragStart={nest ? onDragStart : undefined}
        onDragEnd={nest ? endDrag : undefined}
        {...(nest ? drop.props : {})}
        className={`${base} ${drop.state !== "idle" ? tone : selection.checked ? "border-primary bg-pale-green/60 ring-2 ring-primary/30" : "border-border bg-background/80 hover:border-sage"}`}
      >
        {body}
      </button>
    );
  }

  return (
    <Link
      href={`/projects/${project.id}`}
      draggable={Boolean(nest)}
      onDragStart={nest ? onDragStart : undefined}
      onDragEnd={nest ? endDrag : undefined}
      {...(nest ? drop.props : {})}
      title={drop.state === "invalid" ? (drop.reason ?? undefined) : undefined}
      className={`${base} ${tone}`}
    >
      {body}
    </Link>
  );
}
