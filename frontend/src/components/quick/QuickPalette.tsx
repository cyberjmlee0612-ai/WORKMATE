"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight, CalendarDays, CalendarHeart, ChartNoAxesCombined, CircleAlert, CornerDownLeft, FolderKanban, Home,
  ListTodo, LoaderCircle, Repeat, Settings2, Sparkles, Square, Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { TimeSelect } from "@/components/common/TimeSelect";
import { useTimerControls } from "@/components/time/useTimerControls";
import { EVENT_KINDS, eventKeys } from "@/lib/api/events";
import { invalidateWorkData } from "@/lib/api/invalidate";
import { listProjects, projectKeys } from "@/lib/api/projects";
import { QUICK_OPEN_EVENT, QUICK_TEXT_MAX, aiParseQuick, createQuick, parseQuick, searchAll, type QuickDraft, type QuickKind } from "@/lib/api/quick";
import { routineKeys, ruleLabel } from "@/lib/api/routines";
import { TASK_PRIORITIES, TASK_PRIORITY_LABEL, type TaskPriority } from "@/lib/api/tasks";
import { userTimeZone } from "@/lib/date";
import { formatDate } from "@/lib/format";
import { activeProjectOptions } from "@/lib/projectTree";

/** 어디서든 Ctrl+K(맥은 ⌘K)로 여는 빠른 입력 · 검색 · 이동 창 (2026-11-27 사용자 확정) */
export function QuickPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(QUICK_OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(QUICK_OPEN_EVENT, onOpen);
    };
  }, []);
  return open ? <Palette onClose={() => setOpen(false)} /> : null;
}

const PAGES: { label: string; href: string; icon: LucideIcon; words: string }[] = [
  { label: "대시보드", href: "/", icon: Home, words: "홈 대시보드 나의 하루" },
  { label: "프로젝트 현황", href: "/?view=projects", icon: FolderKanban, words: "프로젝트 현황" },
  { label: "내 프로젝트", href: "/projects", icon: FolderKanban, words: "프로젝트" },
  { label: "업무 관리", href: "/tasks", icon: ListTodo, words: "업무 할 일 태스크" },
  { label: "반복 · 습관", href: "/routines", icon: Repeat, words: "반복 습관 루틴" },
  { label: "AI 업무 도우미", href: "/assistant", icon: Sparkles, words: "ai 도우미 나누기" },
  { label: "캘린더", href: "/calendar", icon: CalendarDays, words: "캘린더 시간표 일정" },
  { label: "리포트", href: "/reports", icon: ChartNoAxesCombined, words: "리포트 통계 회고" },
  { label: "설정", href: "/settings", icon: Settings2, words: "설정 알림 시간표 계정" },
];

const KINDS: { value: QuickKind; label: string }[] = [
  { value: "task", label: "업무" },
  { value: "event", label: "이벤트" },
  { value: "routine", label: "반복" },
];

const EXAMPLES = ["내일 오후 3시 발표 준비 1시간 #프로젝트 !높음", "12월 5일 정보처리기사 시험", "평일 아침 7시 영어 단어 30분", "습관: 물 2L"];

function useDebounced(value: string, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

function Palette({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const id = useId();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [tz] = useState(userTimeZone);
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), 250);
  const [ai, setAi] = useState<{ text: string; draft: QuickDraft } | null>(null);
  const [edits, setEdits] = useState<{ text: string; patch: Partial<QuickDraft> }>({ text: "", patch: {} });
  const [created, setCreated] = useState<{ message: string; href: string } | null>(null);
  const [timerNotice, setTimerNotice] = useState<string | null>(null);
  const timer = useTimerControls({ onError: setTimerNotice, onNotice: setTimerNotice });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const parsed = useQuery({ queryKey: ["quick-parse", q, tz], queryFn: () => parseQuick(q, tz), enabled: q.length > 0, staleTime: 30_000 });
  const search = useQuery({ queryKey: ["search", q], queryFn: () => searchAll(q), enabled: q.length > 0, staleTime: 15_000 });
  const projectsQuery = useQuery({ queryKey: projectKeys.list(), queryFn: listProjects });
  const projectOptions = activeProjectOptions(projectsQuery.data ?? []);

  const base = ai?.text === q ? ai.draft : q && parsed.data ? parsed.data : null;
  const draft: QuickDraft | null = base ? { ...base, ...(edits.text === q ? edits.patch : {}) } : null;
  const edit = (patch: Partial<QuickDraft>) => setEdits((cur) => ({ text: q, patch: { ...(cur.text === q ? cur.patch : {}), ...patch } }));
  const stale = text.trim() !== q || parsed.isFetching;

  const aiParse = useMutation({
    mutationFn: () => aiParseQuick(q, tz),
    onSuccess: (d) => {
      setAi({ text: q, draft: d });
      setEdits({ text: q, patch: {} });
    },
  });
  const create = useMutation({
    mutationFn: (d: QuickDraft) => createQuick(d, tz),
    onSuccess: async (result) => {
      const href = result.kind === "event" ? `/calendar?date=${draft?.date ?? ""}` : result.kind === "routine" ? "/routines" : "/tasks";
      setCreated({ message: `‘${result.title}’ — ${result.message}`, href });
      setText("");
      setAi(null);
      await Promise.all([
        invalidateWorkData(queryClient),
        queryClient.invalidateQueries({ queryKey: eventKeys.all }),
        queryClient.invalidateQueries({ queryKey: routineKeys.all }),
      ]);
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!draft || stale || create.isPending || !draft.title.trim()) return;
    create.mutate(draft);
  }
  const go = (href: string) => {
    router.push(href);
    onClose();
  };

  const needle = q.replace(/\s/g, "").toLowerCase();
  const pages = PAGES.filter((p) => !needle || p.words.replace(/\s/g, "").toLowerCase().includes(needle) || p.label.replace(/\s/g, "").includes(needle));
  const results = search.data;
  const hasResults = results && (results.tasks.length + results.projects.length + results.events.length > 0);

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === dialogRef.current && onClose()}
      aria-labelledby={`${id}-label`}
      className="surface-card mx-auto mt-[8vh] max-h-[84dvh] w-[calc(100%-1.5rem)] max-w-2xl overflow-hidden rounded-[20px] p-0 text-foreground backdrop:bg-primary-dark/30"
    >
      <form onSubmit={submit} className="flex max-h-[84dvh] flex-col">
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Zap size={18} strokeWidth={2} className="shrink-0 text-primary" aria-hidden="true" />
          <label id={`${id}-label`} htmlFor={`${id}-input`} className="sr-only">빠른 입력 · 검색</label>
          <input
            id={`${id}-input`}
            autoFocus
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setCreated(null);
            }}
            maxLength={QUICK_TEXT_MAX}
            placeholder="할 일을 한 줄로 적거나, 찾을 말을 입력하세요"
            className="min-h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted/70"
            autoComplete="off"
          />
          <kbd className="hidden shrink-0 rounded border border-border px-1.5 text-[11px] text-muted sm:inline">Esc</kbd>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {created && (
            <p className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-soft-sage bg-pale-green/70 px-3 py-2.5 text-sm text-primary-dark" role="status">
              {created.message}
              <button type="button" onClick={() => go(created.href)} className="font-semibold underline underline-offset-2">보기</button>
            </p>
          )}

          {!q && !created && (
            <div className="px-1 pb-2 text-sm text-muted">
              <p className="font-semibold text-primary-dark">이렇게 적어 보세요</p>
              <ul className="mt-1 space-y-0.5">
                {EXAMPLES.map((ex) => (
                  <li key={ex}><button type="button" onClick={() => setText(ex)} className="min-h-9 text-left hover:text-primary-dark hover:underline">{ex}</button></li>
                ))}
              </ul>
              <p className="mt-2 text-xs">날짜·시각·길이·#프로젝트·!우선순위를 알아서 읽어요. 시험·발표·출품·마감으로 끝나면 이벤트, 매일·평일·매주는 반복으로 만들어요.</p>
            </div>
          )}

          {q && (
            <section aria-label="만들기" className="rounded-2xl border border-primary/30 bg-pale-green/30 p-3">
              {!draft ? (
                <p className="flex items-center gap-2 text-sm text-muted"><LoaderCircle size={16} className="animate-spin" aria-hidden="true" />해석하는 중…</p>
              ) : (
                <DraftEditor draft={draft} edit={edit} projectOptions={projectOptions} />
              )}
              {(create.isError || aiParse.isError) && (
                <p className="mt-2 flex items-start gap-1.5 text-xs font-semibold text-red-700" role="alert">
                  <CircleAlert size={14} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
                  {(create.error ?? aiParse.error)?.message}
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="submit" disabled={!draft || stale || create.isPending || !draft.title.trim()} className="flex min-h-10 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50">
                  {create.isPending ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <CornerDownLeft size={15} strokeWidth={2} aria-hidden="true" />}
                  만들기
                </button>
                <button type="button" onClick={() => aiParse.mutate()} disabled={aiParse.isPending || !q} className="flex min-h-10 items-center gap-1.5 rounded-lg border border-violet-300 bg-surface px-3 text-xs font-semibold text-violet-900 hover:bg-violet-50 disabled:opacity-60" title="하루 AI 한도 1회를 써요">
                  {aiParse.isPending ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : <Sparkles size={14} strokeWidth={2} aria-hidden="true" />}
                  AI로 다시 해석
                </button>
                {ai?.text === q && <span className="text-xs text-violet-800">AI 해석 결과예요 (입력 문장이 Gemini로 전송됐어요)</span>}
              </div>
            </section>
          )}

          {q && hasResults && (
            <section aria-label="검색 결과" className="mt-3">
              <p className="px-1 text-xs font-semibold text-muted">검색 결과</p>
              <ul className="mt-1">
                {results.projects.map((p) => (
                  <ResultRow key={`p${p.id}`} icon={FolderKanban} title={p.name} sub="프로젝트" onClick={() => go(`/projects/${p.id}`)} />
                ))}
                {results.tasks.map((t) => (
                  <ResultRow key={`t${t.id}`} icon={ListTodo} title={t.title} sub={`업무 · ${t.project_path ?? "개인 업무"}${t.due_date ? ` · 마감 ${formatDate(t.due_date)}` : ""}${t.status === "completed" ? " · 완료" : ""}`} onClick={() => go(t.project_path ? "/tasks?scope=project" : "/tasks?scope=personal")} />
                ))}
                {results.events.map((e) => (
                  <ResultRow key={`e${e.id}`} icon={CalendarHeart} title={e.title} sub={`이벤트 · ${formatDate(e.event_date)}`} onClick={() => go(`/calendar?date=${e.event_date}`)} />
                ))}
              </ul>
            </section>
          )}

          {(pages.length > 0 || timer.running) && (
            <section aria-label="이동과 바로 하기" className="mt-3">
              <p className="px-1 text-xs font-semibold text-muted">{q ? "이동" : "이동 · 바로 하기"}</p>
              <ul className="mt-1">
                {timer.running && (!needle || "타이머멈추기".includes(needle)) && (
                  <ResultRow icon={Square} title={`타이머 멈추기 — ${timer.running.task_title}`} sub="바로 하기" onClick={() => timer.stop()} />
                )}
                {pages.map((p) => <ResultRow key={p.href} icon={p.icon} title={p.label} sub="이동" onClick={() => go(p.href)} />)}
              </ul>
              {timerNotice && <p className="px-2 text-xs text-primary-dark" role="status">{timerNotice}</p>}
            </section>
          )}
        </div>
        <p className="border-t border-border px-4 py-2 text-[11px] text-muted">Enter 만들기 · Esc 닫기 · 어디서든 Ctrl+K (맥 ⌘K)</p>
      </form>
      {timer.dialog}
    </dialog>
  );
}

function ResultRow({ icon: Icon, title, sub, onClick }: { icon: LucideIcon; title: string; sub: string; onClick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onClick} className="group flex min-h-11 w-full items-center gap-3 rounded-xl px-2 text-left hover:bg-pale-green/60 focus-visible:bg-pale-green/60">
        <Icon size={16} strokeWidth={2} className="shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{title}</span>
          <span className="block truncate text-xs text-muted">{sub}</span>
        </span>
        <ArrowRight size={14} strokeWidth={2} className="shrink-0 text-muted opacity-0 group-hover:opacity-100" aria-hidden="true" />
      </button>
    </li>
  );
}

const small = "min-h-9 rounded-lg border border-border bg-surface px-2 text-sm";

function DraftEditor({ draft, edit, projectOptions }: { draft: QuickDraft; edit: (p: Partial<QuickDraft>) => void; projectOptions: { id: string; label: string }[] }) {
  const setKind = (kind: QuickKind) =>
    edit({ kind, event_kind: kind === "event" ? draft.event_kind ?? "other" : draft.event_kind, freq: kind === "routine" ? draft.freq ?? "daily" : draft.freq });
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg bg-surface p-0.5" role="radiogroup" aria-label="만들 것">
          {KINDS.map((k) => (
            <button key={k.value} type="button" role="radio" aria-checked={draft.kind === k.value} onClick={() => setKind(k.value)} className={`min-h-8 rounded-md px-2.5 text-xs font-semibold ${draft.kind === k.value ? "bg-primary text-white" : "text-muted hover:text-primary-dark"}`}>
              {k.label}
            </button>
          ))}
        </div>
        {draft.kind === "routine" && (
          <div className="flex rounded-lg bg-surface p-0.5" role="radiogroup" aria-label="반복 종류">
            {(["task", "habit"] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={draft.mode === m} onClick={() => edit({ mode: m })} className={`min-h-8 rounded-md px-2.5 text-xs font-semibold ${draft.mode === m ? "bg-primary-dark text-white" : "text-muted"}`}>
                {m === "task" ? "반복 업무" : "습관"}
              </button>
            ))}
          </div>
        )}
        {draft.matched.length > 0 && <span className="text-xs text-muted">읽은 말: {draft.matched.join(" · ")}</span>}
      </div>

      <input value={draft.title} onChange={(e) => edit({ title: e.target.value })} maxLength={100} aria-label="제목" placeholder="제목" className="block min-h-10 w-full rounded-lg border border-border bg-surface px-3 text-[15px] font-semibold" />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {draft.kind === "routine" ? (
          <span className="rounded-lg bg-surface px-2.5 py-1.5 font-semibold text-primary-dark">{ruleLabel({ freq: draft.freq ?? "daily", weekdays: draft.weekdays, every_weeks: draft.every_weeks, month_day: draft.month_day, interval_days: draft.interval_days })}</span>
        ) : (
          <label className="flex items-center gap-1.5">
            <span className="text-xs text-muted">{draft.kind === "event" ? "날짜" : "마감"}</span>
            <input type="date" value={draft.date ?? ""} onChange={(e) => edit({ date: e.target.value || null })} className={small} />
          </label>
        )}
        {draft.start ? (
          <span className="flex flex-wrap items-center gap-1">
            <TimeSelect label="시작" value={draft.start} onChange={(v) => edit({ start: v })} />
            <span className="text-muted">–</span>
            {draft.end ? (
              <TimeSelect label="끝" value={draft.end} onChange={(v) => edit({ end: v, duration: null })} allow24 />
            ) : (
              <span className="text-xs text-muted">{draft.duration ?? 60}분</span>
            )}
            <button type="button" onClick={() => edit({ start: null, end: null })} className="min-h-9 px-1 text-xs text-muted hover:underline">시각 빼기</button>
          </span>
        ) : (
          <button type="button" onClick={() => edit({ start: "09:00", end: null })} className="min-h-9 text-xs font-semibold text-primary hover:underline">+ 시각</button>
        )}
        {draft.kind !== "event" && (
          <label className="flex items-center gap-1">
            <span className="text-xs text-muted">{draft.kind === "task" ? "예상" : "길이"}</span>
            <input inputMode="numeric" value={draft.duration ?? ""} onChange={(e) => edit({ duration: e.target.value ? Math.min(1440, Number(e.target.value.replace(/\D/g, "")) || 0) || null : null })} className={`${small} w-16`} aria-label="분" />
            <span className="text-xs text-muted">분</span>
          </label>
        )}
      </div>

      {draft.kind === "event" ? (
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="이벤트 종류">
          {EVENT_KINDS.map((k) => (
            <button key={k.value} type="button" role="radio" aria-checked={draft.event_kind === k.value} onClick={() => edit({ event_kind: k.value })} className={`min-h-8 rounded-lg border px-2.5 text-xs font-semibold ${draft.event_kind === k.value ? k.badge : "border-border text-muted"}`}>
              {k.label}
            </button>
          ))}
        </div>
      ) : null}

      {!(draft.kind === "routine" && draft.mode === "habit") && (
        <div className="flex flex-wrap items-center gap-2">
          <select value={draft.project_id ?? ""} onChange={(e) => edit({ project_id: e.target.value || null, project_query: null })} aria-label="프로젝트" className={`${small} max-w-[16rem]`}>
            <option value="">{draft.kind === "event" ? "개인 이벤트" : "개인 업무"}</option>
            {draft.project_id && !projectOptions.some((o) => o.id === draft.project_id) && <option value={draft.project_id}>{draft.project_name}</option>}
            {projectOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          {draft.kind !== "event" && (
            <select value={draft.priority ?? "medium"} onChange={(e) => edit({ priority: e.target.value as TaskPriority })} aria-label="우선순위" className={small}>
              {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{TASK_PRIORITY_LABEL[p]}</option>)}
            </select>
          )}
          {draft.project_query && <span className="text-xs text-amber-900">‘#{draft.project_query}’ 프로젝트를 찾지 못해 {draft.kind === "event" ? "개인 이벤트" : "개인 업무"}로 만들어요</span>}
        </div>
      )}
    </div>
  );
}
