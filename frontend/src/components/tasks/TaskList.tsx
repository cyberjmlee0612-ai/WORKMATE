"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Ban, CircleAlert, Clock, FolderKanban, History, Info, Pencil, Trash2, UserRound } from "lucide-react";
import { TaskTimerButton } from "@/components/time/TaskTimerButton";
import { TimeEntriesDialog } from "@/components/time/TimeEntriesDialog";
import type { Task } from "@/lib/api/tasks";
import { formatMinutes } from "@/lib/format";
import { useToday } from "@/lib/date";
import { TaskPriorityBadge } from "./TaskBadges";
import { TaskFormDialog } from "./TaskFormDialog";
import { DeleteTaskDialog } from "./DeleteTaskDialog";
import { CancelTaskDialog } from "./CancelTaskDialog";
import { TaskCheckbox } from "./TaskCheckbox";
import { TaskStatusMenu } from "./TaskStatusMenu";
import { DueLabel } from "./DueLabel";

type Props = {
  tasks: Task[];
  /** 프로젝트 상세에서는 프로젝트명을 반복해서 보여줄 필요가 없다 */
  showProject?: boolean;
  empty?: ReactNode;
};

/** 업무 목록 + 수정·삭제·제외 창 관리 */
export function TaskList({ tasks, showProject = true, empty }: Props) {
  const [editing, setEditing] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const [cancelling, setCancelling] = useState<Task | null>(null);
  const [timing, setTiming] = useState<Task | null>(null);
  const today = useToday();

  if (tasks.length === 0) return <>{empty}</>;

  return (
    <>
      <ul className="divide-y divide-border">
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            today={today}
            showProject={showProject}
            onEdit={() => setEditing(task)}
            onDelete={() => setDeleting(task)}
            onCancel={() => setCancelling(task)}
            onOpenTime={() => setTiming(task)}
          />
        ))}
      </ul>
      {timing && <TimeEntriesDialog task={timing} onClose={() => setTiming(null)} />}
      {editing && <TaskFormDialog task={editing} onClose={() => setEditing(null)} />}
      {deleting && <DeleteTaskDialog task={deleting} onClose={() => setDeleting(null)} />}
      {cancelling && <CancelTaskDialog task={cancelling} onClose={() => setCancelling(null)} />}
    </>
  );
}

type RowProps = {
  task: Task;
  today: string | null;
  showProject: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onCancel: () => void;
  onOpenTime: () => void;
};

function TaskRow({ task, today, showProject, onEdit, onDelete, onCancel, onOpenTime }: RowProps) {
  const done = task.status === "completed";
  const cancelled = task.status === "cancelled";
  const minutes = formatMinutes(task.estimated_minutes);
  const tracked = formatMinutes(task.tracked_minutes);
  // 체크박스·상태 메뉴·타이머의 저장 실패 메시지와 결과 안내 (행 안에 표시)
  const [rowError, setRowError] = useState<string | null>(null);
  const [rowNotice, setRowNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!rowNotice) return;
    const id = window.setTimeout(() => setRowNotice(null), 5000);
    return () => window.clearTimeout(id);
  }, [rowNotice]);

  return (
    <li className={`flex min-w-0 items-start gap-2 py-4 md:gap-3 ${cancelled ? "opacity-75" : ""}`}>
      {cancelled ? (
        // 제외한 업무는 완료 체크 대상이 아니다. 상태 메뉴로 되돌린 뒤 체크할 수 있다.
        <span className="flex size-11 shrink-0 items-center justify-center text-muted" aria-hidden="true">
          <Ban size={18} strokeWidth={2} />
        </span>
      ) : (
        <TaskCheckbox task={task} onError={setRowError} />
      )}
      <div className="min-w-0 flex-1 pt-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <TaskStatusMenu task={task} onRequestCancel={onCancel} onError={setRowError} />
          <span className={`min-w-0 break-words text-sm font-medium md:text-[15px] ${done || cancelled ? "text-muted line-through decoration-sage" : "text-foreground"}`}>{task.title}</span>
        </div>
        {cancelled && task.cancel_reason && (
          <p className="mt-1.5 break-words text-xs text-muted">
            <span className="font-medium">제외 사유:</span> {task.cancel_reason}
          </p>
        )}
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
          {/* 완료·제외한 업무는 지연/임박 강조를 하지 않는다 */}
          <DueLabel dueDate={task.due_date} today={today} completed={done || cancelled} />
          {minutes && (
            <span className="inline-flex items-center gap-1">
              <Clock size={14} strokeWidth={2} aria-hidden="true" />
              예상 {minutes}
            </span>
          )}
          {/* 실제 기록 시간. 누르면 기록 목록·직접 입력 창이 열린다 */}
          <button type="button" onClick={onOpenTime} className="inline-flex min-h-6 items-center gap-1 rounded hover:text-primary-dark hover:underline">
            <History size={14} strokeWidth={2} aria-hidden="true" />
            {tracked ? `기록 ${tracked}` : "시간 기록"}
          </button>
        </div>
        {rowError && (
          <p className="mt-2 flex items-center gap-1 text-xs text-red-700" role="alert">
            <CircleAlert size={14} strokeWidth={2} aria-hidden="true" />
            {rowError}
          </p>
        )}
        {rowNotice && !rowError && (
          <p className="mt-2 flex items-center gap-1 text-xs text-primary-dark" role="status">
            <Info size={14} strokeWidth={2} aria-hidden="true" />
            {rowNotice}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <TaskTimerButton task={task} onError={setRowError} onNotice={setRowNotice} />
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
