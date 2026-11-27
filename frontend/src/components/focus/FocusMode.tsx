"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BellOff, Brain, Coffee, LoaderCircle, Maximize2, Minimize2, Play, SkipForward, Square, Timer, X } from "lucide-react";
import { useTimerControls } from "@/components/time/useTimerControls";
import { FOCUS_REASONS, finishFocus, interruptFocus, startFocus, type FocusReason } from "@/lib/api/focus";
import { listTasks, taskKeys } from "@/lib/api/tasks";
import { FOCUS_OPEN_EVENT, PRESETS, chime, endsIn, getFocus, lastPreset, primeAudio, rememberPreset, setFocus, useFocus, type FocusPreset, type FocusState } from "@/lib/focus";
import { formatElapsed, useNowSeconds } from "@/lib/time";

/**
 * 집중 모드 (2026-11-27 사용자 확정): 25분 집중 → 5분 휴식, 4번째 뒤 15분. 전체 화면, 최소화하면 위쪽에 작은 표시.
 * 타이머(실제 기록)와는 별개 — 켜져 있지 않으면 '이 업무 타이머 켜기'만 권한다.
 * 모든 화면에 붙는다 (AppShell).
 */
export function FocusMode() {
  const state = useFocus();
  const [starting, setStarting] = useState<{ id: string; title: string } | null | false>(false);

  useEffect(() => {
    const onOpen = (e: Event) => setStarting((e as CustomEvent<{ id: string; title: string } | null>).detail ?? null);
    window.addEventListener(FOCUS_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(FOCUS_OPEN_EVENT, onOpen);
  }, []);

  return (
    <>
      {starting !== false && !state && <StartDialog initial={starting} onClose={() => setStarting(false)} />}
      {state && <Runner state={state} />}
    </>
  );
}

// ---------------------------------------------------------------- 시작

function StartDialog({ initial, onClose }: { initial: { id: string; title: string } | null; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const id = useId();
  const { running } = useTimerControls();
  const tasksQuery = useQuery({ queryKey: taskKeys.list({}), queryFn: () => listTasks({}) });
  const open = (tasksQuery.data ?? []).filter((t) => t.status !== "completed" && t.status !== "cancelled");
  const [taskId, setTaskId] = useState<string>(initial?.id ?? running?.task_id ?? "");
  const [preset, setPreset] = useState<FocusPreset>(lastPreset);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  async function start() {
    primeAudio();
    setPending(true);
    setError(null);
    try {
      const session = await startFocus(taskId || null, preset.focus);
      const title = initial?.id === taskId ? initial.title : open.find((t) => t.id === taskId)?.title ?? running?.task_title ?? "";
      rememberPreset(preset);
      setFocus({
        sessionId: session.id, taskId: taskId || null, taskTitle: taskId ? title : "", phase: "focus",
        endsAt: endsIn(preset.focus), round: 0, interruptions: 0, preset, minimized: false,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "시작하지 못했어요.");
      setPending(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === dialogRef.current && onClose()}
      aria-labelledby={`${id}-title`}
      className="surface-card m-auto w-[calc(100%-2rem)] max-w-md rounded-[20px] p-5 text-foreground backdrop:bg-primary-dark/30 md:p-6"
    >
      <h2 id={`${id}-title`} className="flex items-center gap-2 text-lg font-bold text-primary-dark">
        <Brain size={20} strokeWidth={2} aria-hidden="true" />
        집중 모드
      </h2>
      <p className="mt-1 text-sm text-muted">정해진 시간 동안 한 가지에만 집중하고, 쉬는 시간에는 확실히 쉬어요.</p>

      <label className="mt-4 block text-sm font-medium">
        무엇에 집중할까요?
        <select value={taskId} onChange={(e) => setTaskId(e.target.value)} className="mt-1.5 block min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-[15px]">
          <option value="">업무 없이 집중</option>
          {initial && !open.some((t) => t.id === initial.id) && <option value={initial.id}>{initial.title}</option>}
          {open.map((t) => <option key={t.id} value={t.id}>{t.title}{t.project_path ? ` · ${t.project_path}` : ""}</option>)}
        </select>
      </label>

      <p className="mt-4 text-sm font-medium">집중 / 휴식 (분)</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label="집중·휴식 길이">
        {PRESETS.map((p) => {
          const on = p.value.focus === preset.focus && p.value.short === preset.short;
          return (
            <button key={p.label} type="button" role="radio" aria-checked={on} onClick={() => setPreset(p.value)} className={`min-h-11 rounded-xl border px-3.5 text-sm font-semibold ${on ? "border-primary bg-pale-green text-primary-dark" : "border-border text-muted hover:bg-pale-green/40"}`}>
              {p.label}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-xs text-muted">{preset.every}번 집중하면 {preset.long}분 길게 쉬어요.</p>

      <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-pale-green/50 px-3 py-2 text-xs text-primary-dark">
        <Timer size={14} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
        집중 모드는 실제 기록(타이머)과 따로 움직여요. 기록을 남기려면 타이머도 켜 주세요.
      </p>
      {error && <p className="mt-2 text-sm font-semibold text-red-700" role="alert">{error}</p>}

      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="min-h-11 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-primary-dark hover:bg-pale-green">취소</button>
        <button type="button" onClick={start} disabled={pending} className="flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-60">
          {pending ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <Play size={16} strokeWidth={2} aria-hidden="true" />}
          {preset.focus}분 집중 시작
        </button>
      </div>
    </dialog>
  );
}

// ---------------------------------------------------------------- 진행

function notify(title: string, body: string) {
  if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
    const n = new Notification(title, { body, tag: "workmate-focus" });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  }
}

function Runner({ state }: { state: FocusState }) {
  const nowSeconds = useNowSeconds();
  const [reasonOpen, setReasonOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useTimerControls({ onError: setError });

  // 단계가 끝났는지 1초마다 확인 (상태는 저장소에서 다시 읽어 여러 탭이 겹쳐도 한 번만 넘어가게)
  useEffect(() => {
    const id = window.setInterval(() => {
      const s = getFocus();
      if (!s || s.phase === "ready" || Date.now() < s.endsAt) return;
      if (s.phase === "focus") {
        const round = s.round + 1;
        const long = round % s.preset.every === 0;
        setFocus({ ...s, sessionId: null, phase: "break", round, interruptions: 0, endsAt: endsIn(long ? s.preset.long : s.preset.short) });
        if (s.sessionId) finishFocus(s.sessionId, true).catch(() => undefined);
        chime();
        notify("집중 끝! 쉬어 가요", long ? `${s.preset.long}분 길게 쉬어요.` : `${s.preset.short}분 쉬어요.`);
      } else {
        setFocus({ ...s, phase: "ready", endsAt: 0 });
        chime();
        notify("휴식 끝", "다음 집중을 시작해 볼까요?");
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const remaining = state.phase === "ready" || nowSeconds === null ? null : Math.max(0, state.endsAt - nowSeconds * 1000);
  const timerOn = timer.running?.task_id === state.taskId && state.taskId !== null;

  async function nextFocus() {
    primeAudio();
    setBusy(true);
    setError(null);
    try {
      const session = await startFocus(state.taskId, state.preset.focus);
      setFocus({ ...state, sessionId: session.id, phase: "focus", interruptions: 0, endsAt: endsIn(state.preset.focus) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "시작하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }
  async function quit() {
    if (state.sessionId) await finishFocus(state.sessionId, false).catch(() => undefined);
    setFocus(null);
  }
  async function interrupt(reason: FocusReason | null) {
    setReasonOpen(false);
    if (!state.sessionId) return;
    try {
      const s = await interruptFocus(state.sessionId, reason);
      setFocus({ ...state, interruptions: s.interruptions });
    } catch (e) {
      setError(e instanceof Error ? e.message : "기록하지 못했어요.");
    }
  }

  const label = state.phase === "focus" ? "집중" : state.phase === "break" ? "휴식" : "준비";
  // 이번 묶음(긴 휴식 전까지)에서 끝낸 집중 수. 긴 휴식 중에는 모두 채워 보여 준다
  const inSet = state.round % state.preset.every;
  const doneInSet = inSet === 0 && state.round > 0 && state.phase !== "focus" ? state.preset.every : inSet;
  const clock = remaining === null ? "--:--" : formatElapsed(remaining + 999);

  if (state.minimized) {
    return (
      <button
        type="button"
        onClick={() => setFocus({ ...state, minimized: false })}
        className={`fixed left-1/2 top-[max(0.75rem,env(safe-area-inset-top))] z-40 flex min-h-11 -translate-x-1/2 items-center gap-2 rounded-full px-4 text-sm font-semibold text-white shadow-lg ${state.phase === "focus" ? "bg-primary-dark" : "bg-amber-600"}`}
        aria-label={`집중 모드 펼치기, ${label} ${clock} 남음`}
      >
        {state.phase === "focus" ? <Brain size={16} aria-hidden="true" /> : <Coffee size={16} aria-hidden="true" />}
        {label} <span className="font-geist tabular-nums">{state.phase === "ready" ? "다음 집중 대기" : clock}</span>
        <Maximize2 size={14} aria-hidden="true" />
      </button>
    );
  }

  return (
    <div className={`fixed inset-0 z-[60] flex flex-col items-center justify-center px-6 text-white ${state.phase === "focus" ? "bg-primary-dark" : "bg-[#3d5a4a]"}`} role="dialog" aria-modal="true" aria-label="집중 모드">
      <div className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] flex gap-2">
        <button type="button" onClick={() => setFocus({ ...state, minimized: true })} className="flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm text-white/80 hover:bg-white/10" aria-label="최소화">
          <Minimize2 size={18} aria-hidden="true" />
          <span className="hidden sm:inline">최소화</span>
        </button>
        <button type="button" onClick={quit} className="flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm text-white/80 hover:bg-white/10" aria-label="집중 모드 그만하기">
          <X size={18} aria-hidden="true" />
          <span className="hidden sm:inline">그만하기</span>
        </button>
      </div>

      <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-white/70">
        {state.phase === "focus" ? <Brain size={16} aria-hidden="true" /> : <Coffee size={16} aria-hidden="true" />}
        {state.phase === "focus" ? `집중 ${state.round + 1}번째` : state.phase === "break" ? "쉬는 시간" : "휴식 끝"}
      </p>
      <p className="mt-4 font-geist text-[clamp(4.5rem,20vw,10rem)] font-bold leading-none tabular-nums" aria-hidden={state.phase === "ready"}>
        {state.phase === "ready" ? "준비" : clock}
      </p>
      {state.taskTitle && <p className="mt-5 max-w-xl text-center text-lg font-semibold text-white/90">{state.taskTitle}</p>}
      <div className="mt-4 flex gap-1.5" aria-label={`이번에 끝낸 집중 ${state.round}번`}>
        {Array.from({ length: state.preset.every }, (_, i) => (
          <span key={i} className={`size-2.5 rounded-full ${i < doneInSet ? "bg-white" : "bg-white/25"}`} aria-hidden="true" />
        ))}
      </div>

      <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
        {state.phase === "focus" && (
          <div className="relative">
            <button type="button" onClick={() => setReasonOpen((v) => !v)} aria-expanded={reasonOpen} className="flex min-h-12 items-center gap-2 rounded-2xl bg-white/10 px-5 text-sm font-semibold hover:bg-white/20">
              <BellOff size={18} aria-hidden="true" />
              방해받음{state.interruptions > 0 && <span className="rounded-full bg-white/20 px-2 text-xs">{state.interruptions}</span>}
            </button>
            {reasonOpen && (
              <div className="absolute bottom-full left-1/2 mb-2 w-56 -translate-x-1/2 rounded-2xl bg-white p-2 text-foreground shadow-xl" role="menu" aria-label="방해 이유">
                {FOCUS_REASONS.map((r) => (
                  <button key={r.value} type="button" role="menuitem" onClick={() => interrupt(r.value)} className="block min-h-10 w-full rounded-lg px-3 text-left text-sm hover:bg-pale-green">{r.label}</button>
                ))}
                <button type="button" role="menuitem" onClick={() => interrupt(null)} className="block min-h-10 w-full rounded-lg px-3 text-left text-sm text-muted hover:bg-pale-green">이유 없이 기록</button>
              </div>
            )}
          </div>
        )}
        {state.phase === "break" && (
          <button type="button" onClick={() => setFocus({ ...state, phase: "ready", endsAt: 0 })} className="flex min-h-12 items-center gap-2 rounded-2xl bg-white/10 px-5 text-sm font-semibold hover:bg-white/20">
            <SkipForward size={18} aria-hidden="true" />
            휴식 건너뛰기
          </button>
        )}
        {state.phase === "ready" && (
          <button type="button" onClick={nextFocus} disabled={busy} className="flex min-h-12 items-center gap-2 rounded-2xl bg-white px-6 text-sm font-bold text-primary-dark hover:bg-pale-green disabled:opacity-60">
            {busy ? <LoaderCircle size={18} className="animate-spin" aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
            다음 집중 {state.preset.focus}분
          </button>
        )}
      </div>

      {state.taskId && (
        <div className="mt-8 text-sm text-white/75">
          {timerOn ? (
            <span className="flex items-center gap-1.5"><Timer size={15} aria-hidden="true" />타이머 기록 중</span>
          ) : (
            <button type="button" onClick={() => timer.start(state.taskId!)} disabled={timer.pending} className="flex min-h-11 items-center gap-1.5 rounded-xl px-3 underline-offset-2 hover:underline">
              <Timer size={15} aria-hidden="true" />
              타이머가 꺼져 있어요 — 이 업무 타이머 켜기
            </button>
          )}
          {timerOn && state.phase !== "focus" && (
            <button type="button" onClick={() => timer.stop()} className="mt-1 flex min-h-11 items-center gap-1.5 px-3 text-xs underline-offset-2 hover:underline">
              <Square size={12} fill="currentColor" aria-hidden="true" />
              쉬는 동안 타이머 멈추기
            </button>
          )}
        </div>
      )}
      {error && <p className="mt-3 text-sm text-red-200" role="alert">{error}</p>}
      {timer.dialog}
    </div>
  );
}
