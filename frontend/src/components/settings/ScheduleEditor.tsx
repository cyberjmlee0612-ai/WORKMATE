"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { TimeSelect } from "@/components/common/TimeSelect";
import {
  BLOCK_KINDS, BLOCK_TITLE_MAX, MAX_BLOCKS, WEEKDAY_LABELS, getScheduleBlocks, replaceScheduleBlocks, scheduleKeys, toMinutes,
  type BlockKind, type ScheduleBlock, type ScheduleBlockInput,
} from "@/lib/api/schedule";
import { inputClass } from "./styles";

type Row = ScheduleBlockInput & { key: string };

const PRESETS: Record<BlockKind, ScheduleBlockInput> = {
  work: { title: "일하는 시간", kind: "work", weekdays: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" },
  fixed: { title: "수업", kind: "fixed", weekdays: [1, 2, 3, 4, 5], start: "09:00", end: "15:00" },
  break: { title: "점심", kind: "break", weekdays: [0, 1, 2, 3, 4, 5, 6], start: "12:00", end: "13:00" },
};
export const KIND_STYLE: Record<BlockKind, string> = {
  work: "border-l-primary",
  fixed: "border-l-sky-500",
  break: "border-l-amber-400",
};

let seq = 0;
const toRow = (b: ScheduleBlockInput): Row => ({ ...b, weekdays: [...b.weekdays], key: `r${++seq}` });
/** 저장·비교용 값만 (key·id 제외) */
const toInput = (b: ScheduleBlockInput): ScheduleBlockInput => ({ title: b.title, kind: b.kind, weekdays: b.weekdays, start: b.start, end: b.end });

function rowError(r: Row): string | null {
  if (!r.title.trim()) return "이름을 입력해 주세요.";
  if (r.weekdays.length === 0) return "요일을 하나 이상 골라 주세요.";
  if (toMinutes(r.end) - toMinutes(r.start) < 10) return "끝 시각은 시작보다 10분 이상 늦어야 해요.";
  return null;
}

/**
 * 요일별 반복 시간 편집 (2026-11-26 사용자 요청: 학교·학원 수업, 나눠 쉬는 시간도 넣을 수 있게).
 * 여러 블록을 고친 뒤 한 번에 저장한다. 블록은 서로 겹쳐도 된다 (예: 일하는 시간 안의 쉬는 시간).
 */
export function ScheduleEditor() {
  const query = useQuery({ queryKey: scheduleKeys.all, queryFn: getScheduleBlocks });
  if (query.isError) return <p className="text-sm text-red-700" role="alert">{query.error.message}</p>;
  if (!query.data) return <div className="h-40 animate-pulse rounded-xl bg-pale-green/40" />;
  return <Editor initial={query.data} />;
}

function Editor({ initial }: { initial: ScheduleBlock[] }) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Row[]>(() => initial.map(toRow));
  const [showErrors, setShowErrors] = useState(false);
  const [done, setDone] = useState(false);

  const save = useMutation({
    mutationFn: () => replaceScheduleBlocks(rows.map((r) => ({ ...toInput(r), title: r.title.trim() }))),
    onSuccess: (saved) => {
      queryClient.setQueryData(scheduleKeys.all, saved);
      setRows(saved.map(toRow));
      setDone(true);
      setShowErrors(false);
    },
  });

  const update = (key: string, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDone(false);
  };
  const add = (kind: BlockKind) => {
    setRows((rs) => [...rs, toRow(PRESETS[kind])]);
    setDone(false);
  };
  const remove = (key: string) => {
    setRows((rs) => rs.filter((r) => r.key !== key));
    setDone(false);
  };
  const toggleDay = (r: Row, day: number) =>
    update(r.key, { weekdays: r.weekdays.includes(day) ? r.weekdays.filter((d) => d !== day) : [...r.weekdays, day].sort() });

  const hasErrors = rows.some((r) => rowError(r) !== null);
  const changed = JSON.stringify(rows.map(toInput)) !== JSON.stringify(initial.map(toInput));

  return (
    <div>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-soft-sage px-4 py-5 text-center text-sm text-muted">
          아직 정한 시간이 없어요. AI 하루 계획은 09:00–18:00(점심 12:00–13:00)을 기본으로 써요.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const error = showErrors ? rowError(r) : null;
            return (
              <li key={r.key} className={`rounded-xl border border-l-4 border-border p-3 ${KIND_STYLE[r.kind]}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={r.title}
                    onChange={(e) => update(r.key, { title: e.target.value })}
                    maxLength={BLOCK_TITLE_MAX}
                    aria-label="이름"
                    placeholder="예: 수학 학원"
                    className={`${inputClass(Boolean(error) && !r.title.trim())} !mt-0 min-w-0 flex-1 basis-40`}
                  />
                  <select value={r.kind} onChange={(e) => update(r.key, { kind: e.target.value as BlockKind })} aria-label="종류" className="min-h-11 rounded-xl border border-border bg-surface px-2 text-sm">
                    {BLOCK_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                  </select>
                  <button type="button" onClick={() => remove(r.key)} className="flex size-11 items-center justify-center rounded-xl text-muted hover:bg-red-50 hover:text-red-700" aria-label={`${r.title || "블록"} 삭제`}>
                    <Trash2 size={18} strokeWidth={2} aria-hidden="true" />
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1" role="group" aria-label="반복 요일">
                  {WEEKDAY_LABELS.map((label, day) => {
                    const on = r.weekdays.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleDay(r, day)}
                        className={`size-9 rounded-lg text-sm font-semibold ${on ? "bg-primary text-white" : "border border-border bg-surface text-muted hover:bg-pale-green"} ${day === 0 && !on ? "text-red-700" : ""}`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <TimeSelect label="시작" value={r.start} onChange={(v) => update(r.key, { start: v })} />
                  <span className="text-muted" aria-hidden="true">–</span>
                  <TimeSelect label="끝" value={r.end} onChange={(v) => update(r.key, { end: v })} allow24 invalid={Boolean(error) && toMinutes(r.end) - toMinutes(r.start) < 10} />
                  <span className="text-xs text-muted">{BLOCK_KINDS.find((k) => k.value === r.kind)?.hint}</span>
                </div>
                {error && <p className="mt-2 text-xs font-semibold text-red-700" role="alert">{error}</p>}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {BLOCK_KINDS.map((k) => (
          <button key={k.value} type="button" onClick={() => add(k.value)} disabled={rows.length >= MAX_BLOCKS} className="flex min-h-11 items-center gap-1.5 rounded-xl border border-border bg-surface px-3 text-sm font-semibold text-primary-dark hover:bg-pale-green disabled:opacity-60">
            <Plus size={16} strokeWidth={2} aria-hidden="true" />
            {k.label}
          </button>
        ))}
      </div>

      {save.isError && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800" role="alert">
          <CircleAlert size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
          {save.error.message}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            if (hasErrors) return setShowErrors(true);
            save.mutate();
          }}
          disabled={save.isPending || !changed}
          aria-busy={save.isPending}
          className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-60"
        >
          {save.isPending && <LoaderCircle size={18} strokeWidth={2} className="animate-spin" aria-hidden="true" />}
          {save.isPending ? "저장 중…" : "시간표 저장"}
        </button>
        {changed && !save.isPending && (
          <button type="button" onClick={() => { setRows(initial.map(toRow)); setShowErrors(false); }} className="min-h-11 text-sm text-muted underline-offset-2 hover:underline">
            되돌리기
          </button>
        )}
        {done && !changed && <span className="flex items-center gap-1.5 text-sm font-semibold text-primary" role="status"><CircleCheck size={16} strokeWidth={2} aria-hidden="true" />저장했어요</span>}
        {showErrors && hasErrors && <span className="text-sm font-semibold text-red-700" role="alert">고칠 곳이 있어요.</span>}
      </div>
    </div>
  );
}
