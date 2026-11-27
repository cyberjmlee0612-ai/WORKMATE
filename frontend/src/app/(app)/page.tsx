"use client";

import { Suspense, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarHeart, ChartNoAxesCombined, Check, FolderKanban,
  Plus, Sun, UserRound, ListTodo, ArrowRight, TriangleAlert, CalendarClock,
} from "lucide-react";
import { EventDialog } from "@/components/events/EventDialog";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { EventRow } from "@/components/events/ProjectEventsSection";
import { eventKeys, listEvents, type WorkEvent } from "@/lib/api/events";
import type { LucideIcon } from "lucide-react";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { ProjectFormDialog } from "@/components/projects/ProjectFormDialog";
import { ProjectCard } from "@/components/projects/ProjectCard";
import { TaskFormDialog } from "@/components/tasks/TaskFormDialog";
import { TaskList, TaskListSkeleton } from "@/components/tasks/TaskList";
import { CardSkeleton, EmptyState, ErrorState } from "@/components/common/QueryStates";
import { dashboardKeys, getDashboard } from "@/lib/api/dashboard";
import { getSettings, settingsKeys } from "@/lib/api/settings";
import type { Task } from "@/lib/api/tasks";
import { useToday, userTimeZone } from "@/lib/date";
import { useNowMinute } from "@/lib/time";
import { cheerOfDay, greetingFor } from "@/lib/cheers";
import { Briefing } from "@/components/dashboard/Briefing";
import { CheckinCard } from "@/components/dashboard/CheckinCard";
import { MissedPlansCard } from "@/components/dashboard/MissedPlansCard";
import { HabitsCard } from "@/components/routines/HabitsCard";
import { OnboardingChecklist } from "@/components/onboarding/OnboardingChecklist";

const headerDateFormatter = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" });

function formatHeaderDate(today: string) {
  const [y, m, d] = today.split("-").map(Number);
  return headerDateFormatter.format(new Date(y, m - 1, d));
}

/** 지표 숫자는 기존 디자인처럼 두 자리로 표시 (04, 28) */
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * 대시보드 두 모드 (2026-11-26 사용자 요청: 너무 복잡해서 나눔)
 * - 나의 하루(기본): 스스로 개선하는 데 쓰는 화면 — 밀린 계획, 체크인·마무리, 브리핑, 오늘의 업무
 * - 프로젝트 현황: 프로젝트만 모아 보는 화면 — 요약 지표, 진행 중 프로젝트, 프로젝트 이벤트
 * 모드는 주소(?view=projects)에 남겨 새로고침·뒤로 가기에도 유지한다.
 */
export default function HomePage() {
  // useSearchParams를 쓰므로 Suspense 경계가 필요하다
  return (
    <Suspense fallback={null}>
      <Dashboard />
    </Suspense>
  );
}

type View = "me" | "projects";

function Dashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view: View = searchParams.get("view") === "projects" ? "projects" : "me";
  const setView = (next: View) => router.replace(next === "me" ? "/" : "/?view=projects", { scroll: false });
  const today = useToday();
  const nowMinute = useNowMinute();
  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [taskFormOpen, setTaskFormOpen] = useState(false);

  const tz = today ? userTimeZone() : "UTC";
  const { data, isPending, isError, error, refetch, isRefetching } = useQuery({
    queryKey: dashboardKeys.detail(today ?? "", tz),
    queryFn: () => getDashboard(today!, tz),
    enabled: today !== null, // '오늘'은 브라우저에서만 알 수 있다
  });
  // 표시 이름 (설정). 불러오지 못해도 인사말은 이름 없이 보여 준다
  const displayName = useQuery({ queryKey: settingsKeys.all, queryFn: getSettings }).data?.display_name;
  const loading = isPending;
  const kpi = data?.kpi;

  const addTaskButton = (
    <button type="button" onClick={() => setTaskFormOpen(true)} className="flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark">
      <Plus size={18} strokeWidth={2} aria-hidden="true" />
      업무 추가
    </button>
  );

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          {/* 실제 오늘 날짜. 확인 전(서버 렌더링 중)에는 같은 높이의 빈 줄을 둔다 */}
          <p className="font-geist min-h-4 text-xs font-semibold uppercase tracking-[0.22em] text-primary">{today ? formatHeaderDate(today) : " "}</p>
          {/* 시간대별 인사 + 날마다 바뀌는 응원 문구 (2026-11-26 사용자 요청). 브라우저 시각을 알기 전에는 기본 문구 */}
          <h1 className="mt-3 text-[28px] font-bold leading-tight text-primary-dark md:text-[32px]">
            {displayName ? `${displayName}님, ` : ""}{nowMinute !== null ? greetingFor(new Date(nowMinute * 60_000).getHours()) : "안녕하세요"}! <span aria-hidden="true">👋</span>
          </h1>
          <p className="mt-2 text-sm text-muted md:text-base">{today ? cheerOfDay(today) : "오늘도 WORKMATE와 함께 차근차근 시작해 봐요."}</p>
        </div>
        <div className="flex items-center gap-2">
          <NotificationBell />
          <Link href="/settings" className="flex size-11 items-center justify-center rounded-xl border border-border bg-surface text-primary-dark hover:bg-pale-green" aria-label="프로필·설정" title="프로필·설정"><UserRound size={20} strokeWidth={2} aria-hidden="true" /></Link>
          <LogoutButton />
          <button type="button" onClick={() => setProjectFormOpen(true)} className="flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 font-semibold text-white hover:bg-primary-dark"><Plus size={20} strokeWidth={2} aria-hidden="true" /><span className="text-sm">새 프로젝트</span></button>
        </div>
      </header>

      <div className="mt-6 inline-flex rounded-xl bg-pale-green/70 p-1" role="tablist" aria-label="대시보드 보기">
        {([["me", "나의 하루", Sun], ["projects", "프로젝트 현황", FolderKanban]] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={view === key}
            onClick={() => setView(key)}
            className={`flex min-h-11 items-center gap-2 rounded-lg px-4 text-sm font-semibold ${view === key ? "bg-surface text-primary-dark shadow-sm" : "text-muted hover:text-primary-dark"}`}
          >
            <Icon size={16} strokeWidth={2} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {/* 처음 사용자 안내: 새 사용자면 /welcome으로, 안내 화면을 나갔으면 남은 단계 체크리스트 */}
      <OnboardingChecklist />

      {isError ? (
        <div className="mt-9">
          <ErrorState message={error.message} onRetry={() => refetch()} retrying={isRefetching} />
        </div>
      ) : view === "me" ? (
        <>
          <MissedPlansCard />
          {today && <CheckinCard today={today} nowMinute={nowMinute} schedule={data?.today_schedule ?? []} />}
          <HabitsCard />
          {data && today ? <Briefing data={data} today={today} /> : <div className="mt-6 h-36 animate-pulse rounded-[20px] bg-pale-green/40" aria-hidden="true" />}
          <section className="surface-card mt-6 rounded-[20px] p-4 md:p-5 lg:p-6" aria-labelledby="tasks-heading">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><p className="font-geist text-xs font-semibold uppercase tracking-[0.18em] text-primary">Today&apos;s focus</p><h2 id="tasks-heading" className="mt-1 text-xl font-bold text-primary-dark">오늘의 업무</h2><p className="mt-1 text-sm text-muted">마감일이 오늘이거나 지난 업무예요.</p></div>
              {data && (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-muted">
                    {data.today_tasks.filter((t) => t.status !== "completed").length}개 남음
                  </span>
                  <ViewAllLink href="/tasks" />
                </div>
              )}
            </div>
            <div className="mt-3">
              {loading ? (
                <TaskListSkeleton rows={3} />
              ) : (
                <>
                  {data.today_tasks.length === 0 ? (
                    <EmptyState icon={ListTodo} title="오늘 마감인 업무가 없어요" description="오늘 할 업무를 추가해 보세요." action={addTaskButton} />
                  ) : (
                    <TodayTaskGroups tasks={data.today_tasks} today={data.today} />
                  )}
                  {data.today_has_more && (
                    <p className="mt-3 text-sm text-muted">
                      더 많은 업무가 있어요. <Link href="/tasks" className="font-semibold text-primary hover:underline">업무 관리에서 전체 보기</Link>
                    </p>
                  )}
                </>
              )}
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4 lg:gap-5" aria-label="요약 지표" aria-busy={loading}>
            <SummaryCard title="전체 프로젝트" value={kpi ? pad(kpi.total_projects) : null} description="보관한 프로젝트 제외" icon={FolderKanban} />
            <SummaryCard title="전체 업무" value={kpi ? pad(kpi.total_tasks) : null} description="프로젝트 업무 + 개인 업무" icon={ListTodo} />
            <SummaryCard title="완료한 업무" value={kpi ? pad(kpi.completed_tasks) : null} description="완료 상태인 업무" icon={Check} />
            <SummaryCard title="진행률" value={kpi ? `${kpi.progress}%` : null} description="전체 업무 중 완료 비율" icon={ChartNoAxesCombined} />
          </section>

          <section className="surface-card mt-8 rounded-[20px] p-4 md:p-5 lg:p-6" aria-labelledby="projects-heading">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><p className="font-geist text-xs font-semibold uppercase tracking-[0.18em] text-primary">Projects</p><h2 id="projects-heading" className="mt-1 text-xl font-bold text-primary-dark">내 프로젝트</h2><p className="mt-1 text-sm text-muted">진행 중인 프로젝트를 확인하세요.</p></div>
              {kpi && (
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-pale-green px-3 py-1.5 text-xs font-semibold text-primary-dark">{kpi.active_projects}개의 프로젝트</span>
                  {kpi.active_projects > 0 && <ViewAllLink href="/projects" />}
                </div>
              )}
            </div>
            <div className="mt-6">
              {loading ? (
                <CardSkeleton />
              ) : data.projects.length === 0 ? (
                <EmptyState
                  icon={FolderKanban}
                  title="진행 중인 프로젝트가 없어요"
                  description="프로젝트를 만들고 업무를 정리해 보세요."
                  action={
                    <button type="button" onClick={() => setProjectFormOpen(true)} className="flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark">
                      <Plus size={18} strokeWidth={2} aria-hidden="true" />
                      프로젝트 추가
                    </button>
                  }
                />
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {data.projects.map((project) => <ProjectCard key={project.id} project={project} />)}
                </div>
              )}
            </div>
          </section>

          {today && <ProjectEventsPanel today={today} />}
        </>
      )}

      {projectFormOpen && <ProjectFormDialog onClose={() => setProjectFormOpen(false)} />}
      {/* 오늘의 업무에서 추가하면 마감일을 오늘로 미리 채운다 */}
      {taskFormOpen && <TaskFormDialog defaultDueDate={today} onClose={() => setTaskFormOpen(false)} />}
    </>
  );
}

function SummaryCard({ title, value, description, icon: Icon }: { title: string; value: string | null; description: string; icon: LucideIcon }) {
  return <div className="glass-panel rounded-[20px] p-4 md:p-5 lg:p-6"><div className="flex items-start justify-between gap-3"><p className="text-sm font-medium text-muted">{title}</p><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-pale-green text-primary-dark"><Icon size={20} strokeWidth={2} aria-hidden="true" /></span></div>{value === null ? <div className="mt-4 h-[30px] w-16 animate-pulse rounded-lg bg-pale-green" /> : <p className="font-geist mt-4 text-[30px] font-bold leading-none text-primary-dark">{value}</p>}<p className="mt-3 text-xs text-muted">{description}</p></div>;
}

/**
 * 오늘의 업무를 '지연된 업무'와 '오늘 마감' 두 묶음으로 나눈다.
 * - 지연: 마감일이 오늘 이전이고 아직 완료하지 않은 업무
 * - 오늘 마감: 마감일이 오늘인 업무 + 오늘 완료한 업무(지난 업무를 오늘 끝냈다면 더 이상 지연이 아니다)
 * 서버가 마감일 순으로 정렬해 주므로 순서는 그대로 유지된다.
 */
function TodayTaskGroups({ tasks, today }: { tasks: Task[]; today: string }) {
  const overdue = tasks.filter((t) => t.status !== "completed" && t.due_date !== null && t.due_date < today);
  const dueToday = tasks.filter((t) => !overdue.includes(t));

  return (
    <div className="space-y-5">
      {overdue.length > 0 && (
        <TaskGroup id="overdue-heading" title="지연된 업무" count={overdue.length} icon={TriangleAlert} tone="text-red-800">
          <TaskList tasks={overdue} />
        </TaskGroup>
      )}
      {dueToday.length > 0 && (
        <TaskGroup id="due-today-heading" title="오늘 마감" count={dueToday.length} icon={CalendarClock} tone="text-primary-dark">
          <TaskList tasks={dueToday} />
        </TaskGroup>
      )}
    </div>
  );
}

function TaskGroup({ id, title, count, icon: Icon, tone, children }: { id: string; title: string; count: number; icon: LucideIcon; tone: string; children: ReactNode }) {
  return (
    <div role="group" aria-labelledby={id}>
      <h3 id={id} className={`flex items-center gap-1.5 border-b border-border pb-2 text-sm font-semibold ${tone}`}>
        <Icon size={16} strokeWidth={2} aria-hidden="true" />
        {title}
        <span className="font-geist font-medium text-muted">({count})</span>
      </h3>
      {children}
    </div>
  );
}

function ViewAllLink({ href }: { href: string }) {
  return (
    <Link href={href} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-primary hover:underline">
      전체 보기
      <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
    </Link>
  );
}

const PROJECT_EVENT_DAYS = 90;

/** 프로젝트 현황 모드: 프로젝트에 달린 다가오는 이벤트 (90일 안) */
function ProjectEventsPanel({ today }: { today: string }) {
  const [y, m, d] = today.split("-").map(Number);
  const end = new Date(Date.UTC(y, m - 1, d + PROJECT_EVENT_DAYS)).toISOString().slice(0, 10);
  const filters = { start: today, end };
  const query = useQuery({ queryKey: eventKeys.list(filters), queryFn: () => listEvents(filters) });
  const [dialog, setDialog] = useState<{ mode: "create" } | { mode: "edit"; event: WorkEvent } | null>(null);
  const events = (query.data ?? []).filter((e) => e.project_id !== null);

  return (
    <section className="surface-card mt-6 rounded-[20px] p-4 md:p-5 lg:p-6" aria-labelledby="project-events-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-geist text-xs font-semibold uppercase tracking-[0.18em] text-primary">Milestones</p>
          <h2 id="project-events-heading" className="mt-1 flex items-center gap-2 text-xl font-bold text-primary-dark">
            <CalendarHeart size={20} strokeWidth={2} aria-hidden="true" />
            프로젝트 이벤트
          </h2>
          <p className="mt-1 text-sm text-muted">{PROJECT_EVENT_DAYS}일 안의 시험·발표·출품·마감 날짜예요.</p>
        </div>
        <button type="button" onClick={() => setDialog({ mode: "create" })} className="flex min-h-11 items-center gap-1.5 rounded-xl border border-border bg-surface px-3.5 text-sm font-semibold text-primary-dark hover:bg-pale-green">
          <Plus size={16} strokeWidth={2} aria-hidden="true" />
          이벤트 추가
        </button>
      </div>
      {query.isError ? (
        <p className="mt-3 text-sm text-red-700" role="alert">{query.error.message}</p>
      ) : query.isPending ? (
        <div className="mt-3 h-14 animate-pulse rounded-xl bg-pale-green/40" />
      ) : events.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-soft-sage px-4 py-4 text-center text-sm text-muted">다가오는 프로젝트 이벤트가 없어요.</p>
      ) : (
        <ul className="mt-3 grid gap-x-6 md:grid-cols-2">
          {events.map((e) => (
            <li key={e.id}><EventRow event={e} today={today} showProject onOpen={() => setDialog({ mode: "edit", event: e })} /></li>
          ))}
        </ul>
      )}
      {dialog?.mode === "create" && <EventDialog mode="create" date={today} onClose={() => setDialog(null)} />}
      {dialog?.mode === "edit" && <EventDialog mode="edit" event={dialog.event} onClose={() => setDialog(null)} />}
    </section>
  );
}
