"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Rocket, X } from "lucide-react";
import { getOnboarding, onboardingKeys, setOnboarding } from "@/lib/api/onboarding";

const ITEMS = [
  { key: "schedule", label: "나의 시간표 정하기", href: "/settings" },
  { key: "task", label: "첫 업무 만들기", href: "/tasks" },
  { key: "plan", label: "첫 계획을 시간표에 넣기", href: "/calendar" },
] as const;

/**
 * 대시보드 '시작하기' 체크리스트 (2026-11-27 사용자 확정).
 * 새 사용자면 안내 화면(/welcome)으로 보내고, 안내 화면을 나갔으면 남은 단계를 여기서 이어서 한다.
 */
export function OnboardingChecklist() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: onboardingKeys.all, queryFn: getOnboarding });
  const dismiss = useMutation({
    mutationFn: () => setOnboarding("done"),
    onSuccess: (data) => queryClient.setQueryData(onboardingKeys.all, data),
  });

  const showWizard = query.data?.show_wizard;
  useEffect(() => {
    if (showWizard) router.replace("/welcome");
  }, [showWizard, router]);

  const data = query.data;
  if (!data?.show_checklist) return null;
  const done = ITEMS.filter((i) => data.steps[i.key]).length;
  const all = done === ITEMS.length;

  return (
    <section className="mt-6 rounded-[20px] border border-primary/30 bg-pale-green/40 p-4 md:p-5" aria-labelledby="onboarding-heading">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="onboarding-heading" className="flex items-center gap-2 text-lg font-bold text-primary-dark">
            <Rocket size={20} strokeWidth={2} aria-hidden="true" />
            {all ? "시작 준비 끝! 🎉" : `시작하기 ${done}/${ITEMS.length}`}
          </h2>
          <p className="mt-0.5 text-sm text-muted">{all ? "이제 아침 체크인과 저녁 마무리로 하루를 돌려 보세요." : "세 가지만 해 두면 WORKMATE가 하루를 도와줄 수 있어요."}</p>
        </div>
        <button type="button" onClick={() => dismiss.mutate()} disabled={dismiss.isPending} className="flex size-10 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-pale-green" aria-label="시작하기 닫기">
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <ul className="mt-3 grid gap-2 sm:grid-cols-3">
        {ITEMS.map((item) => {
          const ok = data.steps[item.key];
          return (
            <li key={item.key}>
              <Link href={item.href} className={`flex min-h-12 items-center gap-2.5 rounded-xl border px-3 text-sm ${ok ? "border-soft-sage bg-surface/60 text-muted line-through" : "border-border bg-surface font-semibold text-primary-dark hover:border-primary"}`}>
                <span className={`flex size-6 shrink-0 items-center justify-center rounded-full ${ok ? "bg-primary text-white" : "border-2 border-soft-sage"}`}>
                  {ok && <Check size={14} strokeWidth={3} aria-hidden="true" />}
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
      {!all && (
        <button type="button" onClick={() => router.push("/welcome")} className="mt-3 min-h-10 text-sm font-semibold text-primary hover:underline">안내 따라 하기</button>
      )}
    </section>
  );
}
