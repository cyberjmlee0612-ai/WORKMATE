"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, CircleAlert, LoaderCircle, Trash2, X } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { invalidateWorkData } from "@/lib/api/invalidate";
import { deleteProjectsBulk, moveProjects, type DeletionMode, type SubprojectMode } from "@/lib/api/projects";
import { ancestorsOf, descendantsOf, pathLabel, type ProjectTree } from "@/lib/projectTree";
import { MoveTargetDialog } from "./MoveTargetDialog";

type Props = {
  tree: ProjectTree;
  selectedIds: string[];
  totalCount: number;
  onSelectAll: () => void;
  onClearAll: () => void;
  onDone: (message: string) => void;
  onCancel: () => void;
};

/**
 * 편집 모드 하단 막대 (2026-11-26 사용자 요청): 고른 프로젝트를 다른 프로젝트 안·최상위로 옮기거나 삭제.
 * 상위와 그 하위를 함께 고르면 하위는 상위를 따라간다. 삭제 방법은 모든 선택에 똑같이 적용한다.
 */
export function ProjectBulkBar({ tree, selectedIds, totalCount, onSelectAll, onClearAll, onDone, onCancel }: Props) {
  const queryClient = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [taskMode, setTaskMode] = useState<DeletionMode>("move");
  const [subMode, setSubMode] = useState<SubprojectMode>("lift");

  const selected = new Set(selectedIds);
  // 상위가 함께 선택된 것은 상위를 따라가므로 규칙 검사에서 뺀다
  const roots = selectedIds.filter((id) => !ancestorsOf(tree, id).some((a) => selected.has(a.id)));

  // 삭제 확인에 보여줄 수: 직접 속한 업무(제외 포함), 선택 밖의 하위 프로젝트
  const ownTasks = selectedIds.reduce((n, id) => {
    const p = tree.byId.get(id);
    return n + (p ? p.own_total_tasks + p.cancelled_tasks : 0);
  }, 0);
  const outsideSubs = new Set(roots.flatMap((r) => descendantsOf(tree, r).map((d) => d.id)).filter((id) => !selected.has(id)));

  const move = useMutation({
    mutationFn: (target: string | null) => moveProjects(selectedIds, target),
    onSuccess: async (r, target) => {
      await invalidateWorkData(queryClient);
      const p = target ? tree.byId.get(target) : undefined;
      const where = p ? `‘${pathLabel(tree, p)}’ 안` : "최상위";
      setPicking(false);
      const parts = [`프로젝트 ${r.moved}개를 ${where}(으)로 옮겼어요.`];
      if (r.skipped) parts.push(`${r.skipped}개는 상위와 함께 옮겨졌어요.`);
      if (r.unchanged) parts.push(`${r.unchanged}개는 이미 그곳에 있었어요.`);
      onDone(parts.join(" "));
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteProjectsBulk(selectedIds, taskMode, subMode),
    onSuccess: async (r) => {
      await invalidateWorkData(queryClient);
      const parts = [`프로젝트 ${r.deleted_projects}개를 삭제했어요.`];
      if (r.moved_tasks) parts.push(`업무 ${r.moved_tasks}개는 개인 업무로 옮겼어요.`);
      if (r.deleted_tasks) parts.push(`업무 ${r.deleted_tasks}개를 함께 삭제했어요.`);
      if (r.lifted_subprojects) parts.push(`하위 프로젝트 ${r.lifted_subprojects}개는 한 단계 위로 꺼냈어요.`);
      onDone(parts.join(" "));
    },
  });
  const busy = move.isPending || remove.isPending;
  const describe = (failure: unknown) =>
    failure instanceof ApiError ? (Object.values(failure.fieldErrors)[0] ?? failure.message) : failure ? "처리하지 못했습니다. 다시 시도해 주세요." : null;
  const moveError = describe(move.error);
  const error = describe(remove.error);
  const count = selectedIds.length;

  return (
    <div className="surface-card sticky bottom-[calc(env(safe-area-inset-bottom,0px)+5rem)] z-30 mt-4 rounded-2xl border border-primary/30 p-3 shadow-lg md:bottom-4" role="region" aria-label="프로젝트 편집">
      {deleting ? (
        <div role="group" aria-label="프로젝트 삭제 확인">
          <p className="text-sm font-semibold text-red-800">프로젝트 {count}개를 삭제할까요? 되돌릴 수 없어요.</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <fieldset className="rounded-xl border border-border p-2.5" disabled={busy}>
              <legend className="px-1 text-xs font-semibold text-primary-dark">직접 속한 업무 {ownTasks}개</legend>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="radio" checked={taskMode === "move"} onChange={() => setTaskMode("move")} className="size-4 accent-[var(--primary)]" />
                개인 업무로 옮기기
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="radio" checked={taskMode === "delete"} onChange={() => setTaskMode("delete")} className="size-4 accent-red-700" />
                함께 삭제
              </label>
            </fieldset>
            <fieldset className="rounded-xl border border-border p-2.5" disabled={busy || outsideSubs.size === 0}>
              <legend className="px-1 text-xs font-semibold text-primary-dark">선택하지 않은 하위 프로젝트 {outsideSubs.size}개</legend>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="radio" checked={subMode === "lift"} onChange={() => setSubMode("lift")} className="size-4 accent-[var(--primary)]" />
                한 단계 위로 꺼내기
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="radio" checked={subMode === "delete"} onChange={() => setSubMode("delete")} className="size-4 accent-red-700" />
                그 안의 업무까지 함께 삭제
              </label>
            </fieldset>
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button type="button" autoFocus onClick={() => setDeleting(false)} disabled={busy} className="min-h-11 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-primary-dark">취소</button>
            <button type="button" onClick={() => !busy && remove.mutate()} disabled={busy} aria-busy={remove.isPending} className="flex min-h-11 items-center gap-1.5 rounded-xl bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60">
              {remove.isPending && <LoaderCircle size={16} strokeWidth={2} className="animate-spin" aria-hidden="true" />}
              {count}개 삭제
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-primary-dark" aria-live="polite">{count}개 선택</span>
          <button type="button" onClick={count === totalCount ? onClearAll : onSelectAll} className="min-h-11 rounded-lg px-2 text-sm font-medium text-primary hover:underline">
            {count === totalCount ? "선택 해제" : "전체 선택"}
          </button>
          <span className="hidden text-xs text-muted lg:inline">고른 카드를 끌어 다른 카드에 넣을 수도 있어요</span>
          <button
            type="button"
            onClick={() => {
              move.reset();
              setPicking(true);
            }}
            disabled={busy || count === 0}
            className="ml-auto flex min-h-11 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-60"
          >
            <ArrowRightLeft size={16} strokeWidth={2} aria-hidden="true" />
            이동…
          </button>
          <button
            type="button"
            onClick={() => {
              remove.reset();
              setDeleting(true);
            }}
            disabled={busy || count === 0}
            className="flex min-h-11 items-center gap-1.5 rounded-xl border border-red-200 px-3 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
            삭제
          </button>
          <button type="button" onClick={onCancel} disabled={busy} className="flex size-11 items-center justify-center rounded-xl text-muted hover:bg-pale-green hover:text-primary-dark" aria-label="편집 끝내기">
            <X size={18} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      )}
      {error && (
        <p className="mt-2 flex items-center gap-1 text-xs text-red-700" role="alert">
          <CircleAlert size={14} strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}
      {picking && (
        <MoveTargetDialog
          tree={tree}
          kind="project"
          count={count}
          movingProjectIds={selectedIds}
          pending={move.isPending}
          error={moveError}
          onConfirm={(target) => move.mutate(target)}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
