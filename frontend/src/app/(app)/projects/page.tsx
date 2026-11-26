"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Archive, ArrowUpToLine, ChevronDown, CircleAlert, FolderKanban, Info, ListChecks, Plus } from "lucide-react";
import { ProjectBulkBar } from "@/components/projects/ProjectBulkBar";
import { useEditMode } from "@/components/projects/useEditMode";
import { listProjects, projectKeys } from "@/lib/api/projects";
import { useDragItem } from "@/lib/dnd";
import { buildTree, sectionRoots } from "@/lib/projectTree";
import { ProjectCard } from "@/components/projects/ProjectCard";
import { ProjectFormDialog } from "@/components/projects/ProjectFormDialog";
import { NestDropZone } from "@/components/projects/NestDropZone";
import { useNestActions, type Feedback } from "@/components/projects/useNestActions";
import { CardSkeleton, EmptyState, ErrorState } from "@/components/common/QueryStates";

// 진행 중 → 완료 → 보관함(기본 접힘) 순으로 나눈다 (PRD §3, 보관 위치는 2026-11-24 사용자 확정)
// 계층(2026-11-26): 같은 구역의 하위 프로젝트는 상위 카드 안(상세 화면)에서 보이고, 카드에 '하위 n개'로 표시한다.
// 카드를 다른 카드 위로 끌어다 놓으면 그 안(하위)으로 들어간다.
export default function ProjectsPage() {
  const [formOpen, setFormOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const { data, isPending, isError, error, refetch, isRefetching } = useQuery({ queryKey: projectKeys.list(), queryFn: listProjects });
  const dragging = useDragItem();
  const nest = useNestActions(setFeedback);
  const edit = useEditMode();

  useEffect(() => {
    if (!feedback || feedback.error) return;
    const id = window.setTimeout(() => setFeedback(null), 5000);
    return () => window.clearTimeout(id);
  }, [feedback]);

  const tree = buildTree(data ?? []);
  const active = sectionRoots(tree, "active");
  const completed = sectionRoots(tree, "completed");
  const archived = sectionRoots(tree, "archived");
  const closed = [...completed, ...archived];

  const card = (project: (typeof active)[number]) => (
    <ProjectCard
      key={project.id}
      project={project}
      showParent
      nest={{ tree, onDrop: (item, point, element) => nest.drop(item, project.id, project.name, point, element, edit.stop) }}
      selection={edit.editing ? { checked: edit.selected.has(project.id), onToggle: () => edit.toggle(project.id), selectedIds } : undefined}
    />
  );
  // 편집 모드에서 고를 수 있는 카드 = 지금 화면에 보이는 카드
  const visibleIds = [...active, ...completed, ...(archiveOpen ? archived : [])].map((p) => p.id);
  const selectedIds = visibleIds.filter((id) => edit.selected.has(id));

  const createButton = (
    <div className="flex flex-wrap gap-2">
      {(data?.length ?? 0) > 0 && !edit.editing && (
        <button type="button" onClick={edit.start} className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-primary-dark hover:bg-pale-green">
          <ListChecks size={18} strokeWidth={2} aria-hidden="true" />
          편집
        </button>
      )}
      <button type="button" onClick={() => setFormOpen(true)} className="flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 font-semibold text-white hover:bg-primary-dark">
        <Plus size={20} strokeWidth={2} aria-hidden="true" />
        <span className="text-sm">새 프로젝트</span>
      </button>
    </div>
  );

  // 상위가 있는 프로젝트를 끌 때만 '최상위로 꺼내기' 자리를 보여준다
  const showLiftZone = dragging?.kind === "project" && dragging.ids.some((pid) => Boolean(tree.byId.get(pid)?.parent_id));

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <p className="font-geist text-xs font-semibold uppercase tracking-[0.22em] text-primary">Projects</p>
          <h1 className="mt-3 text-[28px] font-bold leading-tight text-primary-dark md:text-[32px]">내 프로젝트</h1>
          <p className="mt-2 text-sm text-muted md:text-base">프로젝트를 만들고 진행 상황을 확인하세요. 카드를 다른 카드 위로 끌어다 놓으면 그 안으로 들어가요.</p>
        </div>
        {createButton}
      </header>

      {feedback && (
        <p
          className={`mt-6 flex items-start gap-2 rounded-xl border px-3.5 py-3 text-sm ${feedback.error ? "border-red-200 bg-red-50 text-red-800" : "border-soft-sage bg-pale-green/60 text-primary-dark"}`}
          role={feedback.error ? "alert" : "status"}
        >
          {feedback.error ? <CircleAlert size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" /> : <Info size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />}
          {feedback.message}
        </p>
      )}

      {edit.notice && (
        <p className="mt-6 flex items-start gap-2 rounded-xl border border-soft-sage bg-pale-green/60 px-3.5 py-3 text-sm text-primary-dark" role="status">
          <Info size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
          {edit.notice}
        </p>
      )}
      {edit.editing && (
        <p className="mt-6 text-sm text-muted">프로젝트 카드를 눌러 여러 개 고른 뒤, 아래에서 옮기거나 삭제하세요. 하위 프로젝트는 상위 프로젝트 상세 화면에서 고를 수 있어요.</p>
      )}

      {showLiftZone && (
        <NestDropZone
          tree={tree}
          targetId={null}
          onDrop={(item, point, element) => nest.drop(item, null, "", point, element, edit.stop)}
          className={(state) =>
            `mt-6 flex min-h-16 items-center justify-center gap-2 rounded-2xl border-2 border-dashed text-sm font-semibold transition-colors ${state === "valid" ? "border-primary bg-pale-green text-primary-dark" : "border-soft-sage text-muted"}`
          }
        >
          <ArrowUpToLine size={18} strokeWidth={2} aria-hidden="true" />
          여기에 놓으면 최상위 프로젝트로 꺼내요
        </NestDropZone>
      )}

      <section className="surface-card mt-8 rounded-[20px] p-4 md:p-5 lg:p-6" aria-labelledby="active-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="active-heading" className="text-xl font-bold text-primary-dark">진행 중인 프로젝트</h2>
          {data && <span className="rounded-full bg-pale-green px-3 py-1.5 text-xs font-semibold text-primary-dark">{active.length}개의 프로젝트</span>}
        </div>
        <div className="mt-6">
          {isPending ? (
            <CardSkeleton />
          ) : isError ? (
            <ErrorState message={error.message} onRetry={() => refetch()} retrying={isRefetching} />
          ) : active.length === 0 ? (
            <EmptyState
              icon={FolderKanban}
              title={closed.length > 0 ? "진행 중인 프로젝트가 없어요" : "아직 프로젝트가 없어요"}
              description="첫 프로젝트를 만들고 업무를 정리해 보세요."
              action={
                <button type="button" onClick={() => setFormOpen(true)} className="flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark">
                  <Plus size={18} strokeWidth={2} aria-hidden="true" />
                  프로젝트 추가
                </button>
              }
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{active.map(card)}</div>
          )}
        </div>
      </section>

      {completed.length > 0 && (
        <section className="surface-card mt-6 rounded-[20px] p-4 md:p-5 lg:p-6" aria-labelledby="completed-heading">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="completed-heading" className="text-xl font-bold text-primary-dark">완료한 프로젝트</h2>
            <span className="text-sm font-medium text-muted">{completed.length}개</span>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">{completed.map(card)}</div>
        </section>
      )}

      {archived.length > 0 && (
        <section className="mt-6 rounded-[20px] border border-border bg-background/60 p-4 md:p-5 lg:p-6" aria-labelledby="archived-heading">
          <h2 id="archived-heading">
            <button
              type="button"
              onClick={() => setArchiveOpen((v) => !v)}
              aria-expanded={archiveOpen}
              aria-controls="archived-projects"
              className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
            >
              <span className="flex items-center gap-2 text-lg font-bold text-muted">
                <Archive size={20} strokeWidth={2} aria-hidden="true" />
                보관함
                <span className="font-geist text-sm font-medium">({archived.length})</span>
              </span>
              <ChevronDown size={20} strokeWidth={2} aria-hidden="true" className={`text-muted transition-transform ${archiveOpen ? "rotate-180" : ""}`} />
            </button>
          </h2>
          {archiveOpen && (
            <div id="archived-projects" className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {archived.map(card)}
            </div>
          )}
        </section>
      )}

      {edit.editing && (
        <ProjectBulkBar
          tree={tree}
          selectedIds={selectedIds}
          totalCount={visibleIds.length}
          onSelectAll={() => edit.setAll(visibleIds)}
          onClearAll={() => edit.setAll([])}
          onDone={edit.finish}
          onCancel={edit.stop}
        />
      )}

      {formOpen && <ProjectFormDialog onClose={() => setFormOpen(false)} />}
    </>
  );
}
