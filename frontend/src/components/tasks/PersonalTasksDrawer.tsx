"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, GripVertical, LoaderCircle, Search, UserRound, X } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { invalidateWorkData } from "@/lib/api/invalidate";
import { TASK_STATUS_LABEL, listTasks, moveTasks, taskKeys } from "@/lib/api/tasks";
import { endDrag, startDrag } from "@/lib/dnd";

type Props = {
  projectId: string;
  projectName: string;
  onClose: () => void;
  onImported: (message: string) => void;
};

/**
 * 프로젝트 상세의 '개인 업무 가져오기' 옆 패널 (2026-11-26 사용자 요청).
 * 업무를 끌어 프로젝트 업무 목록이나 하위 프로젝트 카드에 놓거나, 골라서 버튼으로 가져온다(터치·키보드).
 * 끌기가 가능하도록 모달이 아닌 옆 패널로 연다.
 */
export function PersonalTasksDrawer({ projectId, projectName, onClose, onImported }: Props) {
  const queryClient = useQueryClient();
  const panelRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const query = useQuery({ queryKey: taskKeys.list({ scope: "personal" }), queryFn: () => listTasks({ scope: "personal" }) });

  // 열릴 때 한 번만 패널로 포커스. Esc로 닫기 (onClose는 렌더마다 바뀔 수 있어 ref로 최신 값을 쓴다)
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const keyword = search.trim().toLowerCase();
  const tasks = (query.data ?? []).filter((t) => !keyword || t.title.toLowerCase().includes(keyword));
  const selectedIds = tasks.filter((t) => selected.has(t.id)).map((t) => t.id);

  const importMutation = useMutation({
    mutationFn: () => moveTasks(selectedIds, projectId),
    onSuccess: async (r) => {
      await invalidateWorkData(queryClient);
      setSelected(new Set());
      onImported(`개인 업무 ${r.moved}개를 ‘${projectName}’(으)로 가져왔어요.`);
    },
  });

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      aria-label="개인 업무 가져오기"
      className="fixed inset-x-0 bottom-0 top-auto z-50 flex max-h-[75dvh] flex-col rounded-t-[20px] border border-border bg-surface shadow-2xl outline-none md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-96 md:rounded-none md:rounded-l-[20px]"
    >
      <div className="flex items-start justify-between gap-2 border-b border-border p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-bold text-primary-dark">
            <UserRound size={18} strokeWidth={2} aria-hidden="true" />
            개인 업무 가져오기
          </h2>
          <p className="mt-0.5 text-xs text-muted">업무를 끌어 프로젝트 업무 목록이나 하위 프로젝트 카드에 놓으세요. 여러 개를 고르면 함께 끌려가요.</p>
        </div>
        <button type="button" onClick={onClose} className="-mr-1 flex size-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-pale-green" aria-label="닫기">
          <X size={20} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      <div className="p-4 pb-2">
        <label className="relative block">
          <span className="sr-only">개인 업무 검색</span>
          <Search size={16} strokeWidth={2} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="개인 업무 검색" className="block min-h-11 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-sm focus:border-primary focus:outline-none" />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        {query.isPending ? (
          <div className="space-y-2" aria-busy="true" aria-label="불러오는 중">
            {[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-pale-green/40" />)}
          </div>
        ) : query.isError ? (
          <p className="text-sm text-red-700" role="alert">개인 업무를 불러오지 못했습니다.</p>
        ) : tasks.length === 0 ? (
          <p className="rounded-xl bg-background px-3 py-8 text-center text-sm text-muted">{keyword ? "검색 결과가 없어요." : "가져올 개인 업무가 없어요."}</p>
        ) : (
          <ul className="space-y-1.5 pb-2">
            {tasks.map((task) => {
              const checked = selected.has(task.id);
              const group = checked && selectedIds.length > 1 ? tasks.filter((t) => selected.has(t.id)) : [task];
              return (
                <li
                  key={task.id}
                  draggable
                  onDragStart={(event) =>
                    startDrag(event, { kind: "task", ids: group.map((t) => t.id), name: group.length > 1 ? `업무 ${group.length}개` : task.title, fromProjectIds: group.map(() => null) })
                  }
                  onDragEnd={endDrag}
                  className={`flex items-center gap-2 rounded-xl border px-2 py-1.5 md:cursor-grab md:active:cursor-grabbing ${checked ? "border-primary bg-pale-green/60" : "border-border bg-background/60 hover:border-soft-sage"}`}
                >
                  <GripVertical size={16} strokeWidth={2} className="hidden shrink-0 text-muted md:block" aria-hidden="true" />
                  <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2">
                    <input type="checkbox" checked={checked} onChange={() => toggle(task.id)} className="size-4 shrink-0 accent-[var(--color-primary)]" />
                    <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
                    <span className="shrink-0 text-xs text-muted">{TASK_STATUS_LABEL[task.status]}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-border p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {importMutation.isError && (
          <p className="mb-2 flex items-center gap-1 text-xs text-red-700" role="alert">
            <CircleAlert size={14} strokeWidth={2} aria-hidden="true" />
            {importMutation.error instanceof ApiError ? (importMutation.error.fieldErrors.project_id ?? importMutation.error.message) : "가져오지 못했습니다."}
          </p>
        )}
        <button
          type="button"
          onClick={() => !importMutation.isPending && importMutation.mutate()}
          disabled={selectedIds.length === 0 || importMutation.isPending}
          aria-busy={importMutation.isPending}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
        >
          {importMutation.isPending && <LoaderCircle size={16} strokeWidth={2} className="animate-spin" aria-hidden="true" />}
          {selectedIds.length > 0 ? `선택한 ${selectedIds.length}개 이 프로젝트로 가져오기` : "가져올 업무를 고르세요"}
        </button>
      </div>
    </aside>
  );
}
