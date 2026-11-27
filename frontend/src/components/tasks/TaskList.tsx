"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ListChecks, Ban, CircleAlert, Clock, FolderKanban, History, Info, Pencil, Repeat, Trash2, UserRound } from "lucide-react";
import { MoveTasksBar } from "./MoveTasksBar";
import { endDrag, startDrag } from "@/lib/dnd";
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
  /** 여러 업무를 골라 다른 프로젝트·개인 업무로 옮기는 기능 표시 (업무 관리·프로젝트 상세) */
  movable?: boolean;
  /** 업무 행을 끌어서 프로젝트 카드(폴더)에 넣을 수 있게 (프로젝트 상세의 하위 프로젝트 등) */
  draggableRows?: boolean;
};

/** 업무 목록 + 수정·삭제·제외·이동 창 관리 */
export function TaskList({ tasks, showProject = true, empty, movable = false, draggableRows = false }: Props) {
  const [editing, setEditing] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const [cancelling, setCancelling] = useState<Task | null>(null);
  const [timing, setTiming] = useState<Task | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [moveNotice, setMoveNotice] = useState<string | null>(null);
  const today = useToday();

  useEffect(() => {
    if (!moveNotice) return;
    const id = window.setTimeout(() => setMoveNotice(null), 6000);
    return () => window.clearTimeout(id);
  }, [moveNotice]);

  // 다시 조회해서 목록에서 빠진 업무는 선택에서도 뺀다
  const selectedIds = tasks.filter((t) => selected.has(t.id)).map((t) => t.id);
  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const notice = moveNotice && (
    <p className="mb-2 flex items-center gap-1.5 rounded-xl bg-pale-green/60 px-3 py-2 text-sm text-primary-dark" role="status">
      <Info size={16} strokeWidth={2} className="shrink-0" aria-hidden="true" />
      {moveNotice}
    </p>
  );

  if (tasks.length === 0) return <>{notice}{empty}</>;

  return (
    <>
      {notice}
      {movable && !selecting && (
        <div className="flex justify-end">
          <button type="button" onClick={() => setSelecting(true)} className="flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-primary-dark hover:bg-pale-green">
            <ListChecks size={16} strokeWidth={2} aria-hidden="true" />
            편집
          </button>
        </div>
      )}
      {selecting && <p className="text-sm text-muted">업무를 여러 개 고른 뒤, 아래에서 옮기거나 삭제하세요.</p>}
      <ul className="divide-y divide-border">
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            today={today}
            showProject={showProject}
            selection={selecting ? { checked: selected.has(task.id), onToggle: () => toggle(task.id) } : null}
            draggable={draggableRows}
            // 편집 모드에서 고른 업무를 끌면 고른 것 전부를 함께 끈다
            dragTasks={selecting && selected.has(task.id) && selectedIds.length > 1 ? tasks.filter((t) => selected.has(t.id)) : [task]}
            onDragged={stopSelecting}
            onEdit={() => setEditing(task)}
            onDelete={() => setDeleting(task)}
            onCancel={() => setCancelling(task)}
            onOpenTime={() => setTiming(task)}
          />
        ))}
      </ul>
      {selecting && (
        <MoveTasksBar
          selectedIds={selectedIds}
          totalCount={tasks.length}
          onSelectAll={() => setSelected(new Set(tasks.map((t) => t.id)))}
          onClearAll={() => setSelected(new Set())}
          onDone={(message) => {
            setMoveNotice(message);
            stopSelecting();
          }}
          onCancel={stopSelecting}
        />
      )}
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
  /** 이동할 업무를 고르는 중이면 완료 체크 대신 선택 체크를 보여주고 행 동작 버튼을 숨긴다 */
  selection: { checked: boolean; onToggle: () => void } | null;
  draggable: boolean;
  dragTasks: Task[];
  onDragged: () => void;
};

function TaskRow({ task, today, showProject, selection, draggable, dragTasks, onDragged, onEdit, onDelete, onCancel, onOpenTime }: RowProps) {
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
    <li
      draggable={draggable}
      onDragStart={
        draggable
          ? (event) =>
              startDrag(event, {
                kind: "task",
                ids: dragTasks.map((t) => t.id),
                name: dragTasks.length > 1 ? `업무 ${dragTasks.length}개` : task.title,
                fromProjectIds: dragTasks.map((t) => t.project_id),
              })
          : undefined
      }
      onDragEnd={
        draggable
          ? (event) => {
              endDrag();
              // 다른 곳에 놓아 옮겼으면 편집 모드를 끝낸다 (dropEffect: none = 놓지 않음)
              if (selection && event.dataTransfer.dropEffect !== "none") onDragged();
            }
          : undefined
      }
      title={draggable ? "끌어서 프로젝트 카드에 넣을 수 있어요" : undefined}
      className={`flex min-w-0 items-start gap-2 py-4 md:gap-3 ${cancelled ? "opacity-75" : ""} ${selection?.checked ? "bg-pale-green/40" : ""} ${draggable ? "md:cursor-grab md:active:cursor-grabbing" : ""}`}
    >
      {selection ? (
        <label className="flex size-11 shrink-0 cursor-pointer items-center justify-center">
          <input type="checkbox" checked={selection.checked} onChange={selection.onToggle} className="size-5 accent-[var(--color-primary)]" aria-label={`${task.title} 이동할 업무로 선택`} />
        </label>
      ) : cancelled ? (
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
          {task.routine_id && (
            <Link href="/routines" className="inline-flex items-center gap-1 rounded hover:text-primary-dark hover:underline" title="반복으로 만든 업무">
              <Repeat size={14} strokeWidth={2} aria-hidden="true" />
              반복
            </Link>
          )}
          {showProject &&
            (task.project_id ? (
              <Link href={`/projects/${task.project_id}`} className="inline-flex items-center gap-1 rounded hover:text-primary-dark hover:underline">
                <FolderKanban size={14} strokeWidth={2} aria-hidden="true" />
                {task.project_path ?? task.project_name}
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
      {!selection && (
      <div className="flex shrink-0 items-center gap-1">
        <TaskTimerButton task={task} onError={setRowError} onNotice={setRowNotice} />
        <button type="button" onClick={onEdit} className="flex size-11 items-center justify-center rounded-xl text-muted hover:bg-pale-green hover:text-primary-dark" aria-label={`${task.title} 수정`} title="수정">
          <Pencil size={18} strokeWidth={2} aria-hidden="true" />
        </button>
        <button type="button" onClick={onDelete} className="flex size-11 items-center justify-center rounded-xl text-muted hover:bg-red-50 hover:text-red-700" aria-label={`${task.title} 삭제`} title="삭제">
          <Trash2 size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
      )}
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
