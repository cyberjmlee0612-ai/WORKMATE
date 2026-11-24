"use client";

import { Suspense, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ListTodo, Plus } from "lucide-react";
import { listProjects, projectKeys } from "@/lib/api/projects";
import {
  TASK_FILTER_STATUSES, TASK_PRIORITIES, TASK_PRIORITY_LABEL, TASK_STATUS_LABEL, listTasks, taskKeys,
  type TaskFilters, type TaskScope,
} from "@/lib/api/tasks";
import { TaskList, TaskListSkeleton } from "@/components/tasks/TaskList";
import { TaskFormDialog } from "@/components/tasks/TaskFormDialog";
import { EmptyState, ErrorState } from "@/components/common/QueryStates";

const SCOPES: { value: TaskScope; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "project", label: "프로젝트 업무" },
  { value: "personal", label: "개인 업무" },
];

function pick<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return allowed.includes(value as T) ? (value as T) : undefined;
}

export default function TasksPage() {
  // useSearchParams를 쓰는 클라이언트 페이지는 Suspense 경계가 필요하다
  return (
    <Suspense fallback={<TaskListSkeleton />}>
      <TasksContent />
    </Suspense>
  );
}

function TasksContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [formOpen, setFormOpen] = useState(false);

  // 필터는 URL에 저장해 새로고침·공유 시에도 유지한다. 잘못된 값은 무시한다.
  const scope = pick(searchParams.get("scope"), ["all", "project", "personal"] as const) ?? "all";
  const projectId = scope === "project" ? searchParams.get("project_id") ?? undefined : undefined;
  // 상태 필터가 없으면 서버가 제외(cancelled)한 업무를 숨긴다. '제외됨'을 고르면 제외한 업무만 본다.
  const status = pick(searchParams.get("status"), TASK_FILTER_STATUSES);
  const priority = pick(searchParams.get("priority"), TASK_PRIORITIES);
  const filters: TaskFilters = { scope, project_id: projectId, status, priority };

  const tasksQuery = useQuery({ queryKey: taskKeys.list(filters), queryFn: () => listTasks(filters) });
  const projectsQuery = useQuery({ queryKey: projectKeys.list(), queryFn: listProjects, enabled: scope === "project" });

  function setParams(changes: Record<string, string | undefined>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value && value !== "all") next.set(key, value);
      else next.delete(key);
    }
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  const hasFilter = Boolean(status || priority || projectId);
  const selectClass = "min-h-11 rounded-xl border border-border bg-surface px-3 text-sm text-foreground focus:border-primary focus:outline-none";

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <p className="font-geist text-xs font-semibold uppercase tracking-[0.22em] text-primary">Tasks</p>
          <h1 className="mt-3 text-[28px] font-bold leading-tight text-primary-dark md:text-[32px]">업무 관리</h1>
          <p className="mt-2 text-sm text-muted md:text-base">프로젝트 업무와 개인 업무를 한곳에서 관리하세요.</p>
        </div>
        <button type="button" onClick={() => setFormOpen(true)} className="flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 font-semibold text-white hover:bg-primary-dark">
          <Plus size={20} strokeWidth={2} aria-hidden="true" />
          <span className="text-sm">새 업무</span>
        </button>
      </header>

      <section className="surface-card mt-8 rounded-[20px] p-4 md:p-5 lg:p-6" aria-label="업무 목록">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex rounded-xl bg-pale-green/60 p-1" role="tablist" aria-label="업무 구분">
            {SCOPES.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={scope === value}
                onClick={() => setParams({ scope: value, project_id: undefined })}
                className={`min-h-10 rounded-lg px-3 text-sm font-medium transition-colors ${scope === value ? "bg-surface font-semibold text-primary-dark shadow-sm" : "text-muted hover:text-primary-dark"}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {scope === "project" && (
              <select aria-label="프로젝트 필터" value={projectId ?? ""} onChange={(e) => setParams({ project_id: e.target.value || undefined })} className={selectClass}>
                <option value="">모든 프로젝트</option>
                {projectsQuery.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            <select aria-label="상태 필터" value={status ?? ""} onChange={(e) => setParams({ status: e.target.value || undefined })} className={selectClass}>
              <option value="">모든 상태 (제외됨 빼고)</option>
              {TASK_FILTER_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}
            </select>
            <select aria-label="우선순위 필터" value={priority ?? ""} onChange={(e) => setParams({ priority: e.target.value || undefined })} className={selectClass}>
              <option value="">모든 우선순위</option>
              {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{TASK_PRIORITY_LABEL[p]}</option>)}
            </select>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between text-sm text-muted" aria-live="polite">
          {tasksQuery.data && <span>{tasksQuery.data.length}개의 업무</span>}
          {hasFilter && (
            <button type="button" onClick={() => setParams({ status: undefined, priority: undefined, project_id: undefined })} className="min-h-11 rounded-lg px-2 font-medium text-primary hover:underline">
              필터 초기화
            </button>
          )}
        </div>

        <div className="mt-2">
          {tasksQuery.isPending ? (
            <TaskListSkeleton />
          ) : tasksQuery.isError ? (
            <ErrorState message={tasksQuery.error.message} onRetry={() => tasksQuery.refetch()} retrying={tasksQuery.isRefetching} />
          ) : (
            <TaskList
              tasks={tasksQuery.data}
              empty={
                <EmptyState
                  icon={ListTodo}
                  title={
                    status === "cancelled"
                      ? "제외한 업무가 없어요"
                      : hasFilter
                        ? "조건에 맞는 업무가 없어요"
                        : scope === "personal"
                          ? "개인 업무가 없어요"
                          : "아직 업무가 없어요"
                  }
                  description={
                    status === "cancelled"
                      ? "업무 상태 배지를 눌러 ‘업무에서 제외’를 고르면 여기에 보관돼요."
                      : hasFilter
                        ? "필터를 바꾸거나 초기화해 보세요."
                        : "새 업무를 추가해 할 일을 정리해 보세요."
                  }
                  action={
                    !hasFilter && (
                      <button type="button" onClick={() => setFormOpen(true)} className="flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark">
                        <Plus size={18} strokeWidth={2} aria-hidden="true" />
                        업무 추가
                      </button>
                    )
                  }
                />
              }
            />
          )}
        </div>
      </section>

      {/* 프로젝트 탭에서 특정 프로젝트를 보고 있으면 그 프로젝트를 미리 선택 */}
      {formOpen && <TaskFormDialog defaultProjectId={projectId ?? null} onClose={() => setFormOpen(false)} />}
    </>
  );
}
