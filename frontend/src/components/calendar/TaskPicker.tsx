"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderKanban, GripVertical, Search, UserRound } from "lucide-react";
import { listTasks, taskKeys, type Task } from "@/lib/api/tasks";
import { formatMinutes } from "@/lib/format";
import { ErrorState } from "@/components/common/QueryStates";

type Props = {
  selectedId: string | null;
  onSelect: (task: Task) => void;
  /** 마우스로 끌기 시작 (터치는 누르고 배치) */
  onDragStart: (task: Task, event: React.PointerEvent) => void;
};

/** 배치할 업무 목록: 완료·제외하지 않은 업무. 누르면 선택(누르고 배치), 마우스로 끌면 바로 배치. */
export function TaskPicker({ selectedId, onSelect, onDragStart }: Props) {
  const [search, setSearch] = useState("");
  const query = useQuery({ queryKey: taskKeys.list({}), queryFn: () => listTasks({}) });
  const keyword = search.trim().toLowerCase();
  const tasks = (query.data ?? []).filter(
    (t) => t.status !== "completed" && t.status !== "cancelled" && (!keyword || t.title.toLowerCase().includes(keyword) || t.project_name?.toLowerCase().includes(keyword)),
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <label className="relative block">
        <span className="sr-only">업무 검색</span>
        <Search size={16} strokeWidth={2} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="업무 검색"
          className="block min-h-11 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-sm focus:border-primary focus:outline-none focus-visible:outline-2"
        />
      </label>
      <p className="mt-2 text-xs text-muted">업무를 시간표로 끌어다 놓거나, 누른 뒤 원하는 칸을 누르세요.</p>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
        {query.isPending ? (
          <div className="space-y-2" aria-busy="true" aria-label="불러오는 중">
            {[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-pale-green/40" />)}
          </div>
        ) : query.isError ? (
          <ErrorState message={query.error.message} onRetry={() => query.refetch()} retrying={query.isRefetching} />
        ) : tasks.length === 0 ? (
          <p className="rounded-xl bg-background px-3 py-6 text-center text-sm text-muted">{keyword ? "검색 결과가 없어요." : "배치할 업무가 없어요."}</p>
        ) : (
          <ul className="space-y-2">
            {tasks.map((task) => {
              const selected = task.id === selectedId;
              const planned = formatMinutes(task.planned_minutes);
              const estimated = formatMinutes(task.estimated_minutes);
              return (
                <li key={task.id}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onSelect(task)}
                    onPointerDown={(event) => {
                      if (event.pointerType === "mouse" && event.button === 0) onDragStart(task, event);
                    }}
                    className={`flex w-full cursor-grab items-start gap-2 rounded-xl border px-2.5 py-2.5 text-left active:cursor-grabbing ${
                      selected ? "border-primary bg-pale-green ring-2 ring-primary/30" : "border-border bg-surface hover:border-soft-sage hover:bg-pale-green/40"
                    }`}
                  >
                    <GripVertical size={16} strokeWidth={2} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm font-medium text-foreground">{task.title}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                        <span className="inline-flex items-center gap-1">
                          {task.project_id ? <FolderKanban size={12} strokeWidth={2} aria-hidden="true" /> : <UserRound size={12} strokeWidth={2} aria-hidden="true" />}
                          {task.project_name ?? "개인 업무"}
                        </span>
                        {(planned || estimated) && (
                          <span>
                            계획 {planned ?? "0분"}
                            {estimated && <> / 예상 {estimated}</>}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
