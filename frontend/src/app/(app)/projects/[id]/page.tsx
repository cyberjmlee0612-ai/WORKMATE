"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowLeft, ArrowUpToLine, CalendarDays, ChevronRight, CircleAlert, CircleCheck, FolderSearch, Info, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { getProject, listProjects, moveProjects, projectKeys, type ProjectAction } from "@/lib/api/projects";
import { invalidateWorkData } from "@/lib/api/invalidate";
import { ancestorsOf, buildTree } from "@/lib/projectTree";
import { NestDropZone } from "@/components/projects/NestDropZone";
import { SubprojectsSection } from "@/components/projects/SubprojectsSection";
import { useNestActions, type Feedback } from "@/components/projects/useNestActions";
import { formatDate, formatDateTime } from "@/lib/format";
import { ProjectTransitionDialog } from "@/components/projects/ProjectTransitionDialog";
import { ProjectHistory } from "@/components/projects/ProjectHistory";
import { ProgressBar } from "@/components/projects/ProgressBar";
import { ProjectStatusBadge } from "@/components/projects/ProjectStatusBadge";
import { ProjectFormDialog } from "@/components/projects/ProjectFormDialog";
import { DeleteProjectDialog } from "@/components/projects/DeleteProjectDialog";
import { EmptyState, ErrorState } from "@/components/common/QueryStates";
import { ProjectTasksSection } from "@/components/tasks/ProjectTasksSection";

export default function ProjectDetailPage({ params }: PageProps<"/projects/[id]">) {
  const { id } = use(params);
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [transition, setTransition] = useState<ProjectAction | null>(null);
  const { data: project, isPending, isError, error, refetch, isRefetching } = useQuery({
    queryKey: projectKeys.detail(id),
    queryFn: () => getProject(id),
  });
  // 계층(상위 경로·하위 프로젝트)은 전체 목록으로 계산한다
  const listQuery = useQuery({ queryKey: projectKeys.list(), queryFn: listProjects });
  const tree = buildTree(listQuery.data ?? []);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const nest = useNestActions(setFeedback);
  useEffect(() => {
    if (!feedback || feedback.error) return;
    const timer = window.setTimeout(() => setFeedback(null), 5000);
    return () => window.clearTimeout(timer);
  }, [feedback]);
  const parents = tree.byId.has(id) ? ancestorsOf(tree, id) : [];

  // 하위 프로젝트 → 한 단계 위로 꺼내기 (2026-11-26 사용자 요청). 상위의 상위 아래로, 없으면 최상위로.
  const queryClient = useQueryClient();
  const liftUp = useMutation({
    mutationFn: (grandParentId: string | null) => moveProjects([id], grandParentId),
    onSuccess: async (_r, grandParentId) => {
      await invalidateWorkData(queryClient);
      const where = grandParentId ? `‘${tree.byId.get(grandParentId)?.name ?? "상위"}’ 안` : "최상위";
      setFeedback({ message: `${where}(으)로 꺼냈어요.`, error: false });
    },
    onError: (err) => setFeedback({ message: err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : "옮기지 못했습니다.", error: true }),
  });

  // 상위 경로: 각 이름은 링크이면서, 업무·하위 프로젝트를 끌어다 놓으면 그 상위로 옮기는 자리
  const backLink = (
    <nav aria-label="프로젝트 경로" className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
      <Link href="/projects" className="inline-flex min-h-11 items-center gap-1.5 rounded-xl font-medium text-muted hover:text-primary-dark">
        <ArrowLeft size={16} strokeWidth={2} aria-hidden="true" />
        내 프로젝트
      </Link>
      {parents.map((p) => (
        <span key={p.id} className="flex min-w-0 items-center gap-1">
          <ChevronRight size={14} strokeWidth={2} className="shrink-0 text-sage" aria-hidden="true" />
          <NestDropZone
            as="span"
            tree={tree}
            targetId={p.id}
            onDrop={(item, point, element) => nest.drop(item, p.id, p.name, point, element)}
            className={(state) => `rounded-lg transition-colors ${state === "valid" ? "bg-pale-green ring-2 ring-primary" : ""}`}
          >
            <Link href={`/projects/${p.id}`} className="inline-flex min-h-11 max-w-[14rem] items-center truncate px-1.5 font-medium text-muted hover:text-primary-dark">
              {p.name}
            </Link>
          </NestDropZone>
        </span>
      ))}
    </nav>
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
  const isClosed = project.status === "completed" || project.status === "archived";

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
        <div className="flex flex-wrap items-center gap-2">
          {/* 상태 전환: 진행 중이면 완료, 완료·보관이면 다시 열기 (PRD P1) */}
          {isClosed ? (
            <button type="button" onClick={() => setTransition("restore")} className="flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark">
              <RotateCcw size={16} strokeWidth={2} aria-hidden="true" />
              다시 열기
            </button>
          ) : (
            <button type="button" onClick={() => setTransition("complete")} className="flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark">
              <CircleCheck size={16} strokeWidth={2} aria-hidden="true" />
              완료
            </button>
          )}
          {project.status !== "archived" && (
            <button type="button" onClick={() => setTransition("archive")} className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-primary-dark hover:bg-pale-green">
              <Archive size={16} strokeWidth={2} aria-hidden="true" />
              보관
            </button>
          )}
          {project.parent_id && (
            <button
              type="button"
              onClick={() => !liftUp.isPending && liftUp.mutate(parents.length >= 2 ? parents[parents.length - 2].id : null)}
              disabled={liftUp.isPending}
              aria-busy={liftUp.isPending}
              title={parents.length >= 2 ? `‘${parents[parents.length - 2].name}’ 안으로 옮겨요` : "최상위 프로젝트로 옮겨요"}
              className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-primary-dark hover:bg-pale-green disabled:opacity-60"
            >
              <ArrowUpToLine size={16} strokeWidth={2} aria-hidden="true" />
              상위로 꺼내기
            </button>
          )}
          <button type="button" onClick={() => setEditOpen(true)} className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-primary-dark hover:bg-pale-green">
            <Pencil size={16} strokeWidth={2} aria-hidden="true" />
            수정
          </button>
          <button type="button" onClick={() => setDeleteOpen(true)} className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-red-700 hover:border-red-200 hover:bg-red-50">
            <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
            삭제
          </button>
        </div>
      </header>

      {project.status === "completed" && (
        <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-soft-sage bg-pale-green/60 px-4 py-3 text-sm text-primary-dark" role="status">
          <CircleCheck size={16} strokeWidth={2} aria-hidden="true" />
          <span className="font-semibold">{formatDateTime(project.completed_at) ?? ""} 완료한 프로젝트예요.</span>
          {project.open_tasks_at_completion ? (
            <span className="text-muted">완료 당시 미완료 업무 {project.open_tasks_at_completion}개</span>
          ) : (
            <span className="text-muted">모든 업무를 마치고 완료했어요</span>
          )}
        </p>
      )}
      {project.status === "archived" && (
        <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-border bg-background px-4 py-3 text-sm text-muted" role="status">
          <Archive size={16} strokeWidth={2} aria-hidden="true" />
          <span className="font-semibold text-foreground">보관함에 있는 프로젝트예요.</span>
          {project.archived_at && <span>{formatDateTime(project.archived_at)} 보관</span>}
        </p>
      )}

      <section className="mt-8 grid gap-4 md:grid-cols-2" aria-label="프로젝트 정보">
        <div className="glass-panel rounded-[20px] p-4 md:p-5 lg:p-6">
          <div className="flex items-end justify-between">
            <p className="text-sm font-medium text-muted">진행률</p>
            <p className="font-geist text-[30px] font-bold leading-none text-primary-dark">{project.progress}%</p>
          </div>
          <div className="mt-4">
            <ProgressBar value={project.progress} label={`${project.name} 진행률`} />
          </div>
          <p className="mt-3 text-xs text-muted">
            {project.subproject_count > 0 ? "하위 프로젝트 포함 " : ""}전체 {project.total_tasks}개 업무 중 {project.completed_tasks}개 완료
          </p>
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

      {feedback && (
        <p
          className={`mt-6 flex items-start gap-2 rounded-xl border px-3.5 py-3 text-sm ${feedback.error ? "border-red-200 bg-red-50 text-red-800" : "border-soft-sage bg-pale-green/60 text-primary-dark"}`}
          role={feedback.error ? "alert" : "status"}
        >
          {feedback.error ? <CircleAlert size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" /> : <Info size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />}
          {feedback.message}
        </p>
      )}
      <SubprojectsSection project={project} tree={tree} onDrop={(item, target, point, element) => nest.drop(item, target.id, target.name, point, element)} />
      <ProjectTasksSection
        project={project}
        tree={tree}
        onDrop={(item, point, element) => nest.drop(item, project.id, project.name, point, element)}
        onNotice={(message) => setFeedback({ message, error: false })}
      />
      <ProjectHistory projectId={project.id} />

      {editOpen && <ProjectFormDialog project={project} onClose={() => setEditOpen(false)} />}
      {transition && <ProjectTransitionDialog project={project} action={transition} onClose={() => setTransition(null)} />}
      {deleteOpen && <DeleteProjectDialog project={project} onClose={() => setDeleteOpen(false)} onDeleted={() => router.replace("/projects")} />}
    </>
  );
}
