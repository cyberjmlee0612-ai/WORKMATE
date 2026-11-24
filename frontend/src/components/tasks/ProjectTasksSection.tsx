"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Ban, ChevronDown, ListTodo, Plus } from "lucide-react";
import { listTasks, taskKeys, type TaskFilters } from "@/lib/api/tasks";
import { EmptyState, ErrorState } from "@/components/common/QueryStates";
import { TaskList, TaskListSkeleton } from "./TaskList";
import { TaskFormDialog } from "./TaskFormDialog";

/** 프로젝트 상세의 소속 업무 목록. 제외한 업무는 기본으로 숨기고 펼쳐서 볼 수 있다. */
export function ProjectTasksSection({ projectId, cancelledCount }: { projectId: string; cancelledCount: number }) {
  const [formOpen, setFormOpen] = useState(false);
  const [showCancelled, setShowCancelled] = useState(false);
  const filters: TaskFilters = { project_id: projectId };
  const cancelledFilters: TaskFilters = { project_id: projectId, status: "cancelled" };
  const { data, isPending, isError, error, refetch, isRefetching } = useQuery({ queryKey: taskKeys.list(filters), queryFn: () => listTasks(filters) });
  // 펼쳤을 때만 불러온다
  const cancelledQuery = useQuery({ queryKey: taskKeys.list(cancelledFilters), queryFn: () => listTasks(cancelledFilters), enabled: showCancelled });

  const addButton = (label: string) => (
    <button type="button" onClick={() => setFormOpen(true)} className="flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark">
      <Plus size={18} strokeWidth={2} aria-hidden="true" />
      {label}
    </button>
  );

  return (
    <section className="surface-card mt-6 rounded-[20px] p-4 md:p-5 lg:p-6" aria-labelledby="project-tasks-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="project-tasks-heading" className="text-xl font-bold text-primary-dark">업무</h2>
          {data && <p className="mt-1 text-sm text-muted">{data.length}개의 업무</p>}
        </div>
        {data && data.length > 0 && addButton("업무 추가")}
      </div>
      <div className="mt-4">
        {isPending ? (
          <TaskListSkeleton rows={3} />
        ) : isError ? (
          <ErrorState message={error.message} onRetry={() => refetch()} retrying={isRefetching} />
        ) : (
          <TaskList
            tasks={data}
            showProject={false}
            empty={<EmptyState icon={ListTodo} title="이 프로젝트에 업무가 없어요" description="첫 업무를 추가해 진행 상황을 관리해 보세요." action={addButton("업무 추가")} />}
          />
        )}
      </div>

      {cancelledCount > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <button
            type="button"
            onClick={() => setShowCancelled((v) => !v)}
            aria-expanded={showCancelled}
            aria-controls="project-cancelled-tasks"
            className="flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-sm font-medium text-muted hover:text-primary-dark"
          >
            <Ban size={16} strokeWidth={2} aria-hidden="true" />
            제외된 업무 {cancelledCount}개 {showCancelled ? "숨기기" : "보기"}
            <ChevronDown size={16} strokeWidth={2} aria-hidden="true" className={`transition-transform ${showCancelled ? "rotate-180" : ""}`} />
          </button>
          {showCancelled && (
            <div id="project-cancelled-tasks" className="mt-1">
              <p className="mb-1 text-xs text-muted">진행률 계산에서 빠진 업무예요. 상태 배지를 눌러 다시 포함할 수 있어요.</p>
              {cancelledQuery.isPending ? (
                <TaskListSkeleton rows={Math.min(cancelledCount, 3)} />
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
    </section>
  );
}
