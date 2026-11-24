"use client";

// 기존 대시보드(page.tsx)에 있던 사이드바·모바일 하단 메뉴를 페이지 공통 레이아웃으로 옮긴 것.
// 클래스와 동작은 그대로 두고, 화면이 있는 메뉴만 실제 링크로 연결했다.

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays, ChartNoAxesCombined, ChevronLeft, ChevronRight, CircleHelp,
  FolderKanban, Home, ListTodo, MoreHorizontal, Settings2, Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type NavItem = { label: string; icon: LucideIcon; href?: string; ai?: boolean };

// href가 없는 메뉴는 아직 화면이 없어 "준비 중"으로 표시한다
const navigation: NavItem[] = [
  { label: "대시보드", icon: Home, href: "/" },
  { label: "내 프로젝트", icon: FolderKanban, href: "/projects" },
  { label: "업무 관리", icon: ListTodo, href: "/tasks" },
  { label: "AI 업무 도우미", icon: Sparkles, ai: true },
  { label: "캘린더", icon: CalendarDays },
  { label: "리포트", icon: ChartNoAxesCombined },
  { label: "설정", icon: Settings2 },
];

function isActive(pathname: string, href?: string) {
  if (!href) return false;
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-background text-foreground">
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
          {navigation.map(({ label, icon: Icon, ai, href }) => {
            const active = isActive(pathname, href);
            const className = `${active ? "bg-pale-green font-semibold text-primary-dark" : "text-muted"} ${ai ? "liquid-accent text-primary-dark" : ""} ${href && !active ? "hover:bg-pale-green/60 hover:text-primary-dark" : ""} flex min-h-12 items-center gap-3 rounded-xl px-3.5`;
            const content = (
              <>
                <Icon size={20} strokeWidth={2} className="shrink-0" aria-hidden="true" />
                <span className={`${sidebarCollapsed ? "lg:hidden" : ""} hidden truncate text-sm lg:inline`}>{label}</span>
                <span className="sr-only lg:hidden">{label}</span>
              </>
            );
            return href ? (
              <Link key={label} href={href} className={className} title={label} aria-current={active ? "page" : undefined}>{content}</Link>
            ) : (
              <div key={label} className={className} title={`${label} 화면 준비 중`}>{content}</div>
            );
          })}
        </nav>
        <div className={`${sidebarCollapsed ? "lg:hidden" : ""} mt-auto hidden rounded-2xl bg-pale-green/70 p-4 lg:block`}>
          <CircleHelp size={20} strokeWidth={2} className="text-primary" aria-hidden="true" />
          <p className="mt-3 text-sm font-semibold text-primary-dark">조금씩, 꾸준히</p>
          <p className="mt-1 text-xs leading-5 text-muted">오늘의 계획을 차근차근 정리해 보세요.</p>
        </div>
      </aside>

      <main className={`min-w-0 px-4 pb-32 pt-7 md:ml-20 md:px-6 md:pb-12 md:pt-9 lg:pt-10 lg:transition-[margin] lg:duration-200 xl:px-10 ${sidebarCollapsed ? "lg:ml-20" : "lg:ml-64"}`}>
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>

      <nav className="glass-panel fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border px-2 pb-[env(safe-area-inset-bottom)] pt-2 md:hidden" aria-label="모바일 메뉴">
        <MobileItem icon={Home} label="대시보드" href="/" active={isActive(pathname, "/")} />
        <MobileItem icon={FolderKanban} label="내 프로젝트" href="/projects" active={isActive(pathname, "/projects")} />
        <MobileItem icon={ListTodo} label="업무 관리" href="/tasks" active={isActive(pathname, "/tasks")} />
        <MobileItem icon={Sparkles} label="AI 어시스턴트" />
        <button type="button" onClick={() => setMoreOpen((value) => !value)} className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl text-muted ${moreOpen ? "bg-pale-green text-primary-dark" : ""}`} aria-expanded={moreOpen} aria-controls="mobile-more" aria-label="더보기 메뉴" title="더보기"><MoreHorizontal size={20} strokeWidth={2} aria-hidden="true" /><span className="truncate text-[11px]">더보기</span></button>
        {moreOpen && <div id="mobile-more" className="surface-card absolute bottom-full right-3 mb-2 w-44 rounded-2xl p-2" role="group" aria-label="더보기 메뉴">{navigation.slice(4).map(({ label, icon: Icon }) => <div key={label} className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-primary-dark" title={`${label} 화면 준비 중`}><Icon size={20} strokeWidth={2} aria-hidden="true" />{label}</div>)}</div>}
      </nav>
    </div>
  );
}

function MobileItem({ icon: Icon, label, href, active = false }: { icon: LucideIcon; label: string; href?: string; active?: boolean }) {
  const className = `flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 ${active ? "bg-pale-green text-primary-dark" : "text-muted"}`;
  const content = <><Icon size={20} strokeWidth={2} aria-hidden="true" /><span className="truncate text-[11px] font-medium">{label}</span></>;
  return href ? (
    <Link href={href} className={className} title={label} aria-current={active ? "page" : undefined}>{content}</Link>
  ) : (
    <div className={className} title={`${label} 화면 준비 중`}>{content}</div>
  );
}
