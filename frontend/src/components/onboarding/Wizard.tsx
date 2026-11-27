"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CalendarClock, Check, CircleAlert, Clock, Keyboard, LoaderCircle, Sparkles, Sun, X } from "lucide-react";
import { TimeSelect } from "@/components/common/TimeSelect";
import { AlertSettings } from "@/components/layout/AlertSettings";
import { getCheckin, getPlacement, saveFocus, type PlacementBlock } from "@/lib/api/checkins";
import { invalidateWorkData } from "@/lib/api/invalidate";
import { SCHEDULE_TEMPLATES, onboardingKeys, setOnboarding } from "@/lib/api/onboarding";
import { BLOCK_KINDS, getScheduleBlocks, replaceScheduleBlocks, scheduleKeys, toMinutes, weekdaysLabel, type ScheduleBlockInput } from "@/lib/api/schedule";
import { getSettings, saveSettings, settingsKeys, DISPLAY_NAME_MAX } from "@/lib/api/settings";
import { createTask, type Task } from "@/lib/api/tasks";
import { createTimePlansBulk } from "@/lib/api/time";
import { useToday, userTimeZone } from "@/lib/date";
import { formatClock } from "@/lib/time";

const STEPS = ["시작", "시간표", "첫 업무", "첫 계획", "완료"];
const primary = "flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-60";
const ghost = "min-h-12 rounded-xl px-4 text-sm font-semibold text-muted hover:bg-pale-green hover:text-primary-dark";
const input = "mt-1.5 block min-h-12 w-full rounded-xl border border-border bg-surface px-3.5 text-[15px] focus:border-primary focus:outline-none";

/**
 * 처음 사용자 안내 (2026-11-27 사용자 확정): 시작 → 시간표 → 첫 업무 → 첫 계획 → 완료.
 * 언제든 '나중에 할게요'로 나가면 대시보드 체크리스트로 이어서 할 수 있다.
 */
export function Wizard() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [task, setTask] = useState<Task | null>(null);

  const leave = useMutation({
    mutationFn: (state: "checklist" | "done") => setOnboarding(state),
    onSuccess: (data) => {
      queryClient.setQueryData(onboardingKeys.all, data);
      router.replace("/");
    },
  });
  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between gap-3">
        <ol className="flex flex-wrap items-center gap-1.5 text-xs" aria-label="안내 단계">
          {STEPS.map((label, i) => (
            <li key={label} className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold ${i === step ? "bg-primary text-white" : i < step ? "bg-pale-green text-primary-dark" : "text-muted"}`} aria-current={i === step ? "step" : undefined}>
              {i < step ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : <span aria-hidden="true">{i + 1}</span>}
              {label}
            </li>
          ))}
        </ol>
        {step < STEPS.length - 1 && (
          <button type="button" onClick={() => leave.mutate("checklist")} disabled={leave.isPending} className="flex min-h-11 shrink-0 items-center gap-1 rounded-xl px-3 text-sm text-muted hover:bg-pale-green">
            <X size={16} aria-hidden="true" />
            나중에 할게요
          </button>
        )}
      </div>

      <section className="surface-card mt-5 rounded-[24px] p-5 md:p-8">
        {step === 0 && <Welcome onNext={next} />}
        {step === 1 && <ScheduleStep onNext={next} />}
        {step === 2 && <TaskStep onNext={(t) => { setTask(t); next(); }} />}
        {step === 3 && <PlanStep task={task} onNext={next} />}
        {step === 4 && (
          <div>
            <h1 className="text-2xl font-bold text-primary-dark">준비 끝! 🎉</h1>
            <p className="mt-2 text-muted">이제 하루를 이렇게 써 보세요.</p>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li className="flex gap-2.5"><Sun size={18} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />아침에 대시보드에서 <strong>오늘 꼭 할 일 3개</strong>를 고르고, 저녁에 1분 마무리해요.</li>
              <li className="flex gap-2.5"><Keyboard size={18} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />어디서든 <strong>Ctrl+K</strong>로 &ldquo;내일 3시 회의 1시간&rdquo;처럼 한 줄 입력해요.</li>
              <li className="flex gap-2.5"><Clock size={18} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />계획 시간에 알림이 오면 <strong>타이머</strong>를 켜고, 쌓인 기록으로 리포트에서 돌아봐요.</li>
            </ul>
            <div className="mt-6 rounded-2xl border border-border p-4">
              <p className="text-sm font-semibold text-primary-dark">계획 시간 알림 받기</p>
              <div className="mt-2"><AlertSettings /></div>
            </div>
            <button type="button" onClick={() => leave.mutate("done")} disabled={leave.isPending} className={`${primary} mt-6 w-full`}>
              {leave.isPending ? <LoaderCircle size={18} className="animate-spin" aria-hidden="true" /> : <ArrowRight size={18} aria-hidden="true" />}
              WORKMATE 시작하기
            </button>
          </div>
        )}
        {leave.isError && <p className="mt-3 text-sm font-semibold text-red-700" role="alert">{leave.error.message}</p>}
      </section>
    </div>
  );
}

function Welcome({ onNext }: { onNext: () => void }) {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: settingsKeys.all, queryFn: getSettings });
  const [name, setName] = useState<string | null>(null);
  const value = name ?? settings.data?.display_name ?? "";
  const save = useMutation({
    mutationFn: () => saveSettings({ display_name: value.trim() || null }),
    onSuccess: (data) => {
      queryClient.setQueryData(settingsKeys.all, data);
      onNext();
    },
  });
  return (
    <div>
      <p className="font-geist text-xs font-semibold uppercase tracking-[0.22em] text-primary">Welcome</p>
      <h1 className="mt-2 text-2xl font-bold text-primary-dark md:text-[28px]">WORKMATE에 오신 걸 환영해요 👋</h1>
      <p className="mt-3 leading-7 text-muted">
        계획을 세우고, 해 보고, 돌아보면서 <strong className="text-foreground">조금씩 나에게 맞는 시간 사용법</strong>을 찾아가는 곳이에요.
        3분이면 첫 하루를 준비할 수 있어요.
      </p>
      <label className="mt-6 block text-sm font-medium">
        뭐라고 불러 드릴까요? <span className="font-normal text-muted">(선택)</span>
        <input value={value} onChange={(e) => setName(e.target.value)} maxLength={DISPLAY_NAME_MAX} placeholder="예: 정민" className={input} />
      </label>
      <div className="mt-6 flex justify-end">
        <button type="button" onClick={() => (value.trim() !== (settings.data?.display_name ?? "") ? save.mutate() : onNext())} disabled={save.isPending} className={primary}>
          {save.isPending ? <LoaderCircle size={18} className="animate-spin" aria-hidden="true" /> : null}
          시작하기 <ArrowRight size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function ScheduleStep({ onNext }: { onNext: () => void }) {
  const queryClient = useQueryClient();
  const existing = useQuery({ queryKey: scheduleKeys.all, queryFn: getScheduleBlocks });
  const [picked, setPicked] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<ScheduleBlockInput[]>([]);
  const save = useMutation({
    mutationFn: () => replaceScheduleBlocks(blocks),
    onSuccess: (data) => {
      queryClient.setQueryData(scheduleKeys.all, data);
      onNext();
    },
  });
  const pick = (key: string) => {
    setPicked(key);
    setBlocks((SCHEDULE_TEMPLATES.find((t) => t.key === key)?.blocks ?? []).map((b) => ({ ...b, weekdays: [...b.weekdays] })));
  };
  const invalid = blocks.some((b) => toMinutes(b.end) - toMinutes(b.start) < 10);

  return (
    <div>
      <h1 className="text-xl font-bold text-primary-dark">1. 나의 하루는 어떻게 생겼나요?</h1>
      <p className="mt-2 text-sm leading-6 text-muted">가까운 유형을 고르고 시각만 맞춰 주세요. 캘린더에 배경으로 보이고, 계획은 <strong className="text-foreground">일·공부 시간</strong> 안에 잡아 드려요.</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {SCHEDULE_TEMPLATES.map((t) => (
          <button key={t.key} type="button" aria-pressed={picked === t.key} onClick={() => pick(t.key)} className={`rounded-2xl border p-4 text-left ${picked === t.key ? "border-primary bg-pale-green" : "border-border hover:bg-pale-green/40"}`}>
            <span className="block font-bold text-primary-dark">{t.label}</span>
            <span className="mt-0.5 block text-xs text-muted">{t.hint}</span>
          </button>
        ))}
      </div>

      {picked && (
        <ul className="mt-4 space-y-2">
          {blocks.map((b, i) => (
            <li key={`${b.title}-${i}`} className="flex flex-wrap items-center gap-2 rounded-xl border border-border px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-primary-dark">{b.title}</span>
                <span className="block text-xs text-muted">{weekdaysLabel(b.weekdays)} · {BLOCK_KINDS.find((k) => k.value === b.kind)?.label}</span>
              </span>
              <TimeSelect label={`${b.title} 시작`} value={b.start} onChange={(v) => setBlocks((cur) => cur.map((x, j) => (j === i ? { ...x, start: v } : x)))} />
              <span className="text-muted">–</span>
              <TimeSelect label={`${b.title} 끝`} value={b.end} allow24 invalid={toMinutes(b.end) - toMinutes(b.start) < 10} onChange={(v) => setBlocks((cur) => cur.map((x, j) => (j === i ? { ...x, end: v } : x)))} />
            </li>
          ))}
        </ul>
      )}
      {(existing.data?.length ?? 0) > 0 && !picked && <p className="mt-3 text-sm text-primary-dark">이미 시간표가 있어요. 그대로 두려면 &lsquo;다음&rsquo;을 누르세요.</p>}
      {save.isError && <p className="mt-3 text-sm font-semibold text-red-700" role="alert">{save.error.message}</p>}
      <div className="mt-6 flex flex-wrap justify-between gap-2">
        <button type="button" onClick={onNext} className={ghost}>{(existing.data?.length ?? 0) > 0 ? "다음" : "건너뛰기 (설정에서 나중에)"}</button>
        <button type="button" onClick={() => save.mutate()} disabled={!picked || invalid || save.isPending} className={primary}>
          {save.isPending && <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />}
          이 시간표로 할게요 <ArrowRight size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

const MINUTE_CHOICES = [30, 60, 120];
const TASK_EXAMPLES = ["보고서 초안 쓰기", "영어 단어 외우기", "이메일 정리하기", "운동하기"];

function TaskStep({ onNext }: { onNext: (task: Task) => void }) {
  const today = useToday();
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState(60);
  const [due, setDue] = useState<"today" | "tomorrow" | "none">("today");
  const create = useMutation({
    mutationFn: () => {
      const tomorrow = today ? new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10) + 1)).toISOString().slice(0, 10) : null;
      return createTask({
        title: title.trim(), description: null, project_id: null, status: "todo", priority: "medium",
        due_date: due === "today" ? today : due === "tomorrow" ? tomorrow : null, estimated_minutes: minutes,
      });
    },
    onSuccess: onNext,
  });
  const chip = (on: boolean) => `min-h-11 rounded-xl border px-3.5 text-sm font-semibold ${on ? "border-primary bg-pale-green text-primary-dark" : "border-border text-muted hover:bg-pale-green/40"}`;

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (title.trim() && !create.isPending) create.mutate(); }}>
      <h1 className="text-xl font-bold text-primary-dark">2. 오늘 꼭 하고 싶은 일 하나만 적어 볼까요?</h1>
      <p className="mt-2 text-sm leading-6 text-muted">크게 생각하지 말고, <strong className="text-foreground">오늘 끝낼 수 있는 작은 일</strong> 하나면 충분해요.</p>
      <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} placeholder="예: 보고서 초안 쓰기" autoFocus className={input} aria-label="업무 제목" />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {TASK_EXAMPLES.map((ex) => <button key={ex} type="button" onClick={() => setTitle(ex)} className="min-h-9 rounded-lg bg-pale-green/60 px-2.5 text-xs text-primary-dark hover:bg-pale-green">{ex}</button>)}
      </div>
      <p className="mt-5 text-sm font-medium">얼마나 걸릴 것 같나요?</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {MINUTE_CHOICES.map((m) => <button key={m} type="button" aria-pressed={minutes === m} onClick={() => setMinutes(m)} className={chip(minutes === m)}>{m < 60 ? `${m}분` : `${m / 60}시간`}</button>)}
      </div>
      <p className="mt-4 text-sm font-medium">언제까지?</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {([["today", "오늘"], ["tomorrow", "내일"], ["none", "정하지 않음"]] as const).map(([v, l]) => <button key={v} type="button" aria-pressed={due === v} onClick={() => setDue(v)} className={chip(due === v)}>{l}</button>)}
      </div>
      {create.isError && <p className="mt-3 text-sm font-semibold text-red-700" role="alert">{create.error.message}</p>}
      <div className="mt-6 flex justify-end">
        <button type="submit" disabled={!title.trim() || create.isPending || !today} className={primary}>
          {create.isPending && <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />}
          업무 만들기 <ArrowRight size={18} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}

function PlanStep({ task, onNext }: { task: Task | null; onNext: () => void }) {
  const queryClient = useQueryClient();
  const today = useToday();
  const [tz] = useState(userTimeZone);
  // 만든 업무를 오늘의 '꼭 할 일'로 정하고 빈칸을 찾는다 (아침 체크인과 같은 방식)
  const slot = useQuery({
    queryKey: ["onboarding-slot", task?.id, today],
    queryFn: async () => {
      // 이미 오늘 고른 꼭 할 일은 그대로 두고 이 업무를 더한다 (최대 3개)
      const current = (await getCheckin(today!)).focus.map((f) => f.task.id);
      if (!current.includes(task!.id)) await saveFocus(today!, [...current.slice(0, 2), task!.id]);
      return getPlacement(today!, tz);
    },
    enabled: Boolean(task && today),
    staleTime: Infinity,
  });
  const block: PlacementBlock | undefined = slot.data?.blocks[0];
  const place = useMutation({
    mutationFn: () => createTimePlansBulk([{ task_id: block!.task_id, starts_at: block!.starts_at, ends_at: block!.ends_at }]),
    onSuccess: async () => {
      await invalidateWorkData(queryClient);
      onNext();
    },
  });

  return (
    <div>
      <h1 className="text-xl font-bold text-primary-dark">3. 언제 할지 정해 둘까요?</h1>
      <p className="mt-2 text-sm leading-6 text-muted">시간을 정해 두면 그 시간에 알려 드리고, 타이머를 바로 켤 수 있어요. 할 일을 &lsquo;언제&rsquo;까지 정하는 게 계획의 절반이에요.</p>
      {!task ? (
        <p className="mt-4 text-sm text-muted">업무를 만들지 않아 건너뛸게요.</p>
      ) : slot.isPending ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted"><LoaderCircle size={16} className="animate-spin" aria-hidden="true" />빈 시간을 찾는 중…</p>
      ) : block ? (
        <div className="mt-4 rounded-2xl border border-primary/40 bg-pale-green/50 p-4">
          <p className="flex items-center gap-2 text-sm text-muted"><CalendarClock size={16} aria-hidden="true" />오늘 가장 이른 빈 시간</p>
          <p className="mt-1 text-lg font-bold text-primary-dark">{formatClock(block.starts_at)} – {formatClock(block.ends_at)}</p>
          <p className="text-sm text-foreground">{block.task_title}</p>
        </div>
      ) : (
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-3 text-sm text-amber-900">
          <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          오늘 남은 일·공부 시간에 빈칸이 없어요. 내일 아침 대시보드에서 다시 계획해 보세요.
        </p>
      )}
      {(slot.isError || place.isError) && <p className="mt-3 text-sm font-semibold text-red-700" role="alert">{(slot.error ?? place.error)?.message}</p>}
      <div className="mt-6 flex flex-wrap justify-between gap-2">
        <button type="button" onClick={onNext} className={ghost}>건너뛰기</button>
        {block && (
          <button type="button" onClick={() => place.mutate()} disabled={place.isPending} className={primary}>
            {place.isPending ? <LoaderCircle size={18} className="animate-spin" aria-hidden="true" /> : <Sparkles size={18} aria-hidden="true" />}
            이 시간에 넣기
          </button>
        )}
      </div>
    </div>
  );
}
