"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ListTodo, Plus } from "lucide-react";
import { listTasks, taskKeys } from "@/lib/api/tasks";
import { EmptyState, ErrorState } from "@/components/common/QueryStates";
import { TaskList, TaskListSkeleton } from "./TaskList";
import { TaskFormDialog } from "./TaskFormDialog";

/** 프로젝트 상세의 소속 업무 목록 */
export function ProjectTasksSection({ projectId }: { projectId: string }) {
  const [formOpen, setFormOpen] = useState(false);
  const filters = { project_id: projectId };
  const { data, isPending, isError, error, refetch, isRefetching } = useQuery({ queryKey: taskKeys.list(filters), queryFn: () => listTasks(filters) });

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
      {formOpen && <TaskFormDialog defaultProjectId={projectId} onClose={() => setFormOpen(false)} />}
    </section>
  );
}
