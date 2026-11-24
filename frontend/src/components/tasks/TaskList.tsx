"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { CalendarDays, Clock, FolderKanban, Pencil, Trash2, UserRound } from "lucide-react";
import type { Task } from "@/lib/api/tasks";
import { formatDate, formatMinutes } from "@/lib/format";
import { TaskPriorityBadge, TaskStatusBadge } from "./TaskBadges";
import { TaskFormDialog } from "./TaskFormDialog";
import { DeleteTaskDialog } from "./DeleteTaskDialog";

type Props = {
  tasks: Task[];
  /** 프로젝트 상세에서는 프로젝트명을 반복해서 보여줄 필요가 없다 */
  showProject?: boolean;
  empty?: ReactNode;
};

/** 업무 목록 + 수정·삭제 창 관리 */
export function TaskList({ tasks, showProject = true, empty }: Props) {
  const [editing, setEditing] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);

  if (tasks.length === 0) return <>{empty}</>;

  return (
    <>
      <ul className="divide-y divide-border">
        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} showProject={showProject} onEdit={() => setEditing(task)} onDelete={() => setDeleting(task)} />
        ))}
      </ul>
      {editing && <TaskFormDialog task={editing} onClose={() => setEditing(null)} />}
      {deleting && <DeleteTaskDialog task={deleting} onClose={() => setDeleting(null)} />}
    </>
  );
}

function TaskRow({ task, showProject, onEdit, onDelete }: { task: Task; showProject: boolean; onEdit: () => void; onDelete: () => void }) {
  const done = task.status === "completed";
  const due = formatDate(task.due_date);
  const minutes = formatMinutes(task.estimated_minutes);

  return (
    <li className="flex min-w-0 items-start gap-3 py-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <TaskStatusBadge status={task.status} />
          <span className={`min-w-0 break-words text-sm font-medium md:text-[15px] ${done ? "text-muted line-through decoration-sage" : "text-foreground"}`}>{task.title}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
          <TaskPriorityBadge priority={task.priority} />
          {showProject &&
            (task.project_id ? (
              <Link href={`/projects/${task.project_id}`} className="inline-flex items-center gap-1 rounded hover:text-primary-dark hover:underline">
                <FolderKanban size={14} strokeWidth={2} aria-hidden="true" />
                {task.project_name}
              </Link>
            ) : (
              <span className="inline-flex items-center gap-1">
                <UserRound size={14} strokeWidth={2} aria-hidden="true" />
                개인 업무
              </span>
            ))}
          <span className="inline-flex items-center gap-1">
            <CalendarDays size={14} strokeWidth={2} aria-hidden="true" />
            {due ? `마감 ${due}` : "마감일 없음"}
          </span>
          {minutes && (
            <span className="inline-flex items-center gap-1">
              <Clock size={14} strokeWidth={2} aria-hidden="true" />
              예상 {minutes}
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button type="button" onClick={onEdit} className="flex size-11 items-center justify-center rounded-xl text-muted hover:bg-pale-green hover:text-primary-dark" aria-label={`${task.title} 수정`} title="수정">
          <Pencil size={18} strokeWidth={2} aria-hidden="true" />
        </button>
        <button type="button" onClick={onDelete} className="flex size-11 items-center justify-center rounded-xl text-muted hover:bg-red-50 hover:text-red-700" aria-label={`${task.title} 삭제`} title="삭제">
          <Trash2 size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

export function TaskListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="불러오는 중">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-pale-green/40" />)}
    </div>
  );
}
