import { Suspense } from "react";
import { CalendarView } from "@/components/calendar/CalendarView";

export default function CalendarPage() {
  return (
    <>
      <header className="min-w-0">
        <p className="font-geist text-xs font-semibold uppercase tracking-[0.22em] text-primary">Calendar</p>
        <h1 className="mt-3 text-[28px] font-bold leading-tight text-primary-dark md:text-[32px]">시간표</h1>
        <p className="mt-2 text-sm text-muted md:text-base">업무를 시간표에 배치해 계획하고, 실제로 한 시간과 비교해 보세요.</p>
      </header>
      {/* useSearchParams(날짜·보기)를 쓰므로 Suspense 경계가 필요하다 */}
      <Suspense fallback={<div className="mt-6 h-[calc(100dvh-15rem)] min-h-[28rem] animate-pulse rounded-[20px] bg-pale-green/40" />}>
        <CalendarView />
      </Suspense>
    </>
  );
}
