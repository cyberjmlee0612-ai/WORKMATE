"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, CircleAlert, LoaderCircle, Moon, Pencil, Sparkles, Sunrise, Target } from "lucide-react";
import { TaskCheckbox } from "@/components/tasks/TaskCheckbox";
import {
  MAX_FOCUS, MOODS, REVIEW_NOTE_MAX, checkinKeys, getCheckin, getPlacement, saveFocus, saveReview,
  type Checkin, type OutcomeInput, type PlacementBlock,
} from "@/lib/api/checkins";
import { invalidateWorkData } from "@/lib/api/invalidate";
import type { ScheduleBlock } from "@/lib/api/schedule";
import { toMinutes } from "@/lib/api/schedule";
import { createTimePlansBulk } from "@/lib/api/time";
import type { Task } from "@/lib/api/tasks";
import { formatDate } from "@/lib/format";
import { userTimeZone } from "@/lib/date";
import { formatClock } from "@/lib/time";

type Mode = "auto" | "pick" | "wrap";
const EVENING_HOUR = 18;

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + n));
  return date.toISOString().slice(0, 10);
}

/**
 * 아침 체크인 / 저녁 마무리 카드 (2026-11-26 사용자 확정: 대시보드 카드, 꼭 할 일 최대 3개, 시간표 배치는 선택).
 * 아침: 꼭 할 일 고르기 → 낮: 진행 상황과 (선택) 시간표 빈칸에 넣기 → 저녁: 못 한 일 처리 + 기분·한 줄 회고.
 * 저녁은 18시 이후 또는 그날 마지막 일·공부 시간이 끝난 뒤. 언제든 '하루 마무리'를 눌러 열 수 있다.
 */
export function CheckinCard({ today, nowMinute, schedule }: { today: string; nowMinute: number | null; schedule: ScheduleBlock[] }) {
  const query = useQuery({ queryKey: checkinKeys.day(today), queryFn: () => getCheckin(today) });
  const [mode, setMode] = useState<Mode>("auto");

  if (query.isError) {
    return <p className="mt-6 rounded-[20px] border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">{query.error.message}</p>;
  }
  if (!query.data || nowMinute === null) return <div className="mt-6 h-40 animate-pulse rounded-[20px] bg-pale-green/40" aria-hidden="true" />;

  const checkin = query.data;
  const now = new Date(nowMinute * 60_000);
  const minutes = now.getHours() * 60 + now.getMinutes();
  const lastWorkEnd = Math.max(0, ...schedule.filter((b) => b.kind === "work").map((b) => toMinutes(b.end)));
  const evening = now.getHours() >= EVENING_HOUR || (lastWorkEnd > 0 && minutes >= lastWorkEnd);

  const view =
    mode === "pick" ? "pick"
    : mode === "wrap" ? "wrap"
    : checkin.review ? "done"
    : evening ? "wrap"
    : checkin.focus.length === 0 ? "pick"
    : "today";
  const back = () => setMode("auto");

  return (
    <section className="mt-6 rounded-[20px] border border-soft-sage bg-surface p-4 shadow-[var(--card-shadow)] md:p-5" aria-labelledby="checkin-heading">
      {view === "pick" && <Picker checkin={checkin} today={today} onDone={back} canCancel={mode === "pick" && checkin.focus.length > 0} />}
      {view === "today" && <Today checkin={checkin} today={today} onRepick={() => setMode("pick")} onWrap={() => setMode("wrap")} />}
      {view === "wrap" && <WrapUp checkin={checkin} today={today} onDone={back} canCancel={mode === "wrap" || Boolean(checkin.review)} />}
      {view === "done" && <Done checkin={checkin} onEdit={() => setMode("wrap")} />}
    </section>
  );
}

function Heading({ icon: Icon, title, sub }: { icon: typeof Sunrise; title: string; sub: string }) {
  return (
    <div>
      <h2 id="checkin-heading" className="flex items-center gap-2 text-lg font-bold text-primary-dark">
        <Icon size={20} strokeWidth={2} aria-hidden="true" />
        {title}
      </h2>
      <p className="mt-0.5 text-sm text-muted">{sub}</p>
    </div>
  );
}

function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800" role="alert">
      <CircleAlert size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
      {message}
    </p>
  );
}

const primary = "flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-60";
const secondary = "flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-primary-dark hover:bg-pale-green disabled:opacity-60";

// ---------------------------------------------------------------- 아침: 꼭 할 일 고르기

function Picker({ checkin, today, onDone, canCancel }: { checkin: Checkin; today: string; onDone: () => void; canCancel: boolean }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>(() => checkin.focus.map((f) => f.task.id));
  const candidates: { task: Task; reason: string }[] = [
    ...checkin.focus.map((f) => ({ task: f.task, reason: "오늘 고른 일" })),
    ...checkin.suggestions,
  ];
  const save = useMutation({
    mutationFn: () => saveFocus(today, selected),
    onSuccess: (data) => {
      queryClient.setQueryData(checkinKeys.day(today), data);
      onDone();
    },
  });
  const toggle = (id: string) =>
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAX_FOCUS ? cur : [...cur, id]));

  return (
    <div>
      <Heading icon={Sunrise} title="오늘 꼭 할 일 고르기" sub={`딱 ${MAX_FOCUS}개까지만 골라요. 적게 골라 끝내는 경험이 중요해요.`} />
      {candidates.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-soft-sage px-4 py-4 text-center text-sm text-muted">
          남은 업무가 없어요. <Link href="/tasks" className="font-semibold text-primary hover:underline">업무를 추가</Link>하거나 <Link href="/assistant" className="font-semibold text-primary hover:underline">AI로 나눠</Link> 보세요.
        </p>
      ) : (
        <ul className="mt-3 grid gap-2 md:grid-cols-2">
          {candidates.map(({ task, reason }) => {
            const on = selected.includes(task.id);
            const order = selected.indexOf(task.id) + 1;
            const full = !on && selected.length >= MAX_FOCUS;
            return (
              <li key={task.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  disabled={full}
                  onClick={() => toggle(task.id)}
                  className={`flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left ${on ? "border-primary bg-pale-green" : "border-border bg-surface hover:bg-pale-green/40"} disabled:opacity-45`}
                >
                  <span className={`flex size-7 shrink-0 items-center justify-center rounded-full font-geist text-sm font-bold ${on ? "bg-primary text-white" : "border border-border text-muted"}`}>{on ? order : ""}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-primary-dark">{task.title}</span>
                    <span className="block truncate text-xs text-muted">{reason}{task.project_path ? ` · ${task.project_path}` : ""}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <ErrorLine message={save.isError ? save.error.message : null} />
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => save.mutate()} disabled={save.isPending || (selected.length === 0 && checkin.focus.length === 0)} aria-busy={save.isPending} className={primary}>
          {save.isPending ? <LoaderCircle size={18} strokeWidth={2} className="animate-spin" aria-hidden="true" /> : <Target size={18} strokeWidth={2} aria-hidden="true" />}
          {selected.length > 0 ? `${selected.length}개로 오늘 시작하기` : "고른 일 비우기"}
        </button>
        {canCancel && <button type="button" onClick={onDone} className={secondary}>취소</button>}
        <span className="text-xs text-muted">{selected.length} / {MAX_FOCUS}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 낮: 오늘의 꼭 할 일

function Today({ checkin, today, onRepick, onWrap }: { checkin: Checkin; today: string; onRepick: () => void; onWrap: () => void }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ blocks: PlacementBlock[]; unplaced: string[] } | null>(null);
  const done = checkin.focus.filter((f) => f.task.status === "completed").length;

  const findSlots = useMutation({
    mutationFn: () => getPlacement(today, userTimeZone()),
    onSuccess: setPreview,
  });
  const place = useMutation({
    mutationFn: () => createTimePlansBulk(preview!.blocks.map((b) => ({ task_id: b.task_id, starts_at: b.starts_at, ends_at: b.ends_at }))),
    onSuccess: async () => {
      setPreview(null);
      await invalidateWorkData(queryClient);
    },
  });

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Heading icon={Target} title="오늘 꼭 할 일" sub={done === checkin.focus.length ? "모두 끝냈어요! 대단해요." : `${checkin.focus.length}개 중 ${done}개 끝냈어요.`} />
        <div className="h-2 w-32 overflow-hidden rounded-full bg-pale-green" role="progressbar" aria-valuemin={0} aria-valuemax={checkin.focus.length} aria-valuenow={done} aria-label="꼭 할 일 진행">
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${(done / Math.max(1, checkin.focus.length)) * 100}%` }} />
        </div>
      </div>
      <ul className="mt-3 space-y-2">
        {checkin.focus.map((f) => (
          <li key={f.task.id} className="flex min-h-12 items-center gap-3 rounded-xl border border-border px-3 py-1.5">
            <TaskCheckbox task={f.task} onError={setError} />
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-sm font-semibold ${f.task.status === "completed" ? "text-muted line-through" : "text-primary-dark"}`}>{f.task.title}</span>
              <span className="block truncate text-xs text-muted">
                {f.task.project_path ?? "개인 업무"}
                {f.task.due_date && ` · 마감 ${formatDate(f.task.due_date)}`}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <ErrorLine message={error} />

      {preview && (
        <div className="mt-3 rounded-xl border border-violet-300 bg-violet-50/60 p-3">
          {preview.blocks.length === 0 ? (
            <p className="text-sm text-violet-900">오늘 남은 일·공부 시간에 넣을 빈칸이 없어요. 캘린더에서 직접 배치해 보세요.</p>
          ) : (
            <>
              <p className="text-sm font-semibold text-violet-900">이렇게 넣을까요?</p>
              <ul className="mt-1.5 space-y-1 text-sm text-violet-900">
                {preview.blocks.map((b) => <li key={b.task_id}>{formatClock(b.starts_at)} – {formatClock(b.ends_at)} · {b.task_title}</li>)}
              </ul>
            </>
          )}
          {preview.unplaced.length > 0 && <p className="mt-1.5 text-xs text-violet-900">빈칸이 모자라 못 넣은 일: {preview.unplaced.join(", ")}</p>}
          <ErrorLine message={place.isError ? place.error.message : null} />
          <div className="mt-2 flex gap-2">
            {preview.blocks.length > 0 && (
              <button type="button" onClick={() => place.mutate()} disabled={place.isPending} className={primary}>
                {place.isPending && <LoaderCircle size={16} strokeWidth={2} className="animate-spin" aria-hidden="true" />}
                시간표에 넣기
              </button>
            )}
            <button type="button" onClick={() => setPreview(null)} className={secondary}>닫기</button>
          </div>
        </div>
      )}
      <ErrorLine message={findSlots.isError ? findSlots.error.message : null} />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!preview && done < checkin.focus.length && (
          <button type="button" onClick={() => findSlots.mutate()} disabled={findSlots.isPending} className={secondary}>
            {findSlots.isPending ? <LoaderCircle size={16} strokeWidth={2} className="animate-spin" aria-hidden="true" /> : <CalendarPlus size={16} strokeWidth={2} aria-hidden="true" />}
            시간표 빈칸에 넣기
          </button>
        )}
        <Link href={`/calendar?view=day&date=${today}`} className={secondary}>
          <Sparkles size={16} strokeWidth={2} aria-hidden="true" />
          AI 하루 계획
        </Link>
        <button type="button" onClick={onRepick} className="min-h-11 px-2 text-sm text-muted hover:underline">다시 고르기</button>
        <button type="button" onClick={onWrap} className="ml-auto min-h-11 px-2 text-sm font-semibold text-primary hover:underline">하루 마무리하기</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 저녁: 마무리

type Choice = { outcome: "retry" | "postponed" | "kept"; due: string };

function WrapUp({ checkin, today, onDone, canCancel }: { checkin: Checkin; today: string; onDone: () => void; canCancel: boolean }) {
  const queryClient = useQueryClient();
  const tomorrow = addDays(today, 1);
  const [mood, setMood] = useState<number | null>(checkin.review?.mood ?? null);
  const [note, setNote] = useState(checkin.review?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>(() =>
    Object.fromEntries(
      checkin.focus.map((f) => [
        f.task.id,
        { outcome: f.outcome === "postponed" || f.outcome === "kept" ? f.outcome : "retry", due: f.task.due_date && f.task.due_date > today ? f.task.due_date : tomorrow },
      ]),
    ),
  );
  const open = checkin.focus.filter((f) => f.task.status !== "completed");

  const save = useMutation({
    mutationFn: () => {
      const outcomes: OutcomeInput[] = open.map((f) => {
        const c = choices[f.task.id];
        return { task_id: f.task.id, outcome: c.outcome, due_date: c.outcome === "postponed" ? c.due : null };
      });
      return saveReview(today, { mood, note: note.trim() || null, outcomes });
    },
    onSuccess: async (data) => {
      queryClient.setQueryData(checkinKeys.day(today), data);
      await invalidateWorkData(queryClient); // 마감일을 미뤘을 수 있다
      onDone();
    },
  });
  const setChoice = (id: string, patch: Partial<Choice>) => setChoices((c) => ({ ...c, [id]: { ...c[id], ...patch } }));
  const badDate = open.some((f) => choices[f.task.id]?.outcome === "postponed" && !(choices[f.task.id].due > today));

  return (
    <div>
      <Heading icon={Moon} title="하루 마무리" sub="오늘을 1분만 돌아봐요. 못 한 일은 어떻게 할지 정해 두면 내일이 가벼워져요." />
      {checkin.focus.length > 0 && (
        <ul className="mt-3 space-y-2">
          {checkin.focus.map((f) => {
            const c = choices[f.task.id];
            const completed = f.task.status === "completed";
            return (
              <li key={f.task.id} className="rounded-xl border border-border px-3 py-2">
                <div className="flex min-h-11 items-center gap-3">
                  <TaskCheckbox task={f.task} onError={setError} />
                  <span className={`min-w-0 flex-1 truncate text-sm font-semibold ${completed ? "text-muted line-through" : "text-primary-dark"}`}>{f.task.title}</span>
                  {completed && <span className="text-xs font-semibold text-primary">완료</span>}
                </div>
                {!completed && c && (
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-1" role="radiogroup" aria-label={`${f.task.title} 처리`}>
                    {([["retry", "내일 다시"], ["postponed", "마감일 미루기"], ["kept", "그대로 두기"]] as const).map(([value, label]) => (
                      <button key={value} type="button" role="radio" aria-checked={c.outcome === value} onClick={() => setChoice(f.task.id, { outcome: value })} className={`min-h-9 rounded-lg border px-2.5 text-xs font-semibold ${c.outcome === value ? "border-primary bg-pale-green text-primary-dark" : "border-border text-muted hover:bg-pale-green/40"}`}>
                        {label}
                      </button>
                    ))}
                    {c.outcome === "postponed" && (
                      <input type="date" value={c.due} min={tomorrow} onChange={(e) => setChoice(f.task.id, { due: e.target.value })} aria-label="새 마감일" className="min-h-9 rounded-lg border border-border bg-surface px-2 text-xs" />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-4 text-sm font-medium">오늘 하루는 어땠나요?</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label="오늘 기분">
        {MOODS.map((m) => (
          <button key={m.value} type="button" role="radio" aria-checked={mood === m.value} onClick={() => setMood(mood === m.value ? null : m.value)} title={m.label} className={`flex min-h-11 items-center gap-1 rounded-xl border px-2.5 text-sm ${mood === m.value ? "border-primary bg-pale-green font-semibold text-primary-dark" : "border-border text-muted hover:bg-pale-green/40"}`}>
            <span aria-hidden="true" className="text-lg">{m.emoji}</span>
            <span className="hidden sm:inline">{m.label}</span>
            <span className="sr-only sm:hidden">{m.label}</span>
          </button>
        ))}
      </div>
      <label className="mt-3 block text-sm font-medium">
        한 줄 회고 <span className="font-normal text-muted">(선택)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={REVIEW_NOTE_MAX} placeholder="예: 오전에 집중이 잘 됐다, 메일은 몰아서 보자" className="mt-1.5 block min-h-11 w-full rounded-xl border border-border bg-surface px-3.5 text-[15px] focus:border-primary focus:outline-none" />
      </label>

      <ErrorLine message={error ?? (save.isError ? save.error.message : null)} />
      {badDate && <p className="mt-2 text-xs font-semibold text-red-700" role="alert">미룰 마감일은 내일 이후로 골라 주세요.</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => save.mutate()} disabled={save.isPending || badDate} aria-busy={save.isPending} className={primary}>
          {save.isPending ? <LoaderCircle size={18} strokeWidth={2} className="animate-spin" aria-hidden="true" /> : <Moon size={18} strokeWidth={2} aria-hidden="true" />}
          마무리 저장
        </button>
        {canCancel && <button type="button" onClick={onDone} className={secondary}>취소</button>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 마무리 완료

function Done({ checkin, onEdit }: { checkin: Checkin; onEdit: () => void }) {
  const done = checkin.focus.filter((f) => f.task.status === "completed").length;
  const retry = checkin.focus.filter((f) => f.outcome === "retry").length;
  const mood = MOODS.find((m) => m.value === checkin.review?.mood);
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <Heading icon={Moon} title="오늘 마무리 완료" sub={checkin.focus.length > 0 ? `꼭 할 일 ${checkin.focus.length}개 중 ${done}개를 끝냈어요.${retry ? ` ${retry}개는 내일 다시 추천할게요.` : ""}` : "오늘 하루도 수고했어요."} />
        {(mood || checkin.review?.note) && (
          <p className="mt-2 text-sm text-foreground">
            {mood && <span className="mr-1.5" title={mood.label}>{mood.emoji}</span>}
            {checkin.review?.note}
          </p>
        )}
      </div>
      <button type="button" onClick={onEdit} className={secondary}>
        <Pencil size={16} strokeWidth={2} aria-hidden="true" />
        고치기
      </button>
    </div>
  );
}
