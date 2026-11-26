"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Clock, LoaderCircle, Pencil, Plus, Timer, Trash2, X } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { invalidateWorkData } from "@/lib/api/invalidate";
import type { Task } from "@/lib/api/tasks";
import {
  NOTE_MAX, createTimeEntry, deleteTimeEntry, listTimeEntries, overlapConflict, timeKeys, updateTimeEntry,
  type TimeEntry, type TimeEntryUpdateInput,
} from "@/lib/api/time";
import { toLocalDateString } from "@/lib/date";
import { formatMinutes } from "@/lib/format";
import { entryMinutes, formatDay, formatRange, fromLocalInputs, toTimeInput } from "@/lib/time";

type Props = { task: Task; onClose: () => void };

/** 업무 하나의 시간 기록 목록 + 직접 입력·수정·삭제. 열 때마다 새로 마운트해서 사용한다. */
export function TimeEntriesDialog({ task, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [editing, setEditing] = useState<TimeEntry | "new" | null>(null);
  const [busy, setBusy] = useState(false); // 폼·삭제 저장 중에는 창을 닫지 않는다
  const query = useQuery({ queryKey: timeKeys.entries({ task_id: task.id }), queryFn: () => listTimeEntries({ task_id: task.id }) });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  function requestClose() {
    if (!busy) onClose();
  }

  const entries = query.data ?? [];
  const total = entries.reduce((sum, e) => (e.ended_at ? sum + entryMinutes(e.started_at, e.ended_at) : sum), 0);
  const estimated = formatMinutes(task.estimated_minutes);

  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) requestClose();
      }}
      aria-labelledby={`${id}-title`}
      className="surface-card m-auto w-[calc(100%-2rem)] max-w-lg rounded-[20px] p-0 text-foreground backdrop:bg-primary-dark/30"
    >
      <div className="max-h-[85vh] overflow-y-auto p-5 md:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={`${id}-title`} className="text-xl font-bold text-primary-dark">시간 기록</h2>
            <p className="mt-1 break-words text-sm font-medium text-foreground">“{task.title}”</p>
          </div>
          <button type="button" onClick={requestClose} disabled={busy} className="-mr-2 -mt-1 flex size-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-pale-green hover:text-primary-dark" aria-label="닫기">
            <X size={20} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-pale-green/60 px-4 py-3">
            <dt className="text-xs text-muted">실제 기록</dt>
            <dd className="mt-1 font-geist text-lg font-bold text-primary-dark">{formatMinutes(total) ?? "0분"}</dd>
          </div>
          <div className="rounded-xl border border-border px-4 py-3">
            <dt className="text-xs text-muted">예상 시간</dt>
            <dd className="mt-1 font-geist text-lg font-bold text-foreground">{estimated ?? "미정"}</dd>
          </div>
        </dl>

        {editing ? (
          <EntryForm
            key={editing === "new" ? "new" : editing.id}
            task={task}
            entry={editing === "new" ? null : editing}
            onBusy={setBusy}
            onDone={() => setEditing(null)}
          />
        ) : (
          <button type="button" onClick={() => setEditing("new")} className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-soft-sage text-sm font-semibold text-primary-dark hover:bg-pale-green">
            <Plus size={18} strokeWidth={2} aria-hidden="true" />
            직접 기록 추가
          </button>
        )}

        <div className="mt-5">
          {query.isPending ? (
            <div className="space-y-2" aria-busy="true" aria-label="불러오는 중">
              {[0, 1].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-pale-green/40" />)}
            </div>
          ) : query.isError ? (
            <p className="flex items-center gap-2 text-sm text-red-700" role="alert">
              <CircleAlert size={16} strokeWidth={2} aria-hidden="true" />
              기록을 불러오지 못했습니다.
              <button type="button" onClick={() => query.refetch()} className="font-semibold underline">다시 시도</button>
            </p>
          ) : entries.length === 0 ? (
            <p className="rounded-xl bg-background px-4 py-6 text-center text-sm text-muted">아직 기록이 없어요. ▶ 버튼으로 타이머를 켜거나 직접 추가해 보세요.</p>
          ) : (
            <ul className="divide-y divide-border">
              {entries.map((entry) => (
                <EntryRow key={entry.id} entry={entry} editing={editing !== null} onEdit={() => setEditing(entry)} onBusy={setBusy} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </dialog>
  );
}

function EntryRow({ entry, editing, onEdit, onBusy }: { entry: TimeEntry; editing: boolean; onEdit: () => void; onBusy: (busy: boolean) => void }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const minutes = entry.ended_at ? formatMinutes(entryMinutes(entry.started_at, entry.ended_at)) ?? "1분 미만" : null;

  const mutation = useMutation({
    mutationFn: async () => {
      try {
        await deleteTimeEntry(entry.id);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return; // 이미 삭제됨 → 결과가 같다
        throw error;
      }
    },
    onMutate: () => onBusy(true),
    onSettled: () => onBusy(false),
    onSuccess: () => invalidateWorkData(queryClient),
  });

  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-pale-green text-primary-dark" title={entry.source === "timer" ? "타이머 기록" : "직접 입력"}>
          {entry.source === "timer" ? <Timer size={15} strokeWidth={2} aria-hidden="true" /> : <Clock size={15} strokeWidth={2} aria-hidden="true" />}
          <span className="sr-only">{entry.source === "timer" ? "타이머 기록" : "직접 입력"}</span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            {formatDay(entry.started_at)} <span className="text-muted">·</span> {formatRange(entry.started_at, entry.ended_at)}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {minutes ?? <span className="font-semibold text-primary">진행 중</span>}
            {entry.note && <> · <span className="break-words">{entry.note}</span></>}
          </p>
        </div>
        {!confirming && (
          <div className="flex shrink-0">
            <button type="button" onClick={onEdit} disabled={editing} className="flex size-11 items-center justify-center rounded-xl text-muted hover:bg-pale-green hover:text-primary-dark disabled:opacity-40" aria-label="기록 수정" title="수정">
              <Pencil size={16} strokeWidth={2} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => setConfirming(true)} className="flex size-11 items-center justify-center rounded-xl text-muted hover:bg-red-50 hover:text-red-700" aria-label="기록 삭제" title="삭제">
              <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      {confirming && (
        <div className="mt-2 flex flex-wrap items-center justify-end gap-2 rounded-xl bg-red-50 px-3 py-2" role="group" aria-label="기록 삭제 확인">
          <span className="mr-auto text-sm text-red-800">{entry.ended_at ? "이 기록을 삭제할까요?" : "진행 중인 타이머를 기록 없이 삭제할까요?"}</span>
          <button type="button" autoFocus onClick={() => setConfirming(false)} disabled={mutation.isPending} className="min-h-11 rounded-xl border border-border bg-surface px-3 text-sm font-semibold text-primary-dark">취소</button>
          <button type="button" onClick={() => !mutation.isPending && mutation.mutate()} disabled={mutation.isPending} aria-busy={mutation.isPending} className="flex min-h-11 items-center gap-1.5 rounded-xl bg-red-700 px-3 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-75">
            {mutation.isPending && <LoaderCircle size={16} strokeWidth={2} className="animate-spin" aria-hidden="true" />}
            삭제
          </button>
          {mutation.isError && <p className="w-full text-xs text-red-700" role="alert">삭제하지 못했습니다. 다시 시도해 주세요.</p>}
        </div>
      )}
    </li>
  );
}

type FormErrors = Partial<Record<"started_at" | "ended_at" | "note" | "_form", string>>;

function EntryForm({ task, entry, onBusy, onDone }: { task: Task; entry: TimeEntry | null; onBusy: (busy: boolean) => void; onDone: () => void }) {
  const queryClient = useQueryClient();
  const formId = useId();
  const running = entry !== null && entry.ended_at === null;

  const [fields, setFields] = useState(() => {
    if (!entry) return { date: toLocalDateString(new Date()), start: "", end: "", note: "" };
    const start = new Date(entry.started_at);
    return {
      date: toLocalDateString(start),
      start: toTimeInput(start),
      end: entry.ended_at ? toTimeInput(new Date(entry.ended_at)) : "",
      note: entry.note ?? "",
    };
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const update = (key: keyof typeof fields, value: string) => setFields((f) => ({ ...f, [key]: value }));

  const mutation = useMutation({
    mutationFn: (payload: TimeEntryUpdateInput) =>
      entry
        ? updateTimeEntry(entry.id, payload)
        : createTimeEntry({ task_id: task.id, started_at: payload.started_at!, ended_at: payload.ended_at!, note: payload.note ?? null }),
    onMutate: () => onBusy(true),
    onSettled: () => onBusy(false),
    onSuccess: () => {
      invalidateWorkData(queryClient);
      onDone();
    },
    onError: (err) => {
      if (!(err instanceof ApiError)) {
        setErrors({ _form: "저장하지 못했습니다. 다시 시도해 주세요." });
        return;
      }
      const conflict = overlapConflict(err.body);
      if (conflict) {
        setErrors({ _form: `‘${conflict.task_title}’ 기록(${formatDay(conflict.started_at)} ${formatRange(conflict.started_at, conflict.ended_at)})과 시간이 겹쳐요.` });
        return;
      }
      if (err.status === 404 || err.status === 409) invalidateWorkData(queryClient);
      setErrors(Object.keys(err.fieldErrors).length > 0 ? (err.fieldErrors as FormErrors) : { _form: err.message });
    },
  });
  const pending = mutation.isPending;

  // 끝 시각이 시작 시각보다 이르면 자정을 넘긴 기록으로 본다 (예: 23:00 – 01:00)
  const overnight = !running && fields.start !== "" && fields.end !== "" && fields.end < fields.start;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    const next: FormErrors = {};
    const start = fromLocalInputs(fields.date, fields.start);
    if (!start) next.started_at = "날짜와 시작 시각을 입력해 주세요.";
    let end: Date | null = null;
    if (!running) {
      end = fromLocalInputs(fields.date, fields.end);
      if (!end) next.ended_at = "끝난 시각을 입력해 주세요.";
      else if (fields.end === fields.start) next.ended_at = "끝난 시각이 시작 시각과 같아요.";
      else if (overnight) end = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1, end.getHours(), end.getMinutes());
    }
    if (fields.note.trim().length > NOTE_MAX) next.note = `메모는 ${NOTE_MAX}자 이하로 입력해 주세요.`;
    setErrors(next);
    if (Object.keys(next).length > 0 || !start) return;

    const payload: TimeEntryUpdateInput = { started_at: start.toISOString(), note: fields.note.trim() || null };
    if (end) payload.ended_at = end.toISOString();
    mutation.mutate(payload);
  }

  const inputClass = (invalid: boolean) =>
    `mt-1.5 block min-h-11 w-full rounded-xl border bg-surface px-3 text-[15px] text-foreground focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 disabled:opacity-60 ${invalid ? "border-red-400" : "border-border focus:border-primary"}`;
  const errorText = (key: keyof FormErrors) =>
    errors[key] ? (
      <span id={`${formId}-${key}`} className="mt-1 flex items-center gap-1 text-xs text-red-700">
        <CircleAlert size={14} strokeWidth={2} aria-hidden="true" />
        {errors[key]}
      </span>
    ) : null;
  const a11y = (key: keyof FormErrors) => ({
    "aria-invalid": Boolean(errors[key]) || undefined,
    "aria-describedby": errors[key] ? `${formId}-${key}` : undefined,
  });

  return (
    <form onSubmit={submit} noValidate className="mt-4 rounded-2xl border border-soft-sage bg-pale-green/30 p-4" aria-label={entry ? "기록 수정" : "직접 기록 추가"}>
      <p className="text-sm font-semibold text-primary-dark">{entry ? (running ? "진행 중인 타이머 수정" : "기록 수정") : "직접 기록 추가"}</p>
      <fieldset disabled={pending} className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="col-span-2 block text-sm font-medium sm:col-span-1">
          날짜
          <input type="date" value={fields.date} onChange={(e) => update("date", e.target.value)} className={inputClass(Boolean(errors.started_at))} />
        </label>
        <label className="block text-sm font-medium">
          시작
          <input type="time" value={fields.start} onChange={(e) => update("start", e.target.value)} className={inputClass(Boolean(errors.started_at))} {...a11y("started_at")} />
        </label>
        <label className="block text-sm font-medium">
          끝
          {running ? (
            <span className="mt-1.5 flex min-h-11 items-center rounded-xl border border-border bg-background px-3 text-sm text-muted">진행 중</span>
          ) : (
            <input type="time" value={fields.end} onChange={(e) => update("end", e.target.value)} className={inputClass(Boolean(errors.ended_at))} {...a11y("ended_at")} />
          )}
        </label>
        <div className="col-span-2 -mt-1 sm:col-span-3">
          {errorText("started_at")}
          {errorText("ended_at")}
          {overnight && !errors.ended_at && <p className="text-xs text-muted">끝 시각이 시작보다 이르면 다음 날 {fields.end}까지로 기록해요.</p>}
          {running && <p className="text-xs text-muted">끝내려면 상단 타이머의 ‘멈춤’을 눌러 주세요.</p>}
        </div>
        <label className="col-span-2 block text-sm font-medium sm:col-span-3">
          메모 <span className="font-normal text-muted">(선택)</span>
          <input value={fields.note} onChange={(e) => update("note", e.target.value)} maxLength={NOTE_MAX} className={inputClass(Boolean(errors.note))} placeholder="예: 회의 자료 정리" {...a11y("note")} />
          {errorText("note")}
        </label>
      </fieldset>

      {errors._form && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800" role="alert">
          <CircleAlert size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
          {errors._form}
        </p>
      )}

      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onDone} disabled={pending} className="min-h-11 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-primary-dark hover:bg-pale-green disabled:opacity-60">
          취소
        </button>
        <button type="submit" disabled={pending} aria-busy={pending} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-75">
          {pending && <LoaderCircle size={18} strokeWidth={2} className="animate-spin" aria-hidden="true" />}
          {pending ? "저장 중…" : "저장"}
        </button>
      </div>
    </form>
  );
}
