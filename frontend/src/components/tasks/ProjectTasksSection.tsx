"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Ban, ChevronDown, FolderKanban, ListTodo, Plus, UserRound } from "lucide-react";
import type { Project } from "@/lib/api/projects";
import { listTasks, taskKeys, type Task, type TaskFilters } from "@/lib/api/tasks";
import type { DragItem } from "@/lib/dnd";
import type { ProjectTree } from "@/lib/projectTree";
import { EmptyState, ErrorState } from "@/components/common/QueryStates";
import { NestDropZone } from "@/components/projects/NestDropZone";
import { TaskList, TaskListSkeleton } from "./TaskList";
import { TaskFormDialog } from "./TaskFormDialog";
import { PersonalTasksDrawer } from "./PersonalTasksDrawer";

type Props = {
  project: Project;
  tree: ProjectTree;
  /** 업무를 이 목록(=이 프로젝트)에 놓았을 때 */
  onDrop: (item: DragItem, point: { x: number; y: number }, element: HTMLElement) => void;
  onNotice: (message: string) => void;
};

type View = "own" | "all";

/**
 * 프로젝트 상세의 업무 목록 (2026-11-26 사용자 요청: 상위·하위 보기 분리).
 *  - 이 프로젝트만 / 하위 포함 전체(하위 프로젝트별로 묶음) 전환
 *  - 다른 곳(개인 업무 패널·하위 프로젝트 목록)의 업무를 이 목록에 끌어다 놓으면 이 프로젝트로 옮긴다
 *  - 제외한 업무는 기본으로 숨기고 펼쳐서 볼 수 있다
 */
export function ProjectTasksSection({ project, tree, onDrop, onNotice }: Props) {
  const projectId = project.id;
  const [formOpen, setFormOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showCancelled, setShowCancelled] = useState(false);
  const [view, setView] = useState<View>("own");
  const hasSubprojects = project.subproject_count > 0;
  const effectiveView: View = hasSubprojects ? view : "own";

  const filters: TaskFilters = effectiveView === "all" ? { project_id: projectId, include_subprojects: true } : { project_id: projectId };
  const cancelledFilters: TaskFilters = { project_id: projectId, status: "cancelled" };
  const { data, isPending, isError, error, refetch, isRefetching } = useQuery({ queryKey: taskKeys.list(filters), queryFn: () => listTasks(filters) });
  // 펼쳤을 때만 불러온다
  const cancelledQuery = useQuery({ queryKey: taskKeys.list(cancelledFilters), queryFn: () => listTasks(cancelledFilters), enabled: showCancelled });

  // 하위 포함 보기: 이 프로젝트 → 하위 프로젝트 경로 순으로 묶는다
  const groups: { id: string; label: string; tasks: Task[] }[] = [];
  if (data && effectiveView === "all") {
    const byProject = new Map<string, Task[]>();
    for (const t of data) {
      const key = t.project_id ?? "";
      byProject.set(key, [...(byProject.get(key) ?? []), t]);
    }
    const prefix = `${data.find((t) => t.project_id === projectId)?.project_path ?? project.name} › `;
    const ids = [...byProject.keys()].sort((a, b) => (a === projectId ? -1 : b === projectId ? 1 : (byProject.get(a)![0].project_path ?? "").localeCompare(byProject.get(b)![0].project_path ?? "", "ko")));
    for (const id of ids) {
      const tasks = byProject.get(id)!;
      const path = tasks[0].project_path ?? "";
      groups.push({ id, label: id === projectId ? `${project.name} (직접 속한 업무)` : path.startsWith(prefix) ? path.slice(prefix.length) : path, tasks });
    }
  }

  const addButton = (label: string) => (
    <button type="button" onClick={() => setFormOpen(true)} className="flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark">
      <Plus size={18} strokeWidth={2} aria-hidden="true" />
      {label}
    </button>
  );
  const tabClass = (active: boolean) =>
    `min-h-10 rounded-lg px-3 text-sm font-medium transition-colors ${active ? "bg-surface font-semibold text-primary-dark shadow-sm" : "text-muted hover:text-primary-dark"}`;

  return (
    <NestDropZone
      tree={tree}
      targetId={projectId}
      onDrop={onDrop}
      // 놓을 수 있을 때만 강조한다 (이 목록 안에서 끄는 동안 빨갛게 되지 않게)
      className={(state) => `surface-card mt-6 rounded-[20px] p-4 transition-[box-shadow,background-color] md:p-5 lg:p-6 ${state === "valid" ? "bg-pale-green/50 ring-4 ring-primary/30" : ""}`}
    >
      <section aria-labelledby="project-tasks-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="project-tasks-heading" className="text-xl font-bold text-primary-dark">업무</h2>
            {data && <p className="mt-1 text-sm text-muted">{data.length}개의 업무</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setDrawerOpen(true)} className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-3.5 text-sm font-semibold text-primary-dark hover:bg-pale-green">
              <UserRound size={16} strokeWidth={2} aria-hidden="true" />
              개인 업무 가져오기
            </button>
            {data && data.length > 0 && addButton("업무 추가")}
          </div>
        </div>

        {hasSubprojects && (
          <div className="mt-4 inline-flex rounded-xl bg-pale-green/60 p-1" role="tablist" aria-label="업무 보기 범위">
            <button type="button" role="tab" aria-selected={effectiveView === "own"} onClick={() => setView("own")} className={tabClass(effectiveView === "own")}>
              이 프로젝트만
            </button>
            <button type="button" role="tab" aria-selected={effectiveView === "all"} onClick={() => setView("all")} className={tabClass(effectiveView === "all")}>
              하위 포함 전체
            </button>
          </div>
        )}

        <div className="mt-4">
          {isPending ? (
            <TaskListSkeleton rows={3} />
          ) : isError ? (
            <ErrorState message={error.message} onRetry={() => refetch()} retrying={isRefetching} />
          ) : effectiveView === "all" ? (
            groups.length === 0 ? (
              <p className="rounded-xl bg-background px-4 py-8 text-center text-sm text-muted">이 프로젝트와 하위 프로젝트에 업무가 없어요.</p>
            ) : (
              <div className="space-y-6">
                {groups.map((g) => (
                  <div key={g.id}>
                    <h3 className="flex items-center gap-1.5 border-b border-border pb-2 text-sm font-semibold text-primary-dark">
                      <FolderKanban size={16} strokeWidth={2} aria-hidden="true" />
                      {g.label}
                      <span className="font-geist text-xs font-medium text-muted">({g.tasks.length})</span>
                    </h3>
                    <TaskList tasks={g.tasks} showProject={false} movable draggableRows />
                  </div>
                ))}
              </div>
            )
          ) : (
            <TaskList
              tasks={data}
              showProject={false}
              movable
              draggableRows
              empty={
                <EmptyState
                  icon={ListTodo}
                  title="이 프로젝트에 업무가 없어요"
                  description="업무를 추가하거나, ‘개인 업무 가져오기’에서 끌어다 놓아 보세요."
                  action={addButton("업무 추가")}
                />
              }
            />
          )}
        </div>

        {project.cancelled_tasks > 0 && (
          <div className="mt-4 border-t border-border pt-3">
            <button
              type="button"
              onClick={() => setShowCancelled((v) => !v)}
              aria-expanded={showCancelled}
              aria-controls="project-cancelled-tasks"
              className="flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-sm font-medium text-muted hover:text-primary-dark"
            >
              <Ban size={16} strokeWidth={2} aria-hidden="true" />
              제외된 업무 {project.cancelled_tasks}개 {showCancelled ? "숨기기" : "보기"}
              <ChevronDown size={16} strokeWidth={2} aria-hidden="true" className={`transition-transform ${showCancelled ? "rotate-180" : ""}`} />
            </button>
            {showCancelled && (
              <div id="project-cancelled-tasks" className="mt-1">
                <p className="mb-1 text-xs text-muted">진행률 계산에서 빠진 업무예요. 상태 배지를 눌러 다시 포함할 수 있어요.</p>
                {cancelledQuery.isPending ? (
                  <TaskListSkeleton rows={Math.min(project.cancelled_tasks, 3)} />
                ) : cancelledQuery.isError ? (
                  <ErrorState message={cancelledQuery.error.message} onRetry={() => cancelledQuery.refetch()} retrying={cancelledQuery.isRefetching} />
                ) : (
                  <TaskList tasks={cancelledQuery.data} showProject={false} empty={<p className="py-3 text-sm text-muted">제외된 업무가 없어요.</p>} />
                )}
              </div>
            )}
          </div>
        )}
        {formOpen && <TaskFormDialog defaultProjectId={projectId} onClose={() => setFormOpen(false)} />}
        {drawerOpen && <PersonalTasksDrawer projectId={projectId} projectName={project.name} onClose={() => setDrawerOpen(false)} onImported={onNotice} />}
      </section>
    </NestDropZone>
  );
}
