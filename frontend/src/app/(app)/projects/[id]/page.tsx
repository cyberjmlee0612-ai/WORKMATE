"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, FolderSearch, Pencil } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { getProject, projectKeys } from "@/lib/api/projects";
import { formatDate } from "@/lib/format";
import { ProgressBar } from "@/components/projects/ProgressBar";
import { ProjectStatusBadge } from "@/components/projects/ProjectStatusBadge";
import { ProjectFormDialog } from "@/components/projects/ProjectFormDialog";
import { EmptyState, ErrorState } from "@/components/common/QueryStates";
import { ProjectTasksSection } from "@/components/tasks/ProjectTasksSection";

export default function ProjectDetailPage({ params }: PageProps<"/projects/[id]">) {
  const { id } = use(params);
  const [editOpen, setEditOpen] = useState(false);
  const { data: project, isPending, isError, error, refetch, isRefetching } = useQuery({
    queryKey: projectKeys.detail(id),
    queryFn: () => getProject(id),
  });

  const backLink = (
    <Link href="/projects" className="inline-flex min-h-11 items-center gap-1.5 rounded-xl text-sm font-medium text-muted hover:text-primary-dark">
      <ArrowLeft size={16} strokeWidth={2} aria-hidden="true" />
      내 프로젝트
    </Link>
  );

  if (isPending) {
    return (
      <div aria-busy="true" aria-label="불러오는 중">
        {backLink}
        <div className="mt-4 h-40 animate-pulse rounded-[20px] bg-pale-green/50" />
      </div>
    );
  }

  if (isError) {
    // 없는 ID, 남의 프로젝트(404), 잘못된 형식(422)은 모두 "찾을 수 없음"으로 안내한다
    const notFound = error instanceof ApiError && (error.status === 404 || error.status === 422);
    return (
      <>
        {backLink}
        <div className="mt-4">
          {notFound ? (
            <EmptyState icon={FolderSearch} title="프로젝트를 찾을 수 없어요" description="삭제되었거나 접근할 수 없는 프로젝트입니다." />
          ) : (
            <ErrorState message={error.message} onRetry={() => refetch()} retrying={isRefetching} />
          )}
        </div>
      </>
    );
  }

  const start = formatDate(project.start_date);
  const due = formatDate(project.due_date);

  return (
    <>
      {backLink}
      <header className="mt-3 flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="min-w-0 break-words text-[28px] font-bold leading-tight text-primary-dark md:text-[32px]">{project.name}</h1>
            <ProjectStatusBadge status={project.status} />
          </div>
          {project.description ? (
            <p className="mt-3 whitespace-pre-line break-words text-sm leading-6 text-foreground md:text-base">{project.description}</p>
          ) : (
            <p className="mt-3 text-sm text-muted">설명이 없습니다.</p>
          )}
        </div>
        <button type="button" onClick={() => setEditOpen(true)} className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-primary-dark hover:bg-pale-green">
          <Pencil size={16} strokeWidth={2} aria-hidden="true" />
          수정
        </button>
      </header>

      <section className="mt-8 grid gap-4 md:grid-cols-2" aria-label="프로젝트 정보">
        <div className="glass-panel rounded-[20px] p-4 md:p-5 lg:p-6">
          <div className="flex items-end justify-between">
            <p className="text-sm font-medium text-muted">진행률</p>
            <p className="font-geist text-[30px] font-bold leading-none text-primary-dark">{project.progress}%</p>
          </div>
          <div className="mt-4">
            <ProgressBar value={project.progress} label={`${project.name} 진행률`} />
          </div>
          <p className="mt-3 text-xs text-muted">전체 {project.total_tasks}개 업무 중 {project.completed_tasks}개 완료</p>
        </div>
        <div className="glass-panel rounded-[20px] p-4 md:p-5 lg:p-6">
          <p className="text-sm font-medium text-muted">기간</p>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <CalendarDays size={16} strokeWidth={2} className="text-primary" aria-hidden="true" />
              <dt className="w-12 text-muted">시작일</dt>
              <dd className="font-medium text-foreground">{start ?? "미정"}</dd>
            </div>
            <div className="flex items-center gap-2">
              <CalendarDays size={16} strokeWidth={2} className="text-primary" aria-hidden="true" />
              <dt className="w-12 text-muted">마감일</dt>
              <dd className="font-medium text-foreground">{due ?? "미정"}</dd>
            </div>
          </dl>
        </div>
      </section>

      <ProjectTasksSection projectId={project.id} cancelledCount={project.cancelled_tasks} />

      {editOpen && <ProjectFormDialog project={project} onClose={() => setEditOpen(false)} />}
    </>
  );
}
