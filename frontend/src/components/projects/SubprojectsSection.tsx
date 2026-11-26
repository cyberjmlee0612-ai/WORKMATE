"use client";

import { useState } from "react";
import { FolderTree, Info, ListChecks, Plus } from "lucide-react";
import { ProjectBulkBar } from "./ProjectBulkBar";
import { useEditMode } from "./useEditMode";
import type { Project } from "@/lib/api/projects";
import type { DragItem } from "@/lib/dnd";
import { MAX_PROJECT_DEPTH, categoryOf, depthOf, type ProjectTree } from "@/lib/projectTree";
import { ProjectCard } from "./ProjectCard";
import { ProjectFormDialog } from "./ProjectFormDialog";

type Props = {
  project: Project;
  tree: ProjectTree;
  onDrop: (item: DragItem, target: Project, point: { x: number; y: number }, element: HTMLElement) => void;
};

const ORDER = { active: 0, completed: 1, archived: 2 } as const;

/** 프로젝트 상세의 하위 프로젝트 카드들. 카드는 폴더처럼 업무·다른 하위 프로젝트를 끌어다 넣을 수 있다. */
export function SubprojectsSection({ project, tree, onDrop }: Props) {
  const [formOpen, setFormOpen] = useState(false);
  const edit = useEditMode();
  const children = [...(tree.children.get(project.id) ?? [])].sort(
    (a, b) => ORDER[categoryOf(a.status)] - ORDER[categoryOf(b.status)] || a.name.localeCompare(b.name, "ko"),
  );
  const depth = tree.byId.has(project.id) ? depthOf(tree, project.id) : 1;
  const canAdd = categoryOf(project.status) === "active" && depth < MAX_PROJECT_DEPTH;
  if (children.length === 0 && !canAdd && !edit.notice) return null;
  const childIds = children.map((c) => c.id);
  const selectedIds = childIds.filter((id) => edit.selected.has(id));

  return (
    <section className="surface-card mt-6 rounded-[20px] p-4 md:p-5 lg:p-6" aria-labelledby="subprojects-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="subprojects-heading" className="flex items-center gap-2 text-xl font-bold text-primary-dark">
            <FolderTree size={20} strokeWidth={2} aria-hidden="true" />
            하위 프로젝트
          </h2>
          <p className="mt-1 text-sm text-muted">
            {children.length > 0 ? `${children.length}개 · 진행률은 하위 프로젝트 업무까지 합산돼요` : "큰 프로젝트를 단계별로 나눠 관리해 보세요"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {children.length > 0 && !edit.editing && (
            <button type="button" onClick={edit.start} className="flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-primary-dark hover:bg-pale-green">
              <ListChecks size={16} strokeWidth={2} aria-hidden="true" />
              편집
            </button>
          )}
          {canAdd && !edit.editing && (
            <button type="button" onClick={() => setFormOpen(true)} className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-primary-dark hover:bg-pale-green">
              <Plus size={18} strokeWidth={2} aria-hidden="true" />
              하위 프로젝트 추가
            </button>
          )}
        </div>
      </div>
      {edit.notice && (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-pale-green/60 px-3 py-2 text-sm text-primary-dark" role="status">
          <Info size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
          {edit.notice}
        </p>
      )}
      {edit.editing && <p className="mt-3 text-sm text-muted">하위 프로젝트를 여러 개 고른 뒤, 아래에서 옮기거나(최상위·다른 프로젝트) 삭제하세요.</p>}

      {children.length > 0 ? (
        <>
          <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {children.map((child) => (
              <ProjectCard
                key={child.id}
                project={child}
                nest={{ tree, onDrop: (item, point, element) => onDrop(item, child, point, element) }}
                selection={edit.editing ? { checked: edit.selected.has(child.id), onToggle: () => edit.toggle(child.id), selectedIds } : undefined}
              />
            ))}
          </div>
          {edit.editing && (
            <ProjectBulkBar
              tree={tree}
              selectedIds={selectedIds}
              totalCount={childIds.length}
              onSelectAll={() => edit.setAll(childIds)}
              onClearAll={() => edit.setAll([])}
              onDone={edit.finish}
              onCancel={edit.stop}
            />
          )}
          <p className="mt-3 hidden text-xs text-muted md:block">아래 업무나 다른 하위 프로젝트를 카드 위로 끌어다 놓으면 그 안으로 들어가요.</p>
        </>
      ) : (
        <p className="mt-4 rounded-xl border-2 border-dashed border-soft-sage px-4 py-6 text-center text-sm text-muted">
          하위 프로젝트를 추가한 뒤, 아래 업무를 카드로 끌어다 놓아 정리할 수 있어요.
        </p>
      )}
      {formOpen && <ProjectFormDialog defaultParentId={project.id} onClose={() => setFormOpen(false)} />}
    </section>
  );
}
