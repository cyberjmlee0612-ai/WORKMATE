"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CircleAlert, CircleCheck, FolderPlus, Info, LoaderCircle, Plus, RotateCcw, ShieldAlert, Sparkles, X } from "lucide-react";
import { ApiError } from "@/lib/api/client";
import { AI_TEXT_MAX, BULK_CREATE_MAX, aiKeys, createTasksBulk, getAiUsage, requestBreakdown, type BreakdownResult } from "@/lib/api/ai";
import { invalidateWorkData } from "@/lib/api/invalidate";
import { listProjects, projectKeys } from "@/lib/api/projects";
import { ESTIMATED_MINUTES_MAX, TASK_PRIORITIES, TASK_PRIORITY_LABEL, type TaskInput, type TaskPriority } from "@/lib/api/tasks";
import { userTimeZone } from "@/lib/date";
import { activeProjectOptions } from "@/lib/projectTree";
import { EstimateHint } from "@/components/tasks/EstimateHint";

type Row = {
  key: string;
  include: boolean;
  title: string;
  priority: TaskPriority;
  minutes: string;
  due: string;
  description: string;
};
type RowErrors = Partial<Record<"title" | "estimated_minutes" | "due_date" | "description", string>>;

const CLOSED_PROJECT = new Set(["completed", "archived"]);
/** 저장할 곳 선택값: "" = 개인 업무, NEW = 새 프로젝트 만들기, 그 밖 = 기존 프로젝트 ID */
const NEW = "__new__";
let rowSeq = 0;

const blankRow = (): Row => ({ key: `r${++rowSeq}`, include: true, title: "", priority: "medium", minutes: "", due: "", description: "" });

function toRows(result: BreakdownResult): Row[] {
  return result.tasks.map((t) => ({
    key: `r${++rowSeq}`,
    include: true,
    title: t.title,
    priority: t.priority,
    minutes: t.estimated_minutes ? String(t.estimated_minutes) : "",
    due: t.due_date ?? "",
    description: t.description ?? "",
  }));
}

/**
 * AI 업무 도우미: 자연어 → 세부 업무 제안 → 사용자가 고치고 골라서 저장.
 * 원칙(기획서·PRD): AI 제안은 승인 전에는 절대 저장하지 않는다.
 */
export function AssistantView() {
  const queryClient = useQueryClient();
  const formId = useId();
  const [tz] = useState(() => (typeof window === "undefined" ? "UTC" : userTimeZone()));
  const [text, setText] = useState("");
  const [destination, setDestination] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectError, setNewProjectError] = useState<string | null>(null);
  const [suggestedName, setSuggestedName] = useState("");
  const [summary, setSummary] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [rowErrors, setRowErrors] = useState<Record<string, RowErrors>>({});
  const [saved, setSaved] = useState<{ count: number; projectId: string | null } | null>(null);

  const usageQuery = useQuery({ queryKey: aiKeys.usage(tz), queryFn: () => getAiUsage(tz) });
  const projectsQuery = useQuery({ queryKey: projectKeys.list(), queryFn: listProjects });
  const projects = (projectsQuery.data ?? []).filter((p) => !CLOSED_PROJECT.has(p.status));
  const usage = usageQuery.data;
  // 기존 프로젝트를 골랐을 때만 AI가 그 프로젝트 정보·업무를 참고한다
  const projectId = destination && destination !== NEW ? destination : "";

  const suggest = useMutation({
    mutationFn: () => requestBreakdown({ text: text.trim(), project_id: projectId || null, tz }),
    onMutate: () => setSaved(null),
    onSuccess: (result) => {
      setSummary(result.summary);
      setRows(toRows(result));
      setRowErrors({});
      setSuggestedName(result.project_name);
      if (!newProjectName.trim() && result.project_name) setNewProjectName(result.project_name);
      queryClient.setQueryData(aiKeys.usage(tz), result.usage);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: aiKeys.usage(tz) }),
  });

  const selected = rows.filter((r) => r.include);

  const save = useMutation({
    mutationFn: (payload: { tasks: TaskInput[]; keys: string[]; newProject?: { name: string } }) => createTasksBulk(payload.tasks, payload.newProject),
    onSuccess: async (created) => {
      await invalidateWorkData(queryClient);
      const savedProject = created[0]?.project_id ?? null;
      setSaved({ count: created.length, projectId: savedProject });
      // 새로 만든 프로젝트는 이후 저장 대상으로 바로 고를 수 있게 선택해 둔다
      if (destination === NEW && savedProject) setDestination(savedProject);
      setRows([]);
      setSummary(null);
      setSuggestedName("");
      setNewProjectName("");
      setText("");
    },
    onError: (err, payload) => {
      // 서버 필드 오류("tasks.2.title")를 해당 행에 표시
      if (err instanceof ApiError) {
        const nameError = err.fieldErrors["new_project.name"];
        if (nameError) setNewProjectError(nameError);
        const next: Record<string, RowErrors> = {};
        for (const [field, message] of Object.entries(err.fieldErrors)) {
          const match = /^tasks\.(\d+)\.(\w+)$/.exec(field);
          const key = match ? payload.keys[Number(match[1])] : undefined;
          if (key && match) next[key] = { ...next[key], [match[2]]: message };
        }
        setRowErrors(next);
        if (err.fieldErrors.project_id || err.status === 409) queryClient.invalidateQueries({ queryKey: projectKeys.all });
      }
    },
  });

  function update(key: string, patch: Partial<Row>) {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function submitSuggest(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim() || suggest.isPending) return;
    suggest.mutate();
  }

  function submitSave() {
    if (save.isPending || selected.length === 0) return;
    const errors: Record<string, RowErrors> = {};
    const tasks: TaskInput[] = [];
    for (const r of selected) {
      const e: RowErrors = {};
      const title = r.title.trim();
      if (!title) e.title = "업무 제목을 입력해 주세요.";
      const minutes = r.minutes.trim() ? Number(r.minutes) : null;
      if (minutes !== null && (!Number.isInteger(minutes) || minutes <= 0 || minutes > ESTIMATED_MINUTES_MAX)) {
        e.estimated_minutes = `1~${ESTIMATED_MINUTES_MAX.toLocaleString()} 사이의 분으로 입력해 주세요.`;
      }
      if (Object.keys(e).length > 0) errors[r.key] = e;
      tasks.push({
        title,
        description: r.description.trim() || null,
        project_id: projectId || null,
        status: "todo",
        priority: r.priority,
        due_date: r.due || null,
        estimated_minutes: minutes,
      });
    }
    setRowErrors(errors);
    const name = newProjectName.trim();
    const nameError = destination === NEW && !name ? "새 프로젝트 이름을 입력해 주세요." : null;
    setNewProjectError(nameError);
    if (Object.keys(errors).length > 0 || nameError) return;
    save.mutate({ tasks, keys: selected.map((r) => r.key), newProject: destination === NEW ? { name } : undefined });
  }

  const projectName = destination === NEW ? `새 프로젝트 ‘${newProjectName.trim() || "이름 없음"}’` : projects.find((p) => p.id === projectId)?.name;
  const notConfigured = usage && !usage.configured;
  const outOfQuota = usage ? usage.configured && usage.remaining <= 0 : false;
  const suggestError = suggest.error instanceof ApiError ? suggest.error.message : suggest.error ? "AI 제안을 받지 못했습니다. 잠시 후 다시 시도해 주세요." : null;
  const inputClass = (invalid = false) =>
    `block min-h-11 w-full rounded-xl border bg-surface px-3 text-sm text-foreground focus:outline-none focus-visible:outline-2 disabled:opacity-60 ${invalid ? "border-red-400" : "border-border focus:border-primary"}`;

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <section className="surface-card h-fit rounded-[20px] p-4 md:p-5 lg:p-6" aria-labelledby={`${formId}-ask`}>
        <h2 id={`${formId}-ask`} className="flex items-center gap-2 text-lg font-bold text-primary-dark">
          <Sparkles size={20} strokeWidth={2} aria-hidden="true" />
          무엇을 해야 하나요?
        </h2>

        {notConfigured && (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-3 text-sm text-amber-900" role="status">
            <CircleAlert size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
            AI 기능이 아직 설정되지 않았어요. 백엔드 환경변수에 AI 키를 넣고 서버를 다시 시작해 주세요.
          </p>
        )}

        <form onSubmit={submitSuggest} className="mt-4 space-y-4">
          <label className="block text-sm font-medium">
            하고 싶은 일
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={AI_TEXT_MAX}
              rows={6}
              disabled={suggest.isPending}
              placeholder={"예: 다음 주 금요일까지 신제품 발표 준비. 자료 조사부터 리허설까지 필요해."}
              className={`${inputClass()} mt-1.5 py-2.5 leading-6`}
            />
            <span className="mt-1 block text-right text-xs text-muted">{text.length.toLocaleString()} / {AI_TEXT_MAX.toLocaleString()}</span>
          </label>
          <label className="block text-sm font-medium">
            저장할 곳 <span className="font-normal text-muted">(기존 프로젝트를 고르면 그 정보와 업무를 참고해요)</span>
            <select value={destination} onChange={(e) => setDestination(e.target.value)} disabled={suggest.isPending || save.isPending} className={`${inputClass()} mt-1.5`}>
              <option value="">개인 업무</option>
              {activeProjectOptions(projectsQuery.data ?? []).map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
              <option value={NEW}>＋ 새 프로젝트 만들기</option>
            </select>
          </label>
          {destination === NEW && (
            <label className="block text-sm font-medium">
              새 프로젝트 이름
              <input
                value={newProjectName}
                onChange={(e) => {
                  setNewProjectName(e.target.value);
                  setNewProjectError(null);
                }}
                maxLength={200}
                disabled={save.isPending}
                placeholder={suggestedName || "예: 신제품 발표 준비"}
                className={`${inputClass(Boolean(newProjectError))} mt-1.5`}
                aria-invalid={Boolean(newProjectError) || undefined}
              />
              {newProjectError ? (
                <span className="mt-1 block text-xs text-red-700" role="alert">{newProjectError}</span>
              ) : (
                <span className="mt-1 block text-xs text-muted">저장할 때 프로젝트를 만들고 고른 업무를 모두 넣어요.</span>
              )}
            </label>
          )}

          <button
            type="submit"
            disabled={suggest.isPending || !text.trim() || notConfigured || outOfQuota}
            aria-busy={suggest.isPending}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-60"
          >
            {suggest.isPending ? <LoaderCircle size={18} strokeWidth={2} className="animate-spin" aria-hidden="true" /> : <Sparkles size={18} strokeWidth={2} aria-hidden="true" />}
            {suggest.isPending ? "AI가 업무를 나누는 중…" : "AI로 업무 나누기"}
          </button>
          {usage?.configured && (
            <p className="text-center text-xs text-muted" aria-live="polite">
              오늘 {usage.remaining}회 남음 (하루 {usage.limit}회)
            </p>
          )}
        </form>

        {suggestError && (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800" role="alert">
            <CircleAlert size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
            {suggestError}
          </p>
        )}

        <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-muted">
          <ShieldAlert size={14} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
          입력한 문장과 선택한 프로젝트의 이름·설명·업무 제목이 Google Gemini API로 전송돼요. 무료 등급에서는 Google이 서비스 개선에 사용할 수 있으니 민감한 정보는 적지 마세요.
        </p>
      </section>

      <section className="surface-card rounded-[20px] p-4 md:p-5 lg:p-6" aria-labelledby={`${formId}-result`} aria-busy={suggest.isPending}>
        <h2 id={`${formId}-result`} className="text-lg font-bold text-primary-dark">제안된 업무</h2>

        {saved && (
          <div className="mt-4 rounded-xl border border-soft-sage bg-pale-green/60 px-4 py-3 text-sm text-primary-dark" role="status">
            <p className="flex items-center gap-2 font-semibold">
              <CircleCheck size={18} strokeWidth={2} aria-hidden="true" />
              업무 {saved.count}개를 저장했어요.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Link href={saved.projectId ? `/projects/${saved.projectId}` : "/tasks?scope=personal"} className="flex min-h-11 items-center rounded-xl border border-border bg-surface px-3 font-semibold hover:bg-pale-green">
                업무 보기
              </Link>
              <Link href="/calendar" className="flex min-h-11 items-center gap-1.5 rounded-xl border border-border bg-surface px-3 font-semibold hover:bg-pale-green">
                <CalendarDays size={16} strokeWidth={2} aria-hidden="true" />
                시간표에 배치하기
              </Link>
            </div>
          </div>
        )}

        {suggest.isPending ? (
          <div className="mt-4 space-y-3" aria-label="불러오는 중">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-pale-green/40" />)}
          </div>
        ) : rows.length === 0 ? (
          <div className="mt-4 rounded-xl bg-background px-4 py-10 text-center text-sm leading-6 text-muted">
            {!saved && (
              <p>
                왼쪽에 하고 싶은 일을 적으면 AI가 세부 업무로 나눠 제안해요.
                <br />
                제안은 저장되지 않으니, 고치고 골라서 저장하세요.
              </p>
            )}
            <button type="button" onClick={() => setRows([blankRow()])} className="mx-auto mt-4 flex min-h-11 items-center gap-2 rounded-xl border border-dashed border-soft-sage bg-surface px-4 font-semibold text-primary-dark hover:bg-pale-green">
              <Plus size={18} strokeWidth={2} aria-hidden="true" />
              업무 직접 추가
            </button>
          </div>
        ) : (
          <>
            {summary && (
              <p className="mt-3 flex items-start gap-2 rounded-xl bg-pale-green/50 px-3.5 py-3 text-sm text-primary-dark">
                <Info size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
                {summary}
              </p>
            )}
            {/* AI가 프로젝트 이름을 제안했고 아직 개인 업무로 저장하려는 경우: 프로젝트로 바꾸기 */}
            {suggestedName && destination === "" && (
              <button
                type="button"
                onClick={() => {
                  setDestination(NEW);
                  setNewProjectName(suggestedName);
                }}
                className="mt-3 flex min-h-11 w-full items-center gap-2 rounded-xl border border-primary/40 bg-surface px-3.5 text-left text-sm text-primary-dark hover:bg-pale-green"
              >
                <FolderPlus size={18} strokeWidth={2} className="shrink-0" aria-hidden="true" />
                <span>
                  개인 업무 대신 <strong className="font-semibold">‘{suggestedName}’ 새 프로젝트</strong>로 저장하기
                </span>
              </button>
            )}
            <ol className="mt-4 space-y-3">
              {rows.map((r, index) => {
                const e = rowErrors[r.key] ?? {};
                return (
                  <li key={r.key} className={`rounded-2xl border p-3 ${r.include ? "border-soft-sage bg-surface" : "border-border bg-background opacity-70"}`}>
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={r.include}
                        onChange={(ev) => update(r.key, { include: ev.target.checked })}
                        className="mt-3 size-5 shrink-0 accent-[var(--color-primary)]"
                        aria-label={`${index + 1}번 업무 저장에 포함`}
                      />
                      <div className="min-w-0 flex-1 space-y-2">
                        <input value={r.title} onChange={(ev) => update(r.key, { title: ev.target.value })} disabled={!r.include || save.isPending} className={`${inputClass(Boolean(e.title))} font-medium`} aria-label={`${index + 1}번 업무 제목`} aria-invalid={Boolean(e.title) || undefined} />
                        {e.title && <p className="text-xs text-red-700">{e.title}</p>}
                        <div className="grid grid-cols-3 gap-2">
                          <select value={r.priority} onChange={(ev) => update(r.key, { priority: ev.target.value as TaskPriority })} disabled={!r.include || save.isPending} className={inputClass()} aria-label={`${index + 1}번 우선순위`}>
                            {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{TASK_PRIORITY_LABEL[p]}</option>)}
                          </select>
                          <label className="relative block">
                            <span className="sr-only">{index + 1}번 예상 시간(분)</span>
                            <input inputMode="numeric" value={r.minutes} onChange={(ev) => update(r.key, { minutes: ev.target.value.replace(/[^0-9]/g, "") })} disabled={!r.include || save.isPending} placeholder="예상" className={`${inputClass(Boolean(e.estimated_minutes))} pr-8`} aria-invalid={Boolean(e.estimated_minutes) || undefined} />
                            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">분</span>
                          </label>
                          <input type="date" value={r.due} onChange={(ev) => update(r.key, { due: ev.target.value })} disabled={!r.include || save.isPending} className={inputClass(Boolean(e.due_date))} aria-label={`${index + 1}번 마감일`} />
                        </div>
                        {(e.estimated_minutes || e.due_date) && <p className="text-xs text-red-700">{e.estimated_minutes ?? e.due_date}</p>}
                        {r.include && !save.isPending && <EstimateHint compact value={r.minutes} onApply={(m) => update(r.key, { minutes: String(m) })} />}
                        {(r.description || r.include) && (
                          <input value={r.description} onChange={(ev) => update(r.key, { description: ev.target.value })} disabled={!r.include || save.isPending} placeholder="메모 (선택)" className={`${inputClass(Boolean(e.description))} text-xs`} aria-label={`${index + 1}번 메모`} />
                        )}
                      </div>
                      <button type="button" onClick={() => setRows((cur) => cur.filter((x) => x.key !== r.key))} disabled={save.isPending} className="flex size-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-red-50 hover:text-red-700" aria-label={`${index + 1}번 제안 지우기`}>
                        <X size={18} strokeWidth={2} aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
            <button type="button" onClick={() => setRows((cur) => [...cur, blankRow()])} disabled={save.isPending || rows.length >= BULK_CREATE_MAX} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-soft-sage text-sm font-semibold text-primary-dark hover:bg-pale-green disabled:opacity-50">
              <Plus size={18} strokeWidth={2} aria-hidden="true" />
              업무 직접 추가
            </button>

            {save.isError && !(save.error instanceof ApiError && Object.keys(save.error.fieldErrors).some((k) => k.startsWith("tasks."))) && (
              <p className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800" role="alert">
                <CircleAlert size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
                {save.error instanceof ApiError ? (save.error.fieldErrors.project_id ?? save.error.message) : "저장하지 못했습니다. 다시 시도해 주세요."}
              </p>
            )}

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
              <button type="button" onClick={() => suggest.mutate()} disabled={suggest.isPending || save.isPending || !text.trim() || outOfQuota} className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-primary-dark hover:bg-pale-green disabled:opacity-60">
                <RotateCcw size={16} strokeWidth={2} aria-hidden="true" />
                다시 제안받기
              </button>
              <button
                type="button"
                onClick={submitSave}
                disabled={save.isPending || selected.length === 0 || selected.length > BULK_CREATE_MAX}
                aria-busy={save.isPending}
                className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-60"
              >
                {save.isPending && <LoaderCircle size={18} strokeWidth={2} className="animate-spin" aria-hidden="true" />}
                선택한 {selected.length}개 저장 · {projectName ?? "개인 업무"}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
