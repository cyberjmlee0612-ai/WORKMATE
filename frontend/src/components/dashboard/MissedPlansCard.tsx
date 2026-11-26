"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, LoaderCircle } from "lucide-react";
import { ResolvePlanActions } from "@/components/time/ResolvePlanActions";
import { invalidateWorkData } from "@/lib/api/invalidate";
import { listMissedPlans, resolvePlan, timeKeys, type ResolveAction, type TimePlan } from "@/lib/api/time";
import { userTimeZone } from "@/lib/date";
import { formatDay, formatRange } from "@/lib/time";

/**
 * 밀린 계획 카드 (2026-11-26 사용자 확정: 대시보드 + 캘린더).
 * 끝났는데 거의 기록하지 않은 계획을 모아 하나씩 또는 한 번에 처리한다. 없으면 보이지 않는다.
 */
export function MissedPlansCard() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: timeKeys.missed(), queryFn: listMissedPlans });
  const [notice, setNotice] = useState<string | null>(null);

  // 한 번에 처리: 하나씩 차례로 (빈칸이 모자라면 그 계획만 남는다)
  const bulk = useMutation({
    mutationFn: async ({ plans, action }: { plans: TimePlan[]; action: ResolveAction }) => {
      const tz = userTimeZone();
      let ok = 0;
      for (const plan of plans) {
        try {
          await resolvePlan(plan.id, action, tz);
          ok += 1;
        } catch {
          // 빈칸이 없는 계획은 남겨 두고 계속한다
        }
      }
      return { ok, total: plans.length };
    },
    onSuccess: async ({ ok, total }, { action }) => {
      await invalidateWorkData(queryClient);
      const verb = action === "tomorrow" ? "내일로 옮겼어요" : "놓아줬어요";
      setNotice(ok === total ? `${ok}개를 ${verb}.` : `${ok}개를 ${verb}. ${total - ok}개는 빈칸이 없어 남았어요.`);
    },
  });

  const plans = query.data ?? [];
  if (plans.length === 0) {
    return notice ? <p className="mt-6 rounded-xl border border-soft-sage bg-pale-green/60 px-4 py-3 text-sm text-primary-dark" role="status">{notice}</p> : null;
  }

  return (
    <section className="mt-6 rounded-[20px] border border-amber-300 bg-amber-50/60 p-4 md:p-5" aria-labelledby="missed-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="missed-heading" className="flex items-center gap-2 text-lg font-bold text-amber-950">
            <History size={20} strokeWidth={2} aria-hidden="true" />
            밀린 계획 {plans.length}개
          </h2>
          <p className="mt-0.5 text-sm text-amber-900">계획은 바뀌어도 괜찮아요. 어떻게 할지만 정해 두면 돼요.</p>
        </div>
        {plans.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => bulk.mutate({ plans, action: "tomorrow" })} disabled={bulk.isPending} className="flex min-h-10 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-white hover:bg-primary-dark disabled:opacity-60">
              {bulk.isPending && <LoaderCircle size={14} strokeWidth={2} className="animate-spin" aria-hidden="true" />}
              모두 내일로
            </button>
            <button type="button" onClick={() => bulk.mutate({ plans, action: "let_go" })} disabled={bulk.isPending} className="min-h-10 rounded-lg border border-amber-300 bg-surface px-3 text-xs font-semibold text-amber-950 hover:bg-amber-100 disabled:opacity-60">
              모두 놓아주기
            </button>
          </div>
        )}
      </div>
      {notice && <p className="mt-2 text-sm text-amber-950" role="status">{notice}</p>}
      <ul className="mt-3 space-y-2">
        {plans.map((plan) => (
          <li key={plan.id} className="rounded-xl border border-amber-200 bg-surface px-3 py-2.5">
            <p className="truncate text-sm font-semibold text-primary-dark">{plan.task_title}</p>
            <p className="text-xs text-muted">{formatDay(plan.starts_at)} · {formatRange(plan.starts_at, plan.ends_at)}{plan.project_name ? ` · ${plan.project_name}` : ""}</p>
            <ResolvePlanActions plan={plan} onDone={setNotice} />
          </li>
        ))}
      </ul>
    </section>
  );
}
