"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarCheck2, ChevronRight, CircleCheckBig, Clock, Gauge } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Report, ReportProject } from "@/lib/api/reports";
import { ratioLabel, useCalibration, type CalibrationBucket } from "@/lib/api/estimates";
import { ShareDonut, type Slice } from "./ReportCharts";
import { fmtMinutes } from "./period";

function minutesDelta(current: number, previous: number): string {
  const diff = current - previous;
  if (diff === 0) return "지난 기간과 같아요";
  return `지난 기간보다 ${diff > 0 ? "+" : "−"}${fmtMinutes(Math.abs(diff))}`;
}

function countDelta(current: number, previous: number): string {
  const diff = current - previous;
  if (diff === 0) return "지난 기간과 같아요";
  return `지난 기간보다 ${diff > 0 ? "+" : "−"}${Math.abs(diff)}개`;
}

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "–");

export function SummaryCards({ report }: { report: Report }) {
  const s = report.summary;
  const p = report.previous;
  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-5" aria-label="요약 지표">
      <MetricCard title="실제 기록 시간" icon={Clock} value={fmtMinutes(s.tracked_minutes)} lines={[minutesDelta(s.tracked_minutes, p.tracked_minutes), `기록한 날 ${s.active_days}일`]} />
      <MetricCard
        title="계획 대비 실제"
        icon={Gauge}
        value={pct(s.tracked_minutes, s.planned_minutes)}
        lines={s.planned_minutes > 0 ? [`계획 ${fmtMinutes(s.planned_minutes)} · 실제 ${fmtMinutes(s.tracked_minutes)}`] : ["이 기간에 계획한 시간이 없어요"]}
      />
      <MetricCard title="완료한 업무" icon={CircleCheckBig} value={`${s.completed_tasks}개`} lines={[countDelta(s.completed_tasks, p.completed_tasks)]} />
      <MetricCard
        title="마감 지킴"
        icon={CalendarCheck2}
        value={pct(s.due_on_time, s.due_settled)}
        lines={s.due_settled > 0 ? [`마감일까지 완료 ${s.due_on_time} / ${s.due_settled}개`] : ["이 기간에 마감이 정해진 업무가 없어요"]}
        warning={s.due_overdue > 0 ? `마감 지난 미완료 ${s.due_overdue}개` : undefined}
      />
    </section>
  );
}

function MetricCard({ title, icon: Icon, value, lines, warning }: { title: string; icon: LucideIcon; value: string; lines: string[]; warning?: string }) {
  return (
    <div className="glass-panel rounded-[20px] p-4 md:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted">{title}</p>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-pale-green text-primary-dark"><Icon size={20} strokeWidth={2} aria-hidden="true" /></span>
      </div>
      <p className="font-geist mt-3 text-[26px] font-bold leading-none text-primary-dark">{value}</p>
      {lines.map((line) => <p key={line} className="mt-2 text-xs text-muted">{line}</p>)}
      {warning && <p className="mt-1 text-xs font-semibold text-red-700">{warning}</p>}
    </div>
  );
}

const SLICE_COLORS = ["#244c3b", "#356b52", "#6f9a82", "#8faf9b", "#b5cbbb", "#d6e2d9"];
const PERSONAL_COLOR = "#c9a66b";
const MAX_SLICES = 5;

/** 프로젝트별 시간: 최상위로 합산, 펼치면 하위 (2026-11-26 사용자 확정) */
export function ProjectBreakdown({ report }: { report: Report }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const children = new Map<string, ReportProject[]>();
  for (const p of report.projects) {
    if (p.parent_id) children.set(p.parent_id, [...(children.get(p.parent_id) ?? []), p]);
  }
  const roots = report.projects.filter((p) => p.parent_id === null);
  const personal = report.personal;
  const max = Math.max(1, ...roots.map((r) => r.tracked_minutes), personal.tracked_minutes);

  const tracked = roots.filter((r) => r.tracked_minutes > 0);
  const slices: Slice[] = tracked.slice(0, MAX_SLICES).map((r, i) => ({ key: r.id, name: r.name, minutes: r.tracked_minutes, color: SLICE_COLORS[i] }));
  const rest = tracked.slice(MAX_SLICES).reduce((sum, r) => sum + r.tracked_minutes, 0);
  if (rest > 0) slices.push({ key: "rest", name: "그 밖의 프로젝트", minutes: rest, color: SLICE_COLORS[MAX_SLICES] });
  if (personal.tracked_minutes > 0) slices.push({ key: "personal", name: "개인 업무", minutes: personal.tracked_minutes, color: PERSONAL_COLOR });
  const colorOf = (id: string) => slices.find((s) => s.key === id)?.color ?? SLICE_COLORS[MAX_SLICES];

  if (roots.length === 0 && personal.tracked_minutes === 0 && personal.planned_minutes === 0) {
    return <p className="text-sm text-muted">이 기간에 기록하거나 계획한 업무가 없어요.</p>;
  }

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderRow = (p: ReportProject, depth: number) => {
    const kids = children.get(p.id) ?? [];
    const expanded = open.has(p.id);
    return (
      <li key={p.id}>
        <Row
          depth={depth}
          name={p.name}
          href={`/projects/${p.id}`}
          tracked={p.tracked_minutes}
          planned={p.planned_minutes}
          max={max}
          color={depth === 0 ? colorOf(p.id) : "#8faf9b"}
          expandable={kids.length > 0}
          expanded={expanded}
          onToggle={() => toggle(p.id)}
        />
        {expanded && kids.length > 0 && (
          <ul>
            {p.own_tracked_minutes + p.own_planned_minutes > 0 && (
              <li><Row depth={depth + 1} name="이 프로젝트에 바로 속한 업무" tracked={p.own_tracked_minutes} planned={p.own_planned_minutes} max={max} color="#b5cbbb" muted /></li>
            )}
            {kids.map((k) => renderRow(k, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-5 md:flex-row md:items-start">
      {slices.length > 0 && <ShareDonut slices={slices} />}
      <ul className="min-w-0 flex-1 space-y-1" aria-label="프로젝트별 시간">
        {roots.map((r) => renderRow(r, 0))}
        {(personal.tracked_minutes > 0 || personal.planned_minutes > 0) && (
          <li><Row depth={0} name="개인 업무" tracked={personal.tracked_minutes} planned={personal.planned_minutes} max={max} color={PERSONAL_COLOR} /></li>
        )}
      </ul>
    </div>
  );
}

function Row(props: {
  depth: number; name: string; href?: string; tracked: number; planned: number; max: number; color: string;
  expandable?: boolean; expanded?: boolean; onToggle?: () => void; muted?: boolean;
}) {
  const { depth, name, href, tracked, planned, max, color, expandable, expanded, onToggle, muted } = props;
  return (
    <div className="flex min-h-11 items-center gap-2 rounded-xl px-1 py-1.5 hover:bg-pale-green/40" style={{ paddingLeft: `${depth * 20 + 4}px` }}>
      {expandable ? (
        <button type="button" onClick={onToggle} aria-expanded={expanded} aria-label={`${name} 하위 프로젝트 ${expanded ? "접기" : "펼치기"}`} className="flex size-8 shrink-0 items-center justify-center rounded-lg text-primary-dark hover:bg-pale-green">
          <ChevronRight size={16} strokeWidth={2} className={`transition-transform ${expanded ? "rotate-90" : ""}`} aria-hidden="true" />
        </button>
      ) : (
        <span className="size-8 shrink-0" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          {href ? (
            <Link href={href} className="truncate text-sm font-semibold text-primary-dark hover:underline">{name}</Link>
          ) : (
            <span className={`truncate text-sm ${muted ? "text-muted" : "font-semibold text-primary-dark"}`}>{name}</span>
          )}
          <span className="shrink-0 text-sm font-semibold text-primary-dark">{fmtMinutes(tracked)}</span>
        </div>
        <div className="mt-1 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-pale-green" aria-hidden="true">
            <div className="h-full rounded-full" style={{ width: `${(tracked / max) * 100}%`, background: color }} />
          </div>
          <span className="w-24 shrink-0 text-right text-[11px] text-muted">계획 {fmtMinutes(planned)}</span>
        </div>
      </div>
    </div>
  );
}

export function TopTasks({ report }: { report: Report }) {
  if (report.top_tasks.length === 0) return <p className="text-sm text-muted">이 기간에 시간을 기록한 업무가 없어요.</p>;
  return (
    <ol className="divide-y divide-border">
      {report.top_tasks.map((t, i) => (
        <li key={t.task_id} className="flex items-center gap-3 py-2.5">
          <span className="font-geist w-5 shrink-0 text-center text-sm font-bold text-sage">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <p className={`truncate text-sm font-semibold ${t.status === "completed" ? "text-muted line-through" : "text-primary-dark"}`}>{t.title}</p>
            <p className="truncate text-xs text-muted">{t.project_path ?? "개인 업무"}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-sm font-semibold text-primary-dark">{fmtMinutes(t.tracked_minutes)}</p>
            {t.planned_minutes > 0 && <p className="text-[11px] text-muted">계획 {fmtMinutes(t.planned_minutes)}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * 예상 시간 보정 비율 (기간과 무관하게 최근 60일 기준). 업무 입력 창·AI 나누기·자동 배치가 이 비율로 보정한다.
 */
export function CalibrationSummary() {
  const { data: cal } = useCalibration();
  if (!cal) return null;
  const item = (label: string, b: CalibrationBucket) =>
    b.ratio !== null ? (
      <span><span className="text-muted">{label}</span> <strong className="font-semibold">{ratioLabel(b.ratio)}</strong></span>
    ) : (
      <span className="text-muted">{label} 근거 부족 ({b.samples}/{cal.min_samples}개)</span>
    );
  return (
    <div className="mb-3 rounded-xl border border-border px-3.5 py-2.5 text-sm text-primary-dark">
      <p className="flex items-center gap-1.5 font-semibold"><Gauge size={14} strokeWidth={2} aria-hidden="true" />내 예상 시간 보정 비율 <span className="font-normal text-muted">(최근 {cal.lookback_days}일)</span></p>
      <p className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
        {item("짧은 일(1시간 미만)", cal.short)}
        {item("긴 일(1시간 이상)", cal.long)}
      </p>
      <p className="mt-1 text-xs text-muted">업무를 입력하거나 시간표에 자동 배치할 때 이 비율로 예상 시간을 보정해요. 1에 가까울수록 예상이 정확해요.</p>
    </div>
  );
}

/** 기간 안에 완료한 업무의 예상 vs 실제(전체 기록). 실제/예상이 1.2배 넘으면 '더 걸림', 0.8배 미만이면 '덜 걸림' */
export function Estimates({ report }: { report: Report }) {
  const e = report.estimates;
  if (e.measured_count === 0) {
    return (
      <p className="text-sm text-muted">
        {e.unmeasured_count > 0
          ? `예상 시간을 정한 완료 업무 ${e.unmeasured_count}개가 있지만 시간 기록이 없어 비교할 수 없어요. 타이머로 기록해 보세요.`
          : "이 기간에 예상 시간을 정하고 완료한 업무가 없어요."}
      </p>
    );
  }
  const ratio = e.tracked_total / Math.max(1, e.estimated_total);
  return (
    <div>
      <p className="rounded-xl bg-pale-green/60 px-3.5 py-2.5 text-sm text-primary-dark">
        완료한 {e.measured_count}개 업무: 예상 {fmtMinutes(e.estimated_total)} → 실제 {fmtMinutes(e.tracked_total)}
        <span className="ml-1 font-semibold">({Math.round(ratio * 100)}%)</span>
      </p>
      <ul className="mt-2 divide-y divide-border">
        {e.items.map((item) => {
          const r = item.tracked_minutes / item.estimated_minutes;
          const badge =
            r > 1.2 ? { text: "더 걸림", cls: "bg-amber-50 text-amber-900 border-amber-300" }
            : r < 0.8 ? { text: "덜 걸림", cls: "bg-sky-50 text-sky-900 border-sky-300" }
            : { text: "비슷", cls: "bg-pale-green text-primary-dark border-soft-sage" };
          return (
            <li key={item.task_id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-primary-dark">{item.title}</p>
                <p className="truncate text-xs text-muted">{item.project_path ?? "개인 업무"}</p>
              </div>
              <p className="shrink-0 text-right text-xs text-muted">
                예상 {fmtMinutes(item.estimated_minutes)}<br />
                <span className="text-sm font-semibold text-primary-dark">실제 {fmtMinutes(item.tracked_minutes)}</span>
              </p>
              <span className={`w-16 shrink-0 rounded-lg border px-2 py-1 text-center text-[11px] font-semibold ${badge.cls}`}>{badge.text}</span>
            </li>
          );
        })}
      </ul>
      {e.unmeasured_count > 0 && <p className="mt-2 text-xs text-muted">시간 기록 없이 완료한 업무 {e.unmeasured_count}개는 비교에서 뺐어요.</p>}
    </div>
  );
}
