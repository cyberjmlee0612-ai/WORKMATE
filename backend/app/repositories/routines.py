"""반복 업무 · 습관 (2026-11-27 사용자 확정, 마이그레이션 20261127000000).

반복 규칙: daily / weekly(요일, every_weeks주마다 — 일요일 시작 주) / monthly(month_day일, 없으면 말일) / interval(interval_days일마다).
반복 업무(mode=task): 그날 처음 열 때 그날 것만 만든다(마감일 = 그날). 지난 날 하지 않은 것은 '제외(건너뜀)'로 정리한다.
  시각을 정했으면 그 시간 계획 블록도 함께 만든다.
습관(mode=habit): 체크만 한다. 연속 기록 = 반복 날짜를 거슬러 올라가며 연달아 체크한 횟수 (오늘 아직 안 했으면 어제까지).
"""

import calendar
from datetime import date, timedelta
from typing import Any
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow

from app.api.schedule import to_minutes
from app.repositories import slots

SKIP_REASON = "반복 업무: 그날 하지 않아 건너뜀"
STREAK_LOOKBACK_DAYS = 400
RECENT_DAYS = 7

_COLUMNS = """
  r.id, r.title, r.mode, r.project_id, r.priority, r.estimated_minutes, r.freq, r.weekdays, r.every_weeks,
  r.month_day, r.interval_days, r.start_date, to_char(r.start_time, 'HH24:MI') as start_time,
  to_char(r.end_time, 'HH24:MI') as end_time, r.active, r.created_at,
  nullif(concat_ws(' › ', gp.name, pp.name, p.name), '') as project_path
"""
_FROM = """
from public.routines r
left join public.projects p on p.id = r.project_id and p.user_id = r.user_id
left join public.projects pp on pp.id = p.parent_id and pp.user_id = r.user_id
left join public.projects gp on gp.id = pp.parent_id and gp.user_id = r.user_id
"""


def _sunday_week(day: date) -> int:
    """일요일 시작 주 번호 (기준일로부터)."""
    return day.toordinal() // 7  # ordinal 7의 배수 = 일요일 (0001-01-01은 월요일, ordinal 1)


def occurs(r: dict[str, Any], day: date) -> bool:
    if day < r["start_date"]:
        return False
    freq = r["freq"]
    if freq == "daily":
        return True
    if freq == "weekly":
        weekday = (day.weekday() + 1) % 7  # 일=0
        if not r["weekdays"] & (1 << weekday):
            return False
        return (_sunday_week(day) - _sunday_week(r["start_date"])) % r["every_weeks"] == 0
    if freq == "monthly":
        last = calendar.monthrange(day.year, day.month)[1]
        return day.day == min(r["month_day"], last)
    if freq == "interval":
        return (day - r["start_date"]).days % r["interval_days"] == 0
    return False


def previous_occurrences(r: dict[str, Any], before: date, count: int, lookback: int = STREAK_LOOKBACK_DAYS) -> list[date]:
    """before 이전(포함하지 않음)의 반복 날짜, 가까운 순."""
    out: list[date] = []
    day = before - timedelta(days=1)
    for _ in range(lookback):
        if day < r["start_date"] or len(out) >= count:
            break
        if occurs(r, day):
            out.append(day)
        day -= timedelta(days=1)
    return out


def next_occurrence(r: dict[str, Any], from_day: date, lookback: int = 400) -> date | None:
    day = max(from_day, r["start_date"])
    for _ in range(lookback):
        if occurs(r, day):
            return day
        day += timedelta(days=1)
    return None


def streak(r: dict[str, Any], checked: set[date], today: date) -> int:
    """연달아 체크한 반복 횟수. 오늘이 반복 날인데 아직 안 했으면 어제까지로 센다."""
    count = 0
    if occurs(r, today) and today in checked:
        count = 1
    for day in previous_occurrences(r, today, STREAK_LOOKBACK_DAYS):
        if day not in checked:
            break
        count += 1
    return count


def list_routines(db: Connection[DictRow], user_id: UUID, today: date) -> list[dict[str, Any]]:
    rows = db.execute("select" + _COLUMNS + _FROM + " where r.user_id = %s order by r.active desc, r.start_time nulls last, r.created_at", (user_id,)).fetchall()
    checks: dict[UUID, set[date]] = {}
    for c in db.execute(
        "select routine_id, check_date from public.habit_checks where user_id = %s and check_date >= %s",
        (user_id, today - timedelta(days=STREAK_LOOKBACK_DAYS)),
    ).fetchall():
        checks.setdefault(c["routine_id"], set()).add(c["check_date"])
    out = []
    for r in rows:
        r = dict(r)
        done = checks.get(r["id"], set())
        recent = [today - timedelta(days=i) for i in range(RECENT_DAYS - 1, -1, -1)]
        out.append({
            **r,
            "weekday_list": [d for d in range(7) if (r["weekdays"] or 0) & (1 << d)],
            "occurs_today": r["active"] and occurs(r, today),
            "next_date": next_occurrence(r, today) if r["active"] else None,
            "checked_today": today in done,
            "streak": streak(r, done, today) if r["mode"] == "habit" else 0,
            # 최근 7일: 반복 날이면 체크 여부, 아니면 null
            "recent": [{"date": d, "due": occurs(r, d), "checked": d in done} for d in recent],
        })
    return out


def materialize(db: Connection[DictRow], user_id: UUID, today: date, tz: str) -> dict[str, int]:
    """오늘 반복 업무를 만들고(이미 있으면 그대로), 지난 날 하지 않은 반복 업무는 '건너뜀'으로 정리한다."""
    skipped = db.execute(
        """
        update public.tasks set status = 'cancelled', cancel_reason = %s
        where user_id = %s and routine_id is not null and routine_date < %s and status not in ('completed', 'cancelled')
        returning id
        """,
        (SKIP_REASON, user_id, today),
    ).fetchall()

    created = 0
    routines = db.execute("select" + _COLUMNS + _FROM + " where r.user_id = %s and r.active and r.mode = 'task'", (user_id,)).fetchall()
    for r in routines:
        if not occurs(r, today):
            continue
        row = db.execute(
            """
            insert into public.tasks (user_id, project_id, title, priority, due_date, estimated_minutes, routine_id, routine_date)
            values (%s, %s, %s, %s, %s, %s, %s, %s)
            on conflict (routine_id, routine_date) where routine_id is not null do nothing
            returning id
            """,
            (user_id, r["project_id"], r["title"], r["priority"], today, r["estimated_minutes"], r["id"], today),
        ).fetchone()
        if row is None:
            continue  # 이미 만들었음 (다른 탭·기기)
        created += 1
        if r["start_time"] and r["end_time"]:
            start = to_minutes(r["start_time"])
            end = to_minutes(r["end_time"])
            db.execute(
                "insert into public.task_time_plans (user_id, task_id, starts_at, ends_at) values (%s, %s, %s, %s)",
                (user_id, row["id"], slots.at(today, tz, start), slots.at(today, tz, end)),
            )
    return {"created": created, "skipped": len(skipped)}
