"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/client";
import { invalidateWorkData } from "@/lib/api/invalidate";
import { moveProjects } from "@/lib/api/projects";
import { moveTasks } from "@/lib/api/tasks";
import { flyInto, type DragItem } from "@/lib/dnd";
import { ancestorsOf, cannotNest, categoryOf, type ProjectTree } from "@/lib/projectTree";

export type Feedback = { message: string; error: boolean } | null;

/**
 * 끌어다 놓을 수 있는지: 놓을 수 없으면 이유, 있으면 null.
 * targetId = null 은 '최상위로 꺼내기' 영역 (프로젝트만).
 */
export function acceptInto(tree: ProjectTree, targetId: string | null) {
  return (item: DragItem): string | null => {
    if (item.kind === "project") {
      if (targetId !== null && item.ids.includes(targetId)) return ""; // 끌고 있는 것 위: 아무 표시도 하지 않음
      const selected = new Set(item.ids);
      // 상위가 함께 끌리는 것은 상위를 따라가므로 검사에서 뺀다 (서버 move_projects와 같음)
      const roots = item.ids.filter((id) => !ancestorsOf(tree, id).some((a) => selected.has(a.id)));
      if (targetId === null) return roots.some((id) => tree.byId.get(id)?.parent_id) ? null : "이미 최상위에 있어요.";
      for (const id of roots) {
        const why = cannotNest(tree, id, targetId);
        if (why && !(roots.length > 1 && why === "이미 그 안에 있어요.")) return roots.length > 1 ? `‘${tree.byId.get(id)?.name}’: ${why}` : why;
      }
      return null;
    }
    if (targetId === null) return "업무는 프로젝트 안에 넣어 주세요.";
    const target = tree.byId.get(targetId);
    if (!target || categoryOf(target.status) !== "active") return "완료하거나 보관한 프로젝트에는 넣을 수 없어요.";
    if (item.fromProjectIds?.length && item.fromProjectIds.every((p) => p === targetId)) return "이미 이 프로젝트에 있어요.";
    return null;
  };
}

/** 놓았을 때: 빨려 들어가는 효과 → 서버 저장 → 다시 조회. 결과는 onFeedback으로 알린다. */
export function useNestActions(onFeedback: (feedback: Feedback) => void) {
  const queryClient = useQueryClient();
  const fail = (err: unknown) => {
    invalidateWorkData(queryClient);
    const message = err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : "옮기지 못했습니다. 다시 시도해 주세요.";
    onFeedback({ message, error: true });
  };

  const projectMove = useMutation({
    mutationFn: ({ ids, parentId }: { ids: string[]; parentId: string | null; message: string }) => moveProjects(ids, parentId),
    onSuccess: async (_data, vars) => {
      await invalidateWorkData(queryClient);
      onFeedback({ message: vars.message, error: false });
    },
    onError: fail,
  });
  const taskMove = useMutation({
    mutationFn: ({ ids, projectId }: { ids: string[]; projectId: string; message: string }) => moveTasks(ids, projectId),
    onSuccess: async (_data, vars) => {
      await invalidateWorkData(queryClient);
      onFeedback({ message: vars.message, error: false });
    },
    onError: fail,
  });

  /** 놓은 뒤 처리. onMoved는 저장 성공 후 호출 (예: 편집 모드 끝내기) */
  function drop(item: DragItem, targetId: string | null, targetName: string, point: { x: number; y: number }, element: HTMLElement, onMoved?: () => void) {
    flyInto(point, element, item.name);
    onFeedback(null);
    const where = targetId ? `‘${targetName}’ 안으로` : "최상위로";
    const what = item.ids.length > 1 ? item.name : `‘${item.name}’`;
    const options = { onSuccess: () => onMoved?.() };
    if (item.kind === "project") projectMove.mutate({ ids: item.ids, parentId: targetId, message: `${what} 프로젝트를 ${where} 옮겼어요.` }, options);
    else if (targetId) taskMove.mutate({ ids: item.ids, projectId: targetId, message: `${what} 업무를 ${where} 옮겼어요.` }, options);
  }

  return { drop, pending: projectMove.isPending || taskMove.isPending };
}
