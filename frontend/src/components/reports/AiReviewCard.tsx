"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Lightbulb, LoaderCircle, ShieldAlert, Sparkles, ThumbsUp, TrendingUp } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { aiKeys, getAiUsage } from "@/lib/api/ai";
import { requestReportReview, type ReportReview } from "@/lib/api/reports";

/**
 * AI 회고 (선택 사항, 2026-11-26 사용자 요청). 누를 때만 요청하고 저장하지 않는다.
 * 기간이 바뀌면 이전 결과는 보이지 않는다 (periodKey로 구분).
 */
export function AiReviewCard({ start, end, tz, periodKey, hasData }: { start: string; end: string; tz: string; periodKey: string; hasData: boolean }) {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<{ key: string; review: ReportReview } | null>(null);
  const usageQuery = useQuery({ queryKey: aiKeys.usage(tz), queryFn: () => getAiUsage(tz) });
  const usage = usageQuery.data;

  const review = useMutation({
    // 요청한 기간을 함께 넘겨, 응답 전에 기간을 바꿔도 결과가 다른 기간에 붙지 않게 한다
    mutationFn: (vars: { key: string; start: string; end: string }) => requestReportReview({ start: vars.start, end: vars.end, tz }),
    onSuccess: (data, vars) => {
      setResult({ key: vars.key, review: data });
      queryClient.setQueryData(aiKeys.usage(tz), data.usage);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: aiKeys.usage(tz) }),
  });

  const current = result?.key === periodKey ? result.review : null;
  const error = review.isError && review.variables?.key === periodKey ? review.error.message : null;
  const notConfigured = usage && !usage.configured;
  const outOfQuota = usage ? usage.configured && usage.remaining <= 0 : false;
  const disabled = !hasData || review.isPending || Boolean(notConfigured) || outOfQuota;

  return (
    <section className="liquid-accent rounded-[20px] p-4 md:p-5 lg:p-6" aria-labelledby="ai-review-heading" aria-busy={review.isPending}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="ai-review-heading" className="flex items-center gap-2 text-lg font-bold text-primary-dark">
            <Sparkles size={20} strokeWidth={2} aria-hidden="true" />
            AI 회고
          </h2>
          <p className="mt-1 text-sm text-muted">이 기간의 숫자를 보고 잘한 점, 아쉬운 점, 다음에 해 볼 일을 정리해 드려요. 저장되지 않아요.</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={() => review.mutate({ key: periodKey, start, end })}
            disabled={disabled}
            className="flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-60"
          >
            {review.isPending ? <LoaderCircle size={18} strokeWidth={2} className="animate-spin" aria-hidden="true" /> : <Sparkles size={18} strokeWidth={2} aria-hidden="true" />}
            {review.isPending ? "분석하는 중…" : current ? "다시 받기" : "AI 회고 받기"}
          </button>
          {usage?.configured && <span className="text-xs text-muted" aria-live="polite">오늘 {usage.remaining}회 남음 (하루 {usage.limit}회)</span>}
        </div>
      </div>

      {!hasData && <p className="mt-3 text-sm text-muted">이 기간에는 분석할 기록이 없어요.</p>}
      {notConfigured && <p className="mt-3 text-sm text-amber-900">AI 기능이 아직 설정되지 않았어요.</p>}
      {outOfQuota && <p className="mt-3 text-sm text-amber-900">오늘 AI 사용 횟수를 모두 썼어요. 내일 다시 이용해 주세요.</p>}
      {error && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800" role="alert">
          <CircleAlert size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      {current && (
        <div className="mt-4 space-y-4" aria-live="polite">
          {current.headline && <p className="rounded-xl bg-surface/80 px-4 py-3 text-base font-semibold text-primary-dark">{current.headline}</p>}
          <div className="grid gap-3 md:grid-cols-3">
            <Points title="잘한 점" icon={ThumbsUp} items={current.good} />
            <Points title="아쉬운 점" icon={TrendingUp} items={current.improve} />
            <Points title="다음에 해 볼 일" icon={Lightbulb} items={current.suggestions} />
          </div>
        </div>
      )}

      <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-muted">
        <ShieldAlert size={14} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
        이 기간의 시간·완료 수치와 업무 제목·프로젝트 이름이 Google Gemini API로 전송돼요. 무료 등급에서는 Google이 서비스 개선에 사용할 수 있어요.
      </p>
    </section>
  );
}

function Points({ title, icon: Icon, items }: { title: string; icon: LucideIcon; items: string[] }) {
  return (
    <div className="rounded-xl bg-surface/80 p-3.5">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-primary-dark"><Icon size={16} strokeWidth={2} aria-hidden="true" />{title}</p>
      {items.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-6 text-foreground">{items.map((item) => <li key={item}>{item}</li>)}</ul>
      ) : (
        <p className="mt-2 text-sm text-muted">특별히 없어요.</p>
      )}
    </div>
  );
}
