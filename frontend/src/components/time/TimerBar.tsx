"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Brain, CircleAlert, Info, LoaderCircle, Square, Timer } from "lucide-react";
import { openFocus } from "@/lib/focus";
import { LONG_RUNNING_MS, type TimeEntry } from "@/lib/api/time";
import { formatElapsed, useNowSeconds } from "@/lib/time";
import { useTimerControls } from "./useTimerControls";

/** 진행 중인 타이머 표시줄 (모든 화면 상단). 타이머가 없으면 멈춘 직후 안내만 잠깐 보여준다. */
export function TimerBar() {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { running, offset, stop, pending, dialog } = useTimerControls({ onNotice: setNotice, onError: setError, poll: true });

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(id);
  }, [notice]);

  return (
    <>
      {running ? (
        <RunningBar entry={running} offset={offset} pending={pending} error={error} onStop={stop} />
      ) : (
        notice && (
          <p className="mb-4 flex items-center gap-2 rounded-xl border border-soft-sage bg-pale-green/60 px-4 py-2.5 text-sm text-primary-dark" role="status">
            <Info size={16} strokeWidth={2} className="shrink-0" aria-hidden="true" />
            {notice}
          </p>
        )
      )}
      {dialog}
    </>
  );
}

type BarProps = { entry: TimeEntry; offset: number; pending: boolean; error: string | null; onStop: () => void };

function RunningBar({ entry, offset, pending, error, onStop }: BarProps) {
  const nowSeconds = useNowSeconds();
  const elapsed = nowSeconds === null ? null : nowSeconds * 1000 + offset - Date.parse(entry.started_at);
  const long = elapsed !== null && elapsed >= LONG_RUNNING_MS;
  const href = entry.project_id ? `/projects/${entry.project_id}` : "/tasks";

  return (
    <div
      className={`sticky top-[env(safe-area-inset-top,0px)] z-20 mb-4 rounded-2xl border px-4 py-2.5 shadow-sm backdrop-blur ${long ? "border-amber-300 bg-amber-50/95" : "border-soft-sage bg-pale-green/95"}`}
      role="region"
      aria-label="진행 중인 타이머"
    >
      <div className="flex items-center gap-3">
        <span className="relative flex size-2.5 shrink-0" aria-hidden="true">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
          <span className="relative inline-flex size-2.5 rounded-full bg-primary" />
        </span>
        <Timer size={18} strokeWidth={2} className="hidden shrink-0 text-primary-dark sm:block" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <Link href={href} className="block truncate text-sm font-semibold text-primary-dark hover:underline">{entry.task_title}</Link>
          <p className="truncate text-xs text-muted">{entry.project_name ?? "개인 업무"}{long && " · 12시간 넘게 켜져 있어요"}</p>
        </div>
        {/* 스크린리더가 1초마다 읽지 않도록 aria-live를 두지 않는다 */}
        <span className="font-geist text-lg font-bold tabular-nums text-primary-dark">{elapsed === null ? "--:--" : formatElapsed(elapsed)}</span>
        {/* 이 업무로 집중 모드 (2026-11-27) */}
        <button
          type="button"
          onClick={() => openFocus({ id: entry.task_id, title: entry.task_title })}
          className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-primary/30 bg-surface px-3 text-sm font-semibold text-primary-dark hover:bg-pale-green"
          title="이 업무로 집중 모드"
        >
          <Brain size={16} strokeWidth={2} aria-hidden="true" />
          <span className="hidden sm:inline">집중</span>
          <span className="sr-only sm:hidden">집중 모드</span>
        </button>
        <button
          type="button"
          onClick={onStop}
          disabled={pending}
          aria-busy={pending}
          className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-75"
        >
          {pending ? <LoaderCircle size={16} strokeWidth={2} className="animate-spin" aria-hidden="true" /> : <Square size={14} strokeWidth={2.5} fill="currentColor" aria-hidden="true" />}
          멈춤
        </button>
      </div>
      {error && (
        <p className="mt-2 flex items-center gap-1 text-xs text-red-700" role="alert">
          <CircleAlert size={14} strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}
