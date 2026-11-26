"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { CircleAlert, Info, LoaderCircle, Plus, ShieldAlert, Sparkles, X } from "lucide-react";
import { TimeSelect } from "@/components/common/TimeSelect";
import { ApiError } from "@/lib/api/client";
import { aiKeys, requestDayPlan, type DayPlanBlock, type DayPlanResult } from "@/lib/api/ai";
import { invalidateWorkData } from "@/lib/api/invalidate";
import { DEFAULT_BLOCKED, DEFAULT_WINDOWS, getScheduleBlocks, scheduleKeys, toMinutes, type ScheduleBlock } from "@/lib/api/schedule";
import { createTimePlansBulk } from "@/lib/api/time";
import { toLocalDateString, userTimeZone } from "@/lib/date";
import { fromLocalInputs, toTimeInput } from "@/lib/time";
import type { Ghost } from "./TimeGrid";

/**
 * 일·공부 시간과 피할 시간(수업·고정 일정·쉬는 시간)은 설정의 요일별 반복 블록으로 미리 채운다.
 * 블록을 하나도 정하지 않았으면 09:00–18:00, 점심 12:00–13:00. 패널에서 고친 값은 이번 요청에만 쓴다.
 */
type Range = { key: string; start: string; end: string; label: string };
type Ranges = { windows: Range[]; blocked: Range[] };
let rangeSeq = 0;
const toRange = (r: { start: string; end: string; label?: string }): Range => ({ key: `g${++rangeSeq}`, start: r.start, end: r.end, label: r.label ?? "" });

function rangesFor(blocks: ScheduleBlock[] | undefined, date: string): Ranges {
  if (!blocks || blocks.length === 0) return { windows: DEFAULT_WINDOWS.map(toRange), blocked: DEFAULT_BLOCKED.map(toRange) };
  const weekday = (fromLocalInputs(date, "00:00") ?? new Date()).getDay();
  const ofDay = blocks.filter((b) => b.weekdays.includes(weekday));
  return {
    windows: ofDay.filter((b) => b.kind === "work").map((b) => toRange({ start: b.start, end: b.end, label: b.title })),
    blocked: ofDay.filter((b) => b.kind !== "work").map((b) => toRange({ start: b.start, end: b.end, label: b.title })),
  };
}

type Row = DayPlanBlock & { key: string; include: boolean; start: string; end: string };

type Props = {
  initialDate: Date;
  /** 고른 제안을 시간표에 미리보기로 보여준다 */
  onPreview: (ghosts: Ghost[]) => void;
  onDateChange: (date: Date) => void;
  onDone: (message: string) => void;
  onClose: () => void;
};

/**
 * AI 하루 계획 제안 옆 패널 (기획서 3-4). 제안은 시간표에 미리보기로만 보이고,
 * 고르고 시각을 고친 것만 '시간표에 넣기'로 계획 블록이 된다. 시간표가 보이도록 모달이 아닌 옆 패널.
 */
export function DayPlanPanel({ initialDate, onPreview, onDateChange, onDone, onClose }: Props) {
  const queryClient = useQueryClient();
  const blocksQuery = useQuery({ queryKey: scheduleKeys.all, queryFn: getScheduleBlocks });
  const [date, setDate] = useState(() => toLocalDateString(initialDate));
  const [note, setNote] = useState("");
  const [summary, setSummary] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [rowError, setRowError] = useState<string | null>(null);
  const [tz] = useState(userTimeZone);
  // 고친 시간대는 고친 날짜에만 쓴다 (날짜를 바꾸면 그 요일의 기본값으로)
  const [edited, setEdited] = useState<(Ranges & { date: string }) | null>(null);
  const ranges: Ranges = edited?.date === date ? edited : rangesFor(blocksQuery.data, date);
  const editRanges = (fn: (r: Ranges) => Ranges) => setEdited({ ...fn(ranges), date });
  const rangeInvalid = [...ranges.windows, ...ranges.blocked].some((r) => toMinutes(r.end) <= toMinutes(r.start));

  const suggest = useMutation({
    mutationFn: () =>
      requestDayPlan({
        date,
        tz,
        windows: ranges.windows.map(({ start, end }) => ({ start, end })),
        blocked: ranges.blocked.map(({ start, end, label }) => ({ start, end, label: label.slice(0, 40) })),
        note: note.trim() || null,
      }),
    onSuccess: (result: DayPlanResult) => {
      setSummary(result.summary);
      setRowError(null);
      setRows(
        result.blocks.map((b, i) => ({
          ...b,
          key: `${i}-${b.task_id}`,
          include: true,
          start: toTimeInput(new Date(b.starts_at)),
          end: toTimeInput(new Date(b.ends_at)),
        })),
      );
      queryClient.setQueryData(aiKeys.usage(tz), result.usage);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: aiKeys.usage(tz) }),
  });

  // 고른 행 → 시각 계산 (잘못된 시각은 null)
  const chosen = rows
    .filter((r) => r.include)
    .map((r) => {
      const s = fromLocalInputs(date, r.start);
      const e = fromLocalInputs(date, r.end);
      return { row: r, start: s, end: e, valid: Boolean(s && e && e.getTime() - s.getTime() >= 10 * 60_000) };
    });

  // 미리보기는 고른 행이 바뀔 때마다 위로 알린다
  const previewKey = chosen.map((c) => `${c.row.key}:${c.row.start}-${c.row.end}`).join("|");
  const onPreviewRef = useRef(onPreview);
  useEffect(() => {
    onPreviewRef.current = onPreview;
  });
  useEffect(() => {
    onPreviewRef.current(
      chosen.filter((c) => c.valid).map((c) => ({ startMs: c.start!.getTime(), endMs: c.end!.getTime(), label: `AI · ${c.row.task_title}` })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- previewKey가 chosen의 내용을 대표한다
  }, [previewKey]);
  useEffect(() => () => onPreviewRef.current([]), []);

  const save = useMutation({
    mutationFn: () =>
      createTimePlansBulk(chosen.map((c) => ({ task_id: c.row.task_id, starts_at: c.start!.toISOString(), ends_at: c.end!.toISOString() }))),
    onSuccess: async (saved) => {
      await invalidateWorkData(queryClient);
      onDone(`AI가 제안한 계획 ${saved.length}개를 시간표에 넣었어요.`);
    },
  });

  function submitSave() {
    if (save.isPending || chosen.length === 0) return;
    if (chosen.some((c) => !c.valid)) {
      setRowError("시각을 확인해 주세요. 끝은 시작보다 10분 이상 늦어야 해요.");
      return;
    }
    setRowError(null);
    save.mutate();
  }

  const errorOf = (err: unknown) => (err instanceof ApiError ? (Object.values(err.fieldErrors)[0] ?? err.message) : err ? "처리하지 못했습니다. 잠시 후 다시 시도해 주세요." : null);
  const suggestError = errorOf(suggest.error);
  const saveError = errorOf(save.error);
  const timeInput = "block min-h-11 w-full rounded-xl border border-border bg-surface px-2 text-sm focus:border-primary focus:outline-none";

  return (
    <aside
      aria-label="AI 하루 계획"
      className="fixed inset-x-0 bottom-0 z-50 flex max-h-[80dvh] flex-col rounded-t-[20px] border border-border bg-surface shadow-2xl md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[26rem] md:rounded-none md:rounded-l-[20px]"
    >
      <div className="flex items-start justify-between gap-2 border-b border-border p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-primary-dark">
            <Sparkles size={18} strokeWidth={2} aria-hidden="true" />
            AI 하루 계획
          </h2>
          <p className="mt-0.5 text-xs text-muted">남은 업무로 시간표 배치를 제안해요. 고른 것만 저장돼요.</p>
        </div>
        <button type="button" onClick={onClose} disabled={save.isPending} className="-mr-1 flex size-11 items-center justify-center rounded-xl text-muted hover:bg-pale-green" aria-label="닫기">
          <X size={20} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <fieldset disabled={suggest.isPending || save.isPending} className="space-y-3">
          <label className="block text-sm font-medium">
            날짜
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setRows([]);
                setSummary(null);
                const d = fromLocalInputs(e.target.value, "00:00");
                if (d) onDateChange(d);
              }}
              className={`mt-1.5 ${timeInput} px-3`}
            />
          </label>
          <RangeList
            title="일·공부 시간"
            hint="AI가 이 시간 안에만 업무를 넣어요"
            items={ranges.windows}
            onChange={(windows) => editRanges((r) => ({ ...r, windows }))}
            addLabel="일·공부 시간 추가"
            empty="이 날은 일·공부 시간이 없어요. 추가해 주세요."
          />
          <RangeList
            title="피할 시간"
            hint="수업·고정 일정·쉬는 시간"
            items={ranges.blocked}
            onChange={(blocked) => editRanges((r) => ({ ...r, blocked }))}
            addLabel="피할 시간 추가"
            empty="피할 시간이 없어요."
          />
          <div className="flex flex-wrap items-center gap-x-3 text-xs">
            <Link href="/settings" className="min-h-11 content-center font-semibold text-primary underline-offset-2 hover:underline">요일별 시간표 설정하기</Link>
            {edited?.date === date && (
              <button type="button" onClick={() => setEdited(null)} className="min-h-11 text-muted underline-offset-2 hover:underline">시간표대로 되돌리기</button>
            )}
          </div>
          <label className="block text-sm font-medium">
            요청 메모 <span className="font-normal text-muted">(선택)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="예: 오후 3시 이후엔 가벼운 일만" className={`mt-1.5 ${timeInput} px-3`} />
          </label>
        </fieldset>

        <button
          type="button"
          onClick={() => !suggest.isPending && suggest.mutate()}
          disabled={suggest.isPending || save.isPending || ranges.windows.length === 0 || rangeInvalid}
          aria-busy={suggest.isPending}
          className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-60"
        >
          {suggest.isPending ? <LoaderCircle size={18} strokeWidth={2} className="animate-spin" aria-hidden="true" /> : <Sparkles size={18} strokeWidth={2} aria-hidden="true" />}
          {suggest.isPending ? "AI가 계획을 짜는 중…" : rows.length > 0 ? "다시 제안받기" : "계획 제안받기"}
        </button>
        {rangeInvalid && <p className="mt-2 text-xs font-semibold text-red-700" role="alert">끝 시각이 시작보다 늦어야 해요.</p>}
        {suggestError && (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800" role="alert">
            <CircleAlert size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
            {suggestError}
          </p>
        )}

        {summary && (
          <p className="mt-4 flex items-start gap-2 rounded-xl bg-pale-green/60 px-3 py-2.5 text-sm text-primary-dark">
            <Info size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
            {summary}
          </p>
        )}
        {rows.length > 0 && (
          <ul className="mt-3 space-y-2">
            {rows.map((r) => (
              <li key={r.key} className={`rounded-xl border p-2.5 ${r.include ? "border-primary/40 bg-surface" : "border-border bg-background opacity-60"}`}>
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    checked={r.include}
                    onChange={(e) => setRows((cur) => cur.map((x) => (x.key === r.key ? { ...x, include: e.target.checked } : x)))}
                    className="mt-0.5 size-4 shrink-0 accent-[var(--color-primary)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-sm font-semibold text-foreground">{r.task_title}</span>
                    <span className="block truncate text-xs text-muted">{r.project_path ?? "개인 업무"}</span>
                  </span>
                </label>
                <div className="mt-2 flex flex-wrap items-center gap-1 pl-6">
                  <TimeSelect label={`${r.task_title} 시작`} value={r.start} disabled={!r.include} onChange={(v) => setRows((cur) => cur.map((x) => (x.key === r.key ? { ...x, start: v } : x)))} />
                  <span className="text-muted" aria-hidden="true">–</span>
                  <TimeSelect label={`${r.task_title} 끝`} value={r.end} disabled={!r.include} onChange={(v) => setRows((cur) => cur.map((x) => (x.key === r.key ? { ...x, end: v } : x)))} />
                </div>
                {r.reason && <p className="mt-1.5 pl-6 text-xs leading-5 text-muted">{r.reason}</p>}
              </li>
            ))}
          </ul>
        )}

        <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-muted">
          <ShieldAlert size={14} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
          업무 제목·프로젝트 이름과 그날 일정이 Google Gemini API로 전송돼요. 무료 등급에서는 서비스 개선에 쓰일 수 있어요.
        </p>
      </div>

      {rows.length > 0 && (
        <div className="border-t border-border p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {(rowError || saveError) && (
            <p className="mb-2 flex items-center gap-1 text-xs text-red-700" role="alert">
              <CircleAlert size={14} strokeWidth={2} aria-hidden="true" />
              {rowError ?? saveError}
            </p>
          )}
          <button
            type="button"
            onClick={submitSave}
            disabled={chosen.length === 0 || save.isPending}
            aria-busy={save.isPending}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {save.isPending && <LoaderCircle size={16} strokeWidth={2} className="animate-spin" aria-hidden="true" />}
            선택한 {chosen.length}개 시간표에 넣기
          </button>
        </div>
      )}
    </aside>
  );
}

/** 시간 구간 목록 (이번 요청에만 쓰는 값) */
function RangeList({ title, hint, items, onChange, addLabel, empty }: {
  title: string; hint: string; items: Range[]; onChange: (items: Range[]) => void; addLabel: string; empty: string;
}) {
  const update = (key: string, patch: Partial<Range>) => onChange(items.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <div className="rounded-xl border border-border p-3">
      <p className="text-sm font-medium">{title} <span className="text-xs font-normal text-muted">· {hint}</span></p>
      {items.length === 0 ? (
        <p className="mt-1.5 text-xs text-muted">{empty}</p>
      ) : (
        <ul className="mt-1.5 space-y-1.5">
          {items.map((r) => (
            <li key={r.key} className="flex flex-wrap items-center gap-1">
              <TimeSelect label={`${r.label || title} 시작`} value={r.start} onChange={(v) => update(r.key, { start: v })} />
              <span className="text-muted" aria-hidden="true">–</span>
              <TimeSelect label={`${r.label || title} 끝`} value={r.end} onChange={(v) => update(r.key, { end: v })} allow24 invalid={toMinutes(r.end) <= toMinutes(r.start)} />
              {r.label && <span className="max-w-24 truncate text-xs text-muted" title={r.label}>{r.label}</span>}
              <button type="button" onClick={() => onChange(items.filter((x) => x.key !== r.key))} className="ml-auto flex size-9 items-center justify-center rounded-lg text-muted hover:bg-red-50 hover:text-red-700" aria-label={`${r.label || title} ${r.start} 빼기`}>
                <X size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={() => onChange([...items, toRange({ start: "13:00", end: "14:00" })])} className="mt-1 flex min-h-11 items-center gap-1 text-xs font-semibold text-primary hover:underline">
        <Plus size={14} strokeWidth={2} aria-hidden="true" />
        {addLabel}
      </button>
    </div>
  );
}
