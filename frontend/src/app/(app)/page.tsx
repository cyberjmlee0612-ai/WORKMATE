"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell, ChartNoAxesCombined, Check, FolderKanban,
  Plus, UserRound, ListTodo, ArrowUpRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { ProjectFormDialog } from "@/components/projects/ProjectFormDialog";

// TODO(3단계): 아래 예시 데이터와 KPI를 실제 조회·집계로 교체한다
const projects = [
  { name: "WORKMATE 개발", progress: 65 },
  { name: "개인 포트폴리오", progress: 40 },
  { name: "AI 서비스 기획", progress: 80 },
];

const tasks = [
  { title: "WORKMATE 화면 설계하기", category: "개발" },
  { title: "파이썬 복습하기", category: "학습" },
  { title: "포트폴리오 자료 정리하기", category: "개인" },
];

export default function HomePage() {
  const router = useRouter();
  const [projectFormOpen, setProjectFormOpen] = useState(false);

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          <p className="font-geist text-xs font-semibold uppercase tracking-[0.22em] text-primary">Monday, work smarter</p>
          <h1 className="mt-3 text-[28px] font-bold leading-tight text-primary-dark md:text-[32px]">안녕하세요! <span aria-hidden="true">👋</span></h1>
          <p className="mt-2 text-sm text-muted md:text-base">오늘도 WORKMATE와 함께 차근차근 시작해 봐요.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex size-11 items-center justify-center rounded-xl border border-border bg-surface text-primary-dark" aria-label="알림 기능 준비 중" title="알림 기능 준비 중"><Bell size={20} strokeWidth={2} aria-hidden="true" /></span>
          <span className="flex size-11 items-center justify-center rounded-xl border border-border bg-surface text-primary-dark" aria-label="프로필 기능 준비 중" title="프로필 기능 준비 중"><UserRound size={20} strokeWidth={2} aria-hidden="true" /></span>
          <LogoutButton />
          <button type="button" onClick={() => setProjectFormOpen(true)} className="flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 font-semibold text-white hover:bg-primary-dark"><Plus size={20} strokeWidth={2} aria-hidden="true" /><span className="text-sm">새 프로젝트</span></button>
        </div>
      </header>

      <section className="mt-9 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4 lg:gap-5" aria-label="요약 지표">
        <SummaryCard title="전체 프로젝트" value="04" description="진행 중인 프로젝트" icon={FolderKanban} />
        <SummaryCard title="전체 업무" value="28" description="등록된 업무" icon={ListTodo} />
        <SummaryCard title="완료한 업무" value="18" description="이번 주 완료" icon={Check} />
        <SummaryCard title="진행률" value="68%" description="전체 업무 기준" icon={ChartNoAxesCombined} />
      </section>

      <section className="surface-card mt-8 rounded-[20px] p-4 md:p-5 lg:p-6" aria-labelledby="projects-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><p className="font-geist text-xs font-semibold uppercase tracking-[0.18em] text-primary">Projects</p><h2 id="projects-heading" className="mt-1 text-xl font-bold text-primary-dark">내 프로젝트</h2><p className="mt-1 text-sm text-muted">진행 중인 프로젝트를 확인하세요.</p></div>
          <span className="rounded-full bg-pale-green px-3 py-1.5 text-xs font-semibold text-primary-dark">3개의 프로젝트</span>
        </div>
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {projects.map((project) => <ProjectItem key={project.name} {...project} />)}
        </div>
      </section>

      <section className="surface-card mt-6 rounded-[20px] p-4 md:p-5 lg:p-6" aria-labelledby="tasks-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><p className="font-geist text-xs font-semibold uppercase tracking-[0.18em] text-primary">Today&apos;s focus</p><h2 id="tasks-heading" className="mt-1 text-xl font-bold text-primary-dark">오늘의 업무</h2><p className="mt-1 text-sm text-muted">오늘 처리해야 할 업무 목록이에요.</p></div>
          <span className="text-sm font-medium text-muted">3개의 업무</span>
        </div>
        <div className="mt-5 divide-y divide-border">{tasks.map((task) => <TaskItem key={task.title} {...task} />)}</div>
      </section>

      {/* 대시보드 프로젝트 목록은 아직 예시 데이터이므로, 생성 후 새 프로젝트 상세로 이동한다 */}
      {projectFormOpen && <ProjectFormDialog onClose={() => setProjectFormOpen(false)} onSaved={(project) => router.push(`/projects/${project.id}`)} />}
    </>
  );
}

function SummaryCard({ title, value, description, icon: Icon }: { title: string; value: string; description: string; icon: LucideIcon }) {
  return <div className="glass-panel rounded-[20px] p-4 md:p-5 lg:p-6"><div className="flex items-start justify-between gap-3"><p className="text-sm font-medium text-muted">{title}</p><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-pale-green text-primary-dark"><Icon size={20} strokeWidth={2} aria-hidden="true" /></span></div><p className="font-geist mt-4 text-[30px] font-bold leading-none text-primary-dark">{value}</p><p className="mt-3 text-xs text-muted">{description}</p></div>;
}

function ProjectItem({ name, progress }: { name: string; progress: number }) {
  return <article className="rounded-2xl border border-border bg-background/80 p-4 md:p-5"><div className="flex items-start justify-between gap-2"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-pale-green text-primary-dark"><FolderKanban size={20} strokeWidth={2} aria-hidden="true" /></span><ArrowUpRight size={16} strokeWidth={2} className="text-sage" aria-hidden="true" /></div><h3 className="mt-5 break-words text-base font-semibold text-primary-dark">{name}</h3><div className="mt-5 flex justify-between text-sm"><span className="text-muted">진행률</span><span className="font-geist font-semibold text-primary-dark">{progress}%</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-pale-green" role="meter" aria-label={`${name} 진행률`} aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} /></div></article>;
}

function TaskItem({ title, category }: { title: string; category: string }) {
  return <div className="flex min-w-0 flex-wrap items-center gap-3 py-4 md:flex-nowrap"><span className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-white text-soft-sage" aria-label="완료 기능 준비 중" title="완료 기능 준비 중"><Check size={16} strokeWidth={2} aria-hidden="true" /></span><span className="min-w-0 flex-1 break-words text-sm font-medium text-foreground">{title}</span><span className="rounded-lg bg-pale-green px-3 py-1.5 text-xs font-semibold text-primary-dark">{category}</span></div>;
}
