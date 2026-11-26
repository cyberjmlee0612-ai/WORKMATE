"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, CircleAlert, LoaderCircle, Trash2, X } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { invalidateWorkData } from "@/lib/api/invalidate";
import { listProjects, projectKeys } from "@/lib/api/projects";
import { deleteTasksBulk, moveTasks } from "@/lib/api/tasks";
import { buildTree, pathLabel } from "@/lib/projectTree";
import { MoveTargetDialog } from "@/components/projects/MoveTargetDialog";

type Props = {
  selectedIds: string[];
  totalCount: number;
  onSelectAll: () => void;
  onClearAll: () => void;
  onDone: (message: string) => void;
  onCancel: () => void;
};

/**
 * 편집 모드 하단 막대 (2026-11-26 사용자 요청): 고른 업무를 옮기거나 삭제.
 * '이동'은 프로젝트 나무 모양 선택 창을 연다. 업무 ID는 그대로라 시간 기록·계획이 따라간다.
 * 고른 업무 중 하나를 끌면 고른 것 전부를 프로젝트 카드(폴더)에 넣을 수도 있다.
 */
export function MoveTasksBar({ selectedIds, totalCount, onSelectAll, onClearAll, onDone, onCancel }: Props) {
  const queryClient = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const projectsQuery = useQuery({ queryKey: projectKeys.list(), queryFn: listProjects });
  const tree = buildTree(projectsQuery.data ?? []);

  const move = useMutation({
    mutationFn: (target: string | null) => moveTasks(selectedIds, target),
    onSuccess: async (result, target) => {
      await invalidateWorkData(queryClient);
      const p = target ? tree.byId.get(target) : undefined;
      const where = p ? `‘${pathLabel(tree, p)}’` : "개인 업무";
      const parts = [`업무 ${result.moved}개를 ${where}(으)로 옮겼어요.`];
      if (result.unchanged) parts.push(`${result.unchanged}개는 이미 그곳에 있었어요.`);
      if (result.missing) parts.push(`${result.missing}개는 찾을 수 없었어요(삭제됨).`);
      setPicking(false);
      onDone(parts.join(" "));
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fieldErrors.project_id) queryClient.invalidateQueries({ queryKey: projectKeys.all });
    },
  });
  const removal = useMutation({
    mutationFn: () => deleteTasksBulk(selectedIds),
    onSuccess: async (result) => {
      await invalidateWorkData(queryClient);
      onDone(`업무 ${result.deleted}개를 삭제했어요.${result.missing ? ` ${result.missing}개는 이미 없었어요.` : ""}`);
    },
  });
  const busy = move.isPending || removal.isPending;
  const moveError = move.error instanceof ApiError ? (move.error.fieldErrors.project_id ?? move.error.message) : move.error ? "옮기지 못했습니다. 다시 시도해 주세요." : null;
  const deleteError = removal.error ? (removal.error instanceof ApiError ? removal.error.message : "삭제하지 못했습니다. 다시 시도해 주세요.") : null;
  const count = selectedIds.length;

  return (
    <div className="surface-card sticky bottom-[calc(env(safe-area-inset-bottom,0px)+5rem)] z-30 mt-3 rounded-2xl border border-primary/30 p-3 shadow-lg md:bottom-4" role="region" aria-label="업무 편집">
      {confirmDelete ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="업무 삭제 확인">
          <span className="mr-auto text-sm font-semibold text-red-800">업무 {count}개를 삭제할까요? 시간 기록·계획도 함께 지워지고 되돌릴 수 없어요.</span>
          <button type="button" autoFocus onClick={() => setConfirmDelete(false)} disabled={busy} className="min-h-11 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-primary-dark">취소</button>
          <button type="button" onClick={() => !busy && removal.mutate()} disabled={busy || count === 0} aria-busy={removal.isPending} className="flex min-h-11 items-center gap-1.5 rounded-xl bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60">
            {removal.isPending && <LoaderCircle size={16} strokeWidth={2} className="animate-spin" aria-hidden="true" />}
            {count}개 삭제
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-primary-dark" aria-live="polite">{count}개 선택</span>
          <button type="button" onClick={count === totalCount ? onClearAll : onSelectAll} className="min-h-11 rounded-lg px-2 text-sm font-medium text-primary hover:underline">
            {count === totalCount ? "선택 해제" : "전체 선택"}
          </button>
          <span className="hidden text-xs text-muted lg:inline">고른 업무를 끌어 프로젝트 카드에 넣을 수도 있어요</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                move.reset();
                setPicking(true);
              }}
              disabled={count === 0 || busy}
              className="flex min-h-11 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-60"
            >
              <ArrowRightLeft size={16} strokeWidth={2} aria-hidden="true" />
              이동…
            </button>
            <button
              type="button"
              onClick={() => {
                removal.reset();
                setConfirmDelete(true);
              }}
              disabled={count === 0 || busy}
              className="flex min-h-11 items-center gap-1.5 rounded-xl border border-red-200 px-3 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
              삭제
            </button>
            <button type="button" onClick={onCancel} disabled={busy} className="flex size-11 items-center justify-center rounded-xl text-muted hover:bg-pale-green hover:text-primary-dark" aria-label="편집 끝내기">
              <X size={18} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
      {deleteError && (
        <p className="mt-2 flex items-center gap-1 text-xs text-red-700" role="alert">
          <CircleAlert size={14} strokeWidth={2} aria-hidden="true" />
          {deleteError}
        </p>
      )}
      {picking && (
        <MoveTargetDialog tree={tree} kind="task" count={count} pending={move.isPending} error={moveError} onConfirm={(target) => move.mutate(target)} onClose={() => setPicking(false)} />
      )}
    </div>
  );
}
