"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderKanban, Plus } from "lucide-react";
import { listProjects, projectKeys } from "@/lib/api/projects";
import { ProjectCard } from "@/components/projects/ProjectCard";
import { ProjectFormDialog } from "@/components/projects/ProjectFormDialog";
import { CardSkeleton, EmptyState, ErrorState } from "@/components/common/QueryStates";

// completed는 진행 목록에서 분리한다 (PRD §3).
// archived의 표시 위치는 PRD 미결정 → 임시로 완료와 같은 구역에 함께 표시한다.
const CLOSED = new Set(["completed", "archived"]);

export default function ProjectsPage() {
  const [formOpen, setFormOpen] = useState(false);
  const { data, isPending, isError, error, refetch, isRefetching } = useQuery({ queryKey: projectKeys.list(), queryFn: listProjects });

  const active = data?.filter((p) => !CLOSED.has(p.status)) ?? [];
  const closed = data?.filter((p) => CLOSED.has(p.status)) ?? [];

  const createButton = (
    <button type="button" onClick={() => setFormOpen(true)} className="flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 font-semibold text-white hover:bg-primary-dark">
      <Plus size={20} strokeWidth={2} aria-hidden="true" />
      <span className="text-sm">새 프로젝트</span>
    </button>
  );

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <p className="font-geist text-xs font-semibold uppercase tracking-[0.22em] text-primary">Projects</p>
          <h1 className="mt-3 text-[28px] font-bold leading-tight text-primary-dark md:text-[32px]">내 프로젝트</h1>
          <p className="mt-2 text-sm text-muted md:text-base">프로젝트를 만들고 진행 상황을 확인하세요.</p>
        </div>
        {createButton}
      </header>

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
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {active.map((project) => <ProjectCard key={project.id} project={project} />)}
            </div>
          )}
        </div>
      </section>

      {closed.length > 0 && (
        <section className="surface-card mt-6 rounded-[20px] p-4 md:p-5 lg:p-6" aria-labelledby="closed-heading">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="closed-heading" className="text-xl font-bold text-primary-dark">완료·보관된 프로젝트</h2>
            <span className="text-sm font-medium text-muted">{closed.length}개</span>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {closed.map((project) => <ProjectCard key={project.id} project={project} />)}
          </div>
        </section>
      )}

      {formOpen && <ProjectFormDialog onClose={() => setFormOpen(false)} />}
    </>
  );
}
