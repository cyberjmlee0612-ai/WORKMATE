import { Suspense } from "react";
import { ReportSkeleton, ReportView } from "@/components/reports/ReportView";

export default function ReportsPage() {
  return (
    <>
      <header className="min-w-0">
        <p className="font-geist text-xs font-semibold uppercase tracking-[0.22em] text-primary">Report</p>
        <h1 className="mt-3 text-[28px] font-bold leading-tight text-primary-dark md:text-[32px]">리포트</h1>
        <p className="mt-2 text-sm text-muted md:text-base">계획한 시간과 실제로 한 시간, 프로젝트별 시간과 완료 흐름을 돌아보세요.</p>
      </header>
      {/* useSearchParams(기간)를 쓰므로 Suspense 경계가 필요하다 */}
      <Suspense fallback={<ReportSkeleton />}>
        <ReportView />
      </Suspense>
    </>
  );
}
