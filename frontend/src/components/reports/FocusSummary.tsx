"use client";

import { useQuery } from "@tanstack/react-query";
import { focusKeys, getFocusStats, reasonLabel } from "@/lib/api/focus";
import { openFocus } from "@/lib/focus";
import { fmtMinutes } from "./period";

/** 리포트 기간의 집중 모드 통계: 집중 횟수, 끝까지 한 비율, 집중 시간, 방해 이유 (2026-11-27 사용자 확정) */
export function FocusSummary({ start, end, tz }: { start: string; end: string; tz: string }) {
  const query = useQuery({ queryKey: focusKeys.stats(start, end, tz), queryFn: () => getFocusStats(start, end, tz) });
  const s = query.data;
  if (!s) return <div className="h-24 animate-pulse rounded-xl bg-pale-green/40" />;
  if (s.sessions === 0) {
    return (
      <p className="text-sm text-muted">
        이 기간에 집중 모드를 쓰지 않았어요.{" "}
        <button type="button" onClick={() => openFocus()} className="font-semibold text-primary underline-offset-2 hover:underline">집중 모드 시작하기</button>
      </p>
    );
  }
  const max = Math.max(1, ...s.by_reason.map((r) => r.count));
  return (
    <div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="집중" value={`${s.sessions}번`} />
        <Stat label="끝까지 함" value={`${Math.round((s.completed / s.sessions) * 100)}%`} sub={`${s.completed}번`} />
        <Stat label="집중 시간" value={fmtMinutes(s.focus_minutes)} />
        <Stat label="방해" value={`${s.interruptions}번`} sub={`집중 1번에 ${(s.interruptions / s.sessions).toFixed(1)}번`} />
      </dl>
      {s.by_reason.length > 0 && (
        <ul className="mt-4 space-y-1.5" aria-label="방해 이유">
          {s.by_reason.map((r) => (
            <li key={r.reason ?? "none"} className="flex items-center gap-3 text-sm">
              <span className="w-24 shrink-0 text-muted">{reasonLabel(r.reason)}</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-pale-green" aria-hidden="true">
                <span className="block h-full rounded-full bg-amber-500" style={{ width: `${(r.count / max) * 100}%` }} />
              </span>
              <span className="w-10 shrink-0 text-right font-semibold text-primary-dark">{r.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-pale-green/50 px-3 py-2.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-geist text-xl font-bold text-primary-dark">{value}</dd>
      {sub && <dd className="text-xs text-muted">{sub}</dd>}
    </div>
  );
}
