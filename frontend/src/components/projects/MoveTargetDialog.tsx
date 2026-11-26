"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowUpToLine, CircleAlert, FolderKanban, LoaderCircle, Search, UserRound, X } from "lucide-react";
import { PROJECT_STATUS_LABEL, type Project } from "@/lib/api/projects";
import { ancestorsOf, cannotNest, categoryOf, pathLabel, type ProjectTree } from "@/lib/projectTree";

/** 선택값: null = 개인 업무(업무) 또는 최상위(프로젝트) */
type Target = string | null;

type Props = {
  tree: ProjectTree;
  /** task: 업무를 옮김 (개인 업무 + 진행 중 프로젝트) / project: 프로젝트를 옮김 (최상위 + 규칙에 맞는 프로젝트) */
  kind: "task" | "project";
  /** 옮기는 것들의 수와 (프로젝트일 때) ID — 규칙 검사용 */
  count: number;
  movingProjectIds?: string[];
  pending: boolean;
  error: string | null;
  onConfirm: (target: Target) => void;
  onClose: () => void;
};

/**
 * 이동할 곳 선택 창 (2026-11-26 사용자 요청: 이동을 더 직관적으로).
 * 프로젝트를 상위 › 하위 나무 모양으로 보여주고, 갈 수 없는 곳은 흐리게 + 이유를 적는다. 검색할 수 있다.
 */
export function MoveTargetDialog({ tree, kind, count, movingProjectIds = [], pending, error, onConfirm, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Target | undefined>(undefined);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const selected = new Set(movingProjectIds);
  const roots = movingProjectIds.filter((pid) => !ancestorsOf(tree, pid).some((a) => selected.has(a.id)));

  function reason(p: Project): string | null {
    if (kind === "task") return categoryOf(p.status) === "active" ? null : `${PROJECT_STATUS_LABEL[p.status]}한 프로젝트`;
    if (selected.has(p.id)) return "옮기는 프로젝트";
    for (const r of roots) {
      const why = cannotNest(tree, r, p.id);
      if (why && why !== "이미 그 안에 있어요.") return why.replace(/(어요|에요)\.$/, "").replace("프로젝트는 3단계까지만 만들 수 있", "3단계 초과");
    }
    return null;
  }

  // 나무 순서대로 펼친 목록 (상위 다음에 그 하위)
  const ordered: { project: Project; depth: number }[] = [];
  const walk = (list: Project[], depth: number) => {
    for (const p of [...list].sort((a, b) => a.name.localeCompare(b.name, "ko"))) {
      ordered.push({ project: p, depth });
      walk(tree.children.get(p.id) ?? [], depth + 1);
    }
  };
  walk([...tree.byId.values()].filter((p) => !p.parent_id || !tree.byId.has(p.parent_id)), 0);

  const keyword = query.trim().toLowerCase();
  const visible = keyword ? ordered.filter(({ project }) => pathLabel(tree, project).toLowerCase().includes(keyword)) : ordered;
  const noun = kind === "task" ? "업무" : "프로젝트";

  function requestClose() {
    if (!pending) onClose();
  }

  const option = (key: string, value: Target, label: React.ReactNode, icon: React.ReactNode, depth: number, disabledReason: string | null) => {
    const active = picked === value;
    return (
      <li key={key}>
        <button
          type="button"
          role="radio"
          aria-checked={active}
          disabled={Boolean(disabledReason) || pending}
          onClick={() => setPicked(value)}
          onDoubleClick={() => !disabledReason && onConfirm(value)}
          className={`flex min-h-11 w-full items-center gap-2 rounded-xl py-1.5 pr-3 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${active ? "bg-primary text-white" : "hover:bg-pale-green"}`}
          style={{ paddingLeft: `${12 + depth * 20}px` }}
        >
          {depth > 0 && <span className={`text-xs ${active ? "text-white/70" : "text-sage"}`} aria-hidden="true">└</span>}
          {icon}
          <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
          {disabledReason && <span className="shrink-0 text-xs">{disabledReason}</span>}
        </button>
      </li>
    );
  };

  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) requestClose();
      }}
      aria-labelledby={`${id}-title`}
      className="surface-card m-auto w-[calc(100%-2rem)] max-w-md rounded-[20px] p-0 text-foreground backdrop:bg-primary-dark/30"
    >
      <div className="flex max-h-[85vh] flex-col p-5 md:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id={`${id}-title`} className="text-lg font-bold text-primary-dark">어디로 옮길까요?</h2>
            <p className="mt-0.5 text-sm text-muted">{noun} {count}개를 옮겨요.</p>
          </div>
          <button type="button" onClick={requestClose} disabled={pending} className="-mr-2 -mt-1 flex size-11 items-center justify-center rounded-xl text-muted hover:bg-pale-green" aria-label="닫기">
            <X size={20} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        <label className="relative mt-4 block">
          <span className="sr-only">프로젝트 검색</span>
          <Search size={16} strokeWidth={2} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="프로젝트 검색" className="block min-h-11 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-sm focus:border-primary focus:outline-none" />
        </label>

        <ul role="radiogroup" aria-label="옮길 곳" className="mt-3 min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {!keyword &&
            (kind === "task"
              ? option("personal", null, "개인 업무", <UserRound size={16} strokeWidth={2} aria-hidden="true" />, 0, null)
              : option("top", null, "최상위 (상위 프로젝트 없음)", <ArrowUpToLine size={16} strokeWidth={2} aria-hidden="true" />, 0, roots.some((r) => tree.byId.get(r)?.parent_id) ? null : "이미 최상위"))}
          {visible.map(({ project, depth }) =>
            option(project.id, project.id, keyword ? pathLabel(tree, project) : project.name, <FolderKanban size={16} strokeWidth={2} aria-hidden="true" />, keyword ? 0 : depth, reason(project)),
          )}
          {visible.length === 0 && keyword && <li className="px-3 py-6 text-center text-sm text-muted">검색 결과가 없어요.</li>}
        </ul>

        {error && (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800" role="alert">
            <CircleAlert size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}

        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={requestClose} disabled={pending} className="min-h-11 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-primary-dark hover:bg-pale-green">취소</button>
          <button
            type="button"
            onClick={() => picked !== undefined && onConfirm(picked)}
            disabled={picked === undefined || pending}
            aria-busy={pending}
            className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-60"
          >
            {pending && <LoaderCircle size={16} strokeWidth={2} className="animate-spin" aria-hidden="true" />}
            여기로 옮기기
          </button>
        </div>
      </div>
    </dialog>
  );
}
