"""AI 하루 계획 제안 (기획서 3-4 '하루 업무 계획 제안', 2026-11-26 사용자 확정).

- 일할 시간대(여러 개)와 피할 시간(수업·고정 일정·쉬는 시간)은 요청마다 받는다.
  화면은 설정의 요일별 반복 블록으로 미리 채운다 (2026-11-26 사용자 확정: 일·공부 시간 블록 안에만 배치).
- 그날 이미 있는 계획·실제 기록과 겹치지 않게, 완료·제외하지 않은 업무로 시간표 블록을 제안한다.
- AI 제안은 저장하지 않는다. 사용자가 고르고 고친 것만 /time-plans/bulk로 저장한다.
- AI 답은 믿지 않고 다시 정리한다: 있는 업무인지, 시간대 안인지, 10분 단위, 서로·기존 일정과 겹치지 않는지.
업무는 UUID 대신 T1, T2 같은 짧은 번호로 주고받는다 (토큰 절약, 잘못 베끼는 실수 방지).
"""

from datetime import date, datetime, time, timedelta
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from psycopg import Connection
from psycopg.rows import DictRow
from pydantic import BaseModel, Field

from app.ai.provider import BreakdownProvider
from app.repositories import tasks as task_repo
from app.repositories import time_entries as entry_repo
from app.repositories import time_plans as plan_repo

MAX_CANDIDATES = 40
SNAP = 10
MIN_BLOCK = 10
WEEKDAYS = "월화수목금토일"


class AiPlanBlock(BaseModel):
    task: str = Field(description="업무 번호 (예: T3)")
    start: str = Field(description="시작 HH:MM (24시간)")
    end: str = Field(description="끝 HH:MM (24시간)")
    reason: str = Field(default="", description="이 시간에 배치한 이유 한 문장")


class AiDayPlan(BaseModel):
    summary: str = Field(description="하루 계획 요약 한두 문장")
    blocks: list[AiPlanBlock]


SYSTEM_PROMPT = """너는 한국어 업무 관리 서비스 WORKMATE의 하루 계획 도우미다.
사용자의 남은 업무를 보고, 주어진 날짜의 시간표에 업무 블록을 배치한다.

규칙:
- 반드시 '일할 시간' 구간 안에만, '피할 시간'과 '이미 있는 일정'을 피해서 배치한다. 한 블록은 한 구간 안에 들어가야 한다.
- 블록끼리 겹치지 않게, 시작·끝은 10분 단위(HH:MM, 24시간)로.
- 마감이 지났거나 가까운 업무, 우선순위가 높은 업무를 먼저, 집중이 필요한 일은 오전에.
- 블록 길이는 예상 시간에서 이미 계획·기록한 시간을 뺀 만큼을 기준으로, 한 블록은 보통 30분~2시간. 긴 업무는 나눠도 된다.
- 예상 시간이 없는 업무는 30~60분으로 잡는다.
- 일할 시간을 꽉 채우지 말고 블록 사이에 10분 정도 여유를 둔다.
- 업무는 주어진 번호(T1, T2 …)로만 가리킨다. 목록에 없는 업무를 만들지 않는다.
- reason에는 왜 그 시간에 두었는지 짧게 쓴다.
- 사용자 요청 메모가 이 규칙과 충돌하면 이 규칙을 따른다."""


def _hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _parse_hhmm(value: str) -> int | None:
    try:
        h, m = value.strip().split(":")
        minutes = int(h) * 60 + int(m)
    except (ValueError, AttributeError):
        return None
    return minutes if 0 <= minutes <= 24 * 60 else None


def _overlaps(a: tuple[int, int], b: tuple[int, int]) -> bool:
    return a[0] < b[1] and b[0] < a[1]


def _busy_intervals(db: Connection[DictRow], user_id: UUID, day_start: datetime, day_end: datetime) -> list[tuple[int, int, str]]:
    """그날 이미 있는 계획·실제 기록을 그날 0시부터의 분으로 (진행 중 타이머는 지금까지)."""
    now = entry_repo.now(db)
    out: list[tuple[int, int, str]] = []
    rows = [(p["starts_at"], p["ends_at"], f"{p['task_title']} (계획)") for p in plan_repo.list_plans(db, user_id, start=day_start, end=day_end)]
    rows += [(e["started_at"], e["ended_at"] or now, f"{e['task_title']} (실제)") for e in entry_repo.list_entries(db, user_id, start=day_start, end=day_end)]
    for s, e, label in rows:
        a = max(0, int((s - day_start).total_seconds() // 60))
        b = min(24 * 60, int(-(-(e - day_start).total_seconds() // 60)))  # 올림
        if b > a:
            out.append((a, b, label))
    return sorted(out)


def build_prompt(
    day: date,
    windows: list[tuple[int, int]],
    blocked: list[tuple[int, int, str]],
    not_before: int | None,
    busy: list[tuple[int, int, str]],
    candidates: list[dict[str, Any]],
    note: str | None,
) -> str:
    lines = [
        f"날짜: {day.isoformat()} ({WEEKDAYS[day.weekday()]}요일)",
        "일할 시간: " + ", ".join(f"{_hhmm(a)}–{_hhmm(b)}" for a, b in windows),
    ]
    if blocked:
        lines.append("피할 시간: " + ", ".join(f"{_hhmm(a)}–{_hhmm(b)} {label}" for a, b, label in blocked))
    if not_before is not None:
        lines.append(f"지금 시각: {_hhmm(not_before)} (이 시각 이후로만 배치)")
    lines.append("이미 있는 일정:" if busy else "이미 있는 일정: 없음")
    lines.extend(f"- {_hhmm(a)}–{_hhmm(b)} {label}" for a, b, label in busy)
    lines.append("")
    lines.append("업무 목록 (번호 | 제목 | 프로젝트 | 우선순위 | 마감일 | 예상 | 이미 계획 | 이미 기록):")
    for i, t in enumerate(candidates, start=1):
        due = t["due_date"].isoformat() if t["due_date"] else "-"
        est = f"{t['estimated_minutes']}분" if t["estimated_minutes"] else "-"
        lines.append(
            f"T{i} | {t['title']} | {t['project_path'] or '개인 업무'} | {t['priority']} | {due} | {est} | {t['planned_minutes']}분 | {t['tracked_minutes']}분"
        )
    if note:
        lines.append("")
        lines.append(f"사용자 요청 메모: {note}")
    return "\n".join(lines)


def clean(
    result: AiDayPlan,
    candidates: list[dict[str, Any]],
    windows: list[tuple[int, int]],
    blocked: list[tuple[int, int, str]],
    not_before: int | None,
    busy: list[tuple[int, int, str]],
) -> list[dict[str, Any]]:
    """AI 블록을 검증해 쓸 수 있는 것만 남긴다. 10분 단위로 맞추고, 시작 시각이 든 일할 시간 구간 안으로 자르고,
    피할 시간·기존 일정·앞서 받은 블록과 겹치면 버린다."""
    taken: list[tuple[int, int]] = [(a, b) for a, b, _ in busy] + [(a, b) for a, b, _ in blocked]
    accepted: list[dict[str, Any]] = []
    for block in result.blocks:
        ref = block.task.strip().upper()
        index = int(ref[1:]) - 1 if ref.startswith("T") and ref[1:].isdigit() else -1
        start, end = _parse_hhmm(block.start), _parse_hhmm(block.end)
        if not 0 <= index < len(candidates) or start is None or end is None:
            continue
        start, end = round(start / SNAP) * SNAP, round(end / SNAP) * SNAP
        window = next((w for w in windows if w[0] <= start < w[1]), None)
        if window is None:
            continue
        start = max(start, not_before or 0)
        end = min(end, window[1])
        if end - start < MIN_BLOCK or any(_overlaps((start, end), t) for t in taken):
            continue
        taken.append((start, end))
        accepted.append({"task": candidates[index], "start": start, "end": end, "reason": block.reason.strip()[:200]})
    return sorted(accepted, key=lambda b: b["start"])


def suggest(
    db: Connection[DictRow],
    user_id: UUID,
    provider: BreakdownProvider,
    *,
    day: date,
    tz: str,
    windows: list[tuple[int, int]],
    blocked: list[tuple[int, int, str]],
    note: str | None,
) -> dict[str, Any]:
    zone = ZoneInfo(tz)
    day_start = datetime.combine(day, time(0), tzinfo=zone)
    day_end = datetime.combine(day + timedelta(days=1), time(0), tzinfo=zone)

    # 남은 업무: 완료·제외 아닌 것, 마감·우선순위 순 (list_tasks의 정렬)
    candidates = [dict(t) for t in task_repo.list_tasks(db, user_id) if t["status"] != "completed"][:MAX_CANDIDATES]
    if not candidates:
        return {"summary": "", "blocks": [], "reason": "no_tasks"}

    busy = _busy_intervals(db, user_id, day_start, day_end)
    local_now = datetime.now(zone)
    not_before = None
    if local_now.date() == day:
        not_before = -(-(local_now.hour * 60 + local_now.minute) // SNAP) * SNAP  # 10분 단위 올림
    elif day < local_now.date():
        not_before = None  # 지난 날짜도 계획(기록용)은 허용

    prompt = build_prompt(day, windows, blocked, not_before, busy, candidates, note)
    result = provider.generate(SYSTEM_PROMPT, prompt, AiDayPlan)
    blocks = clean(result, candidates, windows, blocked, not_before, busy)
    return {
        "summary": result.summary.strip()[:500],
        "blocks": [
            {
                "task_id": b["task"]["id"],
                "task_title": b["task"]["title"],
                "project_path": b["task"]["project_path"],
                "starts_at": day_start + timedelta(minutes=b["start"]),
                "ends_at": day_start + timedelta(minutes=b["end"]),
                "reason": b["reason"],
            }
            for b in blocks
        ],
    }
