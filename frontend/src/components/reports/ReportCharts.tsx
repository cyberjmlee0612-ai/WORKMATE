"use client";

import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ReportDay } from "@/lib/api/reports";
import { dayLabel, fmtMinutes } from "./period";

const PLANNED = "#c7d8ca"; // soft-sage
const TRACKED = "#356b52"; // primary

/** 날짜별 계획 vs 실제 (시간 단위 막대). 표로 보기도 함께 제공한다. */
export function DailyChart({ days }: { days: ReportDay[] }) {
  const weekly = days.length <= 7;
  const data = days.map((d) => ({
    label: dayLabel(d.day, weekly),
    planned: Math.round((d.planned_minutes / 60) * 10) / 10,
    tracked: Math.round((d.tracked_minutes / 60) * 10) / 10,
    raw: d,
  }));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded" style={{ background: PLANNED }} aria-hidden="true" />계획</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded" style={{ background: TRACKED }} aria-hidden="true" />실제</span>
      </div>
      <div className="h-64 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }} barGap={2}>
            <CartesianGrid vertical={false} stroke="#e7e9e5" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#607268" }} tickLine={false} axisLine={{ stroke: "#e7e9e5" }} interval="preserveStartEnd" minTickGap={8} />
            <YAxis tick={{ fontSize: 11, fill: "#607268" }} tickLine={false} axisLine={false} allowDecimals={false} unit="h" width={48} />
            <Tooltip cursor={{ fill: "rgba(231,240,234,0.6)" }} content={<DayTooltip />} />
            <Bar dataKey="planned" name="계획" fill={PLANNED} radius={[4, 4, 0, 0]} maxBarSize={28} />
            <Bar dataKey="tracked" name="실제" fill={TRACKED} radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-3 text-sm">
        <summary className="min-h-11 cursor-pointer content-center text-xs font-semibold text-primary">표로 보기</summary>
        <div className="mt-2 max-h-72 overflow-auto rounded-xl border border-border">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-pale-green text-primary-dark">
              <tr><th className="px-3 py-2 font-semibold">날짜</th><th className="px-3 py-2 font-semibold">계획</th><th className="px-3 py-2 font-semibold">실제</th><th className="px-3 py-2 font-semibold">완료</th></tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.day} className="border-t border-border">
                  <td className="px-3 py-1.5">{dayLabel(d.day, true)}</td>
                  <td className="px-3 py-1.5">{fmtMinutes(d.planned_minutes)}</td>
                  <td className="px-3 py-1.5">{fmtMinutes(d.tracked_minutes)}</td>
                  <td className="px-3 py-1.5">{d.completed_tasks}개</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

type TooltipProps = { active?: boolean; payload?: { payload: { label: string; raw: ReportDay } }[] };

function DayTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const { label, raw } = payload[0].payload;
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2 text-xs shadow-md">
      <p className="font-semibold text-primary-dark">{label}</p>
      <p className="mt-1 text-muted">계획 {fmtMinutes(raw.planned_minutes)}</p>
      <p className="text-primary-dark">실제 {fmtMinutes(raw.tracked_minutes)}</p>
      {raw.completed_tasks > 0 && <p className="text-muted">완료 {raw.completed_tasks}개</p>}
    </div>
  );
}

export type Slice = { key: string; name: string; minutes: number; color: string };

/** 실제 시간 비중 도넛 (최상위 프로젝트 + 개인 업무) */
export function ShareDonut({ slices }: { slices: Slice[] }) {
  const total = slices.reduce((sum, s) => sum + s.minutes, 0);
  return (
    <div className="relative mx-auto size-44 shrink-0" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={slices} dataKey="minutes" nameKey="name" innerRadius="62%" outerRadius="100%" paddingAngle={slices.length > 1 ? 2 : 0} stroke="none" isAnimationActive={false}>
            {slices.map((s) => <Cell key={s.key} fill={s.color} />)}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-[11px] text-muted">실제 합계</span>
        <span className="font-geist text-sm font-bold text-primary-dark">{fmtMinutes(total)}</span>
      </div>
    </div>
  );
}
