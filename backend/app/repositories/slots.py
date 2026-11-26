"""시간표 빈칸 찾기 (체크인 자동 배치·밀린 계획 다시 짜기 공통).

일할 시간 = 그 요일의 일·공부 시간 블록 (블록을 하나도 정하지 않았으면 09:00–18:00),
피할 시간 = 수업·고정 일정·쉬는 시간 블록 (블록이 없으면 점심 12:00–13:00) + 그날 이미 있는 계획·기록.
시각은 그날 0시부터의 분.
"""

from datetime import date, datetime, time, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from psycopg import Connection
from psycopg.rows import DictRow

from app.ai.day_plan import _busy_intervals
from app.api.schedule import blocks_for_weekday, list_blocks, to_minutes

SNAP = 10
BUFFER = 10  # 자동 배치 블록 사이 여유
DEFAULT_WINDOWS = [(9 * 60, 18 * 60)]
DEFAULT_BLOCKED = [(12 * 60, 13 * 60)]


def day_bounds(day: date, tz: str) -> tuple[datetime, datetime]:
    zone = ZoneInfo(tz)
    return datetime.combine(day, time(0), tzinfo=zone), datetime.combine(day + timedelta(days=1), time(0), tzinfo=zone)


def day_ranges(db: Connection[DictRow], user_id: UUID, day: date) -> tuple[list[tuple[int, int]], list[tuple[int, int]]]:
    """(일할 시간, 피할 시간) — 요일별 반복 블록 기준."""
    if not list_blocks(db, user_id):
        return list(DEFAULT_WINDOWS), list(DEFAULT_BLOCKED)
    blocks = blocks_for_weekday(db, user_id, (day.weekday() + 1) % 7)  # Python 월=0 → 일=0 기준
    windows = [(to_minutes(b["start"]), to_minutes(b["end"])) for b in blocks if b["kind"] == "work"]
    blocked = [(to_minutes(b["start"]), to_minutes(b["end"])) for b in blocks if b["kind"] != "work"]
    return windows, blocked


def not_before_minute(day: date, tz: str) -> int:
    """오늘이면 지금(10분 단위 올림), 지난 날짜면 하루 끝(넣지 않음), 미래면 0."""
    now = datetime.now(ZoneInfo(tz))
    if now.date() == day:
        return -(-(now.hour * 60 + now.minute) // SNAP) * SNAP
    return 24 * 60 if day < now.date() else 0


def free_gaps(windows: list[tuple[int, int]], taken: list[tuple[int, int]], not_before: int) -> list[tuple[int, int]]:
    """일할 시간 구간에서 차지된 시간을 뺀 빈칸 (시작 순, 10분 이상)."""
    gaps: list[tuple[int, int]] = []
    for w0, w1 in sorted(windows):
        cursor = max(w0, not_before)
        for t0, t1 in sorted(taken):
            if t1 <= cursor or t0 >= w1:
                continue
            if t0 > cursor:
                gaps.append((cursor, min(t0, w1)))
            cursor = max(cursor, t1)
        if cursor < w1:
            gaps.append((cursor, w1))
    return [(a, b) for a, b in gaps if b - a >= SNAP]


def taken_ranges(db: Connection[DictRow], user_id: UUID, day: date, tz: str) -> list[tuple[int, int]]:
    """피할 시간 블록 + 그날 이미 있는 계획(다시 배치했거나 놓아준 계획 제외)·기록."""
    start, end = day_bounds(day, tz)
    _, blocked = day_ranges(db, user_id, day)
    return blocked + [(a, b) for a, b, _ in _busy_intervals(db, user_id, start, end)]


def find_slot(db: Connection[DictRow], user_id: UUID, day: date, tz: str, minutes: int) -> int | None:
    """그날 minutes만큼 들어갈 가장 이른 빈칸의 시작(분). 없으면 None."""
    windows, _ = day_ranges(db, user_id, day)
    taken = taken_ranges(db, user_id, day, tz)
    return next((a for a, b in free_gaps(windows, taken, not_before_minute(day, tz)) if b - a >= minutes), None)


def at(day: date, tz: str, minute: int) -> datetime:
    return day_bounds(day, tz)[0] + timedelta(minutes=minute)

