"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CalendarDays, ChartNoAxesCombined, ChevronLeft, ChevronRight } from "lucide-react";
import { EmptyState, ErrorState } from "@/components/common/QueryStates";
import { getReport, reportKeys, REPORT_MAX_DAYS } from "@/lib/api/reports";
import { toLocalDateString, useToday, userTimeZone } from "@/lib/date";
import { parseDateParam } from "@/lib/time";
import { AiReviewCard } from "./AiReviewCard";
import { FocusSummary } from "./FocusSummary";
import { DailyChart } from "./ReportCharts";
import { CalibrationSummary, Estimates, ProjectBreakdown, SummaryCards, TopTasks } from "./ReportSections";
import { dayCount, periodKey, periodTitle, resolvePeriod, shiftAnchor, validateCustom, type Period, type PeriodMode } from "./period";

const toggleClass = (active: boolean) =>
  `min-h-11 rounded-lg px-3.5 text-sm font-semibold ${active ? "bg-surface text-primary-dark shadow-sm" : "text-muted hover:text-primary-dark"}`;
const navButton = "flex size-11 items-center justify-center rounded-xl border border-border bg-surface text-primary-dark hover:bg-pale-green";

export function ReportView() {
  const today = useToday();
  if (!today) return <ReportSkeleton />; // '오늘'은 브라우저에서만 알 수 있다
  return <ReportBody today={today} />;
}

function ReportBody({ today }: { today: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const period = resolvePeriod(new URLSearchParams(searchParams.toString()), parseDateParam(today)!);
  const start = toLocalDateString(period.start);
  const end = toLocalDateString(period.end);
  const tz = userTimeZone();

  const query = useQuery({
    queryKey: reportKeys.detail(start, end, tz),
    queryFn: () => getReport(start, end, tz),
    placeholderData: keepPreviousData, // 기간을 넘길 때 화면이 비지 않게
  });

  function navigate(params: Record<string, string>) {
    router.replace(`${pathname}?${new URLSearchParams(params).toString()}`, { scroll: false });
  }
  const setMode = (mode: PeriodMode) => {
    if (mode === "custom") navigate({ mode, start, end });
    else navigate({ mode, date: start });
  };
  const shift = (direction: -1 | 1) => navigate({ mode: period.mode, date: toLocalDateString(shiftAnchor(period, direction)) });

  const report = query.data;
  const stale = query.isPlaceholderData;
  const s = report?.summary;
  const hasData = Boolean(s && (s.tracked_minutes || s.planned_minutes || s.completed_tasks || s.due_settled));

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        {period.mode !== "custom" && (
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => shift(-1)} className={navButton} aria-label={period.mode === "week" ? "이전 주" : "이전 달"}>
              <ChevronLeft size={20} strokeWidth={2} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => navigate({ mode: period.mode, date: today })} className="min-h-11 rounded-xl border border-border bg-surface px-3.5 text-sm font-semibold text-primary-dark hover:bg-pale-green">
              {period.mode === "week" ? "이번 주" : "이번 달"}
            </button>
            <button type="button" onClick={() => shift(1)} className={navButton} aria-label={period.mode === "week" ? "다음 주" : "다음 달"}>
              <ChevronRight size={20} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        )}
        <h2 className="min-w-0 text-lg font-bold text-primary-dark" aria-live="polite">
          {periodTitle(period)}
          <span className="ml-2 text-sm font-normal text-muted">{dayCount(period.start, period.end)}일</span>
        </h2>
        <div className="ml-auto flex rounded-xl bg-pale-green/70 p-1" role="group" aria-label="기간 단위">
          <button type="button" aria-pressed={period.mode === "week"} onClick={() => setMode("week")} className={toggleClass(period.mode === "week")}>주간</button>
          <button type="button" aria-pressed={period.mode === "month"} onClick={() => setMode("month")} className={toggleClass(period.mode === "month")}>월간</button>
          <button type="button" aria-pressed={period.mode === "custom"} onClick={() => setMode("custom")} className={toggleClass(period.mode === "custom")}>직접 지정</button>
        </div>
      </div>

      {period.mode === "custom" && <CustomRange key={periodKey(period)} period={period} onApply={(s2, e2) => navigate({ mode: "custom", start: s2, end: e2 })} />}

      {query.isError && !report ? (
        <div className="mt-6"><ErrorState message={query.error.message} onRetry={() => query.refetch()} retrying={query.isRefetching} /></div>
      ) : !report ? (
        <ReportSkeleton />
      ) : (
        <div className={`mt-6 space-y-5 transition-opacity ${stale ? "opacity-60" : ""}`} aria-busy={stale}>
          <SummaryCards report={report} />
          {!hasData && report.projects.length === 0 && (
            <EmptyState
              icon={ChartNoAxesCombined}
              title="이 기간에는 기록이 없어요"
              description="캘린더에서 업무를 계획하거나 타이머로 시간을 기록하면 리포트가 채워져요."
              action={<Link href="/calendar" className="flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark"><CalendarDays size={18} strokeWidth={2} aria-hidden="true" />캘린더로 가기</Link>}
            />
          )}
          <Card title="날짜별 계획 vs 실제" description="시간표에 계획한 시간과 실제로 기록한 시간이에요.">
            <DailyChart days={report.daily} />
          </Card>
          <Card title="프로젝트별 시간" description="하위 프로젝트 시간은 상위에 합산돼요. 화살표를 누르면 하위별로 볼 수 있어요.">
            <ProjectBreakdown report={report} />
          </Card>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="시간을 많이 쓴 업무" description="이 기간에 기록한 시간 순, 최대 10개">
              <TopTasks report={report} />
            </Card>
            <Card title="예상 vs 실제" description="이 기간에 완료한 업무의 예상 시간과 실제 기록 시간(전체)을 비교해요.">
              <CalibrationSummary />
              <Estimates report={report} />
            </Card>
          </div>
          <Card title="집중 모드" description="집중한 횟수와 끝까지 해낸 비율, 무엇이 집중을 방해했는지 보여 줘요.">
            <FocusSummary start={start} end={end} tz={tz} />
          </Card>
          <AiReviewCard start={start} end={end} tz={tz} periodKey={periodKey(period)} hasData={hasData && !stale} />
        </div>
      )}
    </>
  );
}

function CustomRange({ period, onApply }: { period: Period; onApply: (start: string, end: string) => void }) {
  const [start, setStart] = useState(toLocalDateString(period.start));
  const [end, setEnd] = useState(toLocalDateString(period.end));
  const [error, setError] = useState<string | null>(null);

  function apply(event: FormEvent) {
    event.preventDefault();
    const s = parseDateParam(start);
    const e = parseDateParam(end);
    if (!s || !e) return setError("날짜를 모두 입력해 주세요.");
    const problem = validateCustom(s, e);
    if (problem) return setError(problem);
    setError(null);
    onApply(start, end);
  }

  return (
    <form onSubmit={apply} className="mt-3 flex flex-wrap items-end gap-2 rounded-2xl border border-border bg-surface px-4 py-3" noValidate>
      <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
        시작
        <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="min-h-11 rounded-xl border border-border bg-surface px-3 text-sm text-foreground" required />
      </label>
      <span className="pb-3 text-muted" aria-hidden="true">–</span>
      <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
        끝
        <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="min-h-11 rounded-xl border border-border bg-surface px-3 text-sm text-foreground" required aria-invalid={Boolean(error)} aria-describedby="custom-range-help" />
      </label>
      <button type="submit" className="min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark">적용</button>
      <p id="custom-range-help" className={`w-full text-xs ${error ? "font-semibold text-red-700" : "text-muted"}`} role={error ? "alert" : undefined}>
        {error ?? `최대 ${REPORT_MAX_DAYS}일까지 볼 수 있어요.`}
      </p>
    </form>
  );
}

function Card({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="surface-card rounded-[20px] p-4 md:p-5 lg:p-6">
      <h2 className="text-lg font-bold text-primary-dark">{title}</h2>
      <p className="mt-1 text-sm text-muted">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function ReportSkeleton() {
  return (
    <div className="mt-6 space-y-5" aria-busy="true" aria-label="불러오는 중">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <div key={i} className="h-[136px] animate-pulse rounded-[20px] bg-pale-green/40" />)}
      </div>
      <div className="h-80 animate-pulse rounded-[20px] bg-pale-green/40" />
    </div>
  );
}
