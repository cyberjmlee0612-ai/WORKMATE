"use client";

import { useState } from "react";
import {
  Bell, CalendarDays, ChartNoAxesCombined, Check, ChevronLeft,
  ChevronRight, CircleHelp, FolderKanban, Home, MoreHorizontal,
  Plus, Settings2, Sparkles, UserRound, ListTodo, ArrowUpRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { LogoutButton } from "@/components/auth/LogoutButton";

const navigation: { label: string; icon: LucideIcon; ai?: boolean }[] = [
  { label: "대시보드", icon: Home },
  { label: "내 프로젝트", icon: FolderKanban },
  { label: "업무 관리", icon: ListTodo },
  { label: "AI 업무 도우미", icon: Sparkles, ai: true },
  { label: "캘린더", icon: CalendarDays },
  { label: "리포트", icon: ChartNoAxesCombined },
  { label: "설정", icon: Settings2 },
];

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <aside className={`glass-panel fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-border px-4 py-7 md:flex lg:transition-[width] lg:duration-200 ${sidebarCollapsed ? "lg:w-20" : "lg:w-64"} w-20`}>
        <div className="flex min-h-12 items-center justify-between gap-2 px-2">
          <div className={`min-w-0 ${sidebarCollapsed ? "lg:hidden" : ""} hidden lg:block`}>
            <p className="font-geist text-xl font-bold tracking-tight text-primary-dark">WORKMATE</p>
            <p className="mt-0.5 text-xs text-muted">Your AI Work Partner</p>
          </div>
          <div className="flex size-11 items-center justify-center rounded-2xl bg-pale-green text-primary-dark lg:hidden" aria-hidden="true"><Sparkles size={20} strokeWidth={2} /></div>
          <button type="button" onClick={() => setSidebarCollapsed((value) => !value)} className="hidden size-11 shrink-0 items-center justify-center rounded-xl text-primary-dark hover:bg-pale-green lg:flex" aria-label={sidebarCollapsed ? "사이드바 펼치기" : "사이드바 접기"} title={sidebarCollapsed ? "사이드바 펼치기" : "사이드바 접기"}>
            {sidebarCollapsed ? <ChevronRight size={20} strokeWidth={2} /> : <ChevronLeft size={20} strokeWidth={2} />}
          </button>
        </div>

        <nav className="mt-12 space-y-2" aria-label="주 메뉴">
          {navigation.map(({ label, icon: Icon, ai }, index) => (
            <div key={label} className={`${index === 0 ? "bg-pale-green font-semibold text-primary-dark" : "text-muted"} ${ai ? "liquid-accent text-primary-dark" : ""} flex min-h-12 items-center gap-3 rounded-xl px-3.5`} title={label} aria-current={index === 0 ? "page" : undefined}>
              <Icon size={20} strokeWidth={2} className="shrink-0" aria-hidden="true" />
              <span className={`${sidebarCollapsed ? "lg:hidden" : ""} hidden truncate text-sm lg:inline`}>{label}</span>
              <span className="sr-only lg:hidden">{label}</span>
            </div>
          ))}
        </nav>
        <div className={`${sidebarCollapsed ? "lg:hidden" : ""} mt-auto hidden rounded-2xl bg-pale-green/70 p-4 lg:block`}>
          <CircleHelp size={20} strokeWidth={2} className="text-primary" aria-hidden="true" />
          <p className="mt-3 text-sm font-semibold text-primary-dark">조금씩, 꾸준히</p>
          <p className="mt-1 text-xs leading-5 text-muted">오늘의 계획을 차근차근 정리해 보세요.</p>
        </div>
      </aside>

      <main className={`min-w-0 px-4 pb-32 pt-7 md:ml-20 md:px-6 md:pb-12 md:pt-9 lg:pt-10 lg:transition-[margin] lg:duration-200 xl:px-10 ${sidebarCollapsed ? "lg:ml-20" : "lg:ml-64"}`}>
        <div className="mx-auto max-w-7xl">
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
              <button type="button" disabled title="프로젝트 생성 기능 준비 중" className="flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 font-semibold text-white opacity-75"><Plus size={20} strokeWidth={2} aria-hidden="true" /><span className="text-sm">새 프로젝트</span></button>
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
        </div>
      </main>

      <nav className="glass-panel fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border px-2 pb-[env(safe-area-inset-bottom)] pt-2 md:hidden" aria-label="모바일 메뉴">
        <MobileItem icon={Home} label="대시보드" active />
        <MobileItem icon={FolderKanban} label="내 프로젝트" />
        <MobileItem icon={ListTodo} label="업무 관리" />
        <MobileItem icon={Sparkles} label="AI 어시스턴트" />
        <button type="button" onClick={() => setMoreOpen((value) => !value)} className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl text-muted ${moreOpen ? "bg-pale-green text-primary-dark" : ""}`} aria-expanded={moreOpen} aria-controls="mobile-more" aria-label="더보기 메뉴" title="더보기"><MoreHorizontal size={20} strokeWidth={2} aria-hidden="true" /><span className="truncate text-[11px]">더보기</span></button>
        {moreOpen && <div id="mobile-more" className="surface-card absolute bottom-full right-3 mb-2 w-44 rounded-2xl p-2" role="group" aria-label="더보기 메뉴">{navigation.slice(4).map(({ label, icon: Icon }) => <div key={label} className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-primary-dark" title={`${label} 화면 준비 중`}><Icon size={20} strokeWidth={2} aria-hidden="true" />{label}</div>)}</div>}
      </nav>
    </div>
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

function MobileItem({ icon: Icon, label, active = false }: { icon: LucideIcon; label: string; active?: boolean }) {
  return <div className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 ${active ? "bg-pale-green text-primary-dark" : "text-muted"}`} title={`${label}${active ? "" : " 화면 준비 중"}`} aria-current={active ? "page" : undefined}><Icon size={20} strokeWidth={2} aria-hidden="true" /><span className="truncate text-[11px] font-medium">{label}</span></div>;
}
