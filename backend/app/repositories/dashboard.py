"""대시보드 집계. 한 트랜잭션(요청) 안에서 모두 조회해 KPI·목록 수치가 서로 어긋나지 않게 한다."""

from datetime import date, timedelta
from typing import Any
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow

# 목록 쿼리는 각 저장소와 같은 SELECT/정렬을 재사용해 표시 규칙(진행률 계산 등)을 한곳에서 관리한다
from app.repositories.projects import _SELECT_WITH_PROGRESS as PROJECT_SELECT
from app.repositories.tasks import _ORDER as TASK_ORDER
from app.repositories.tasks import _SELECT as TASK_SELECT

DASHBOARD_PROJECT_LIMIT = 6
TODAY_TASK_LIMIT = 20
ACTIVE_PROJECT_STATUSES = ("planning", "in_progress", "review")


def get_kpi(db: Connection[DictRow], user_id: UUID) -> dict[str, Any]:
    # 제외(cancelled)한 업무는 전체 업무·완료·진행률 계산에서 모두 빠진다 (PRD)
    row = db.execute(
        """
        select
          (select count(*) from public.projects where user_id = %(u)s and status <> 'archived')::int as total_projects,
          (select count(*) from public.projects where user_id = %(u)s and status = any(%(active)s))::int as active_projects,
          (select count(*) from public.tasks where user_id = %(u)s and status <> 'cancelled')::int as total_tasks,
          (select count(*) from public.tasks where user_id = %(u)s and status = 'completed')::int as completed_tasks
        """,
        {"u": user_id, "active": list(ACTIVE_PROJECT_STATUSES)},
    ).fetchone()
    assert row is not None
    total, completed = row["total_tasks"], row["completed_tasks"]
    return {**row, "progress": completed * 100 // total if total else 0}


def list_dashboard_projects(db: Connection[DictRow], user_id: UUID) -> list[DictRow]:
    # 진행 중인 프로젝트 중 '상위가 진행 중이 아닌 것'만 (하위는 상위 카드의 합산 진행률에 들어가므로 중복 표시하지 않는다)
    return db.execute(
        PROJECT_SELECT
        + """ where p.user_id = %(u)s and p.status = any(%(active)s)
              and (pp.id is null or not (pp.status = any(%(active)s)))
              order by p.updated_at desc, p.created_at desc limit %(limit)s""",
        {"u": user_id, "active": list(ACTIVE_PROJECT_STATUSES), "limit": DASHBOARD_PROJECT_LIMIT},
    ).fetchall()


def list_today_tasks(db: Connection[DictRow], user_id: UUID, today: date, tz: str) -> tuple[list[DictRow], bool]:
    """오늘의 업무 = 마감일이 오늘이거나 지난 미완료 업무 + (마감일이 오늘 이하이면서) 오늘 완료한 업무. 제외한 업무는 빠진다.

    '오늘'과 '오늘 완료'는 사용자의 날짜·시간대 기준이다 (서버는 UTC).
    """
    rows = db.execute(
        TASK_SELECT
        + """
        where t.user_id = %(u)s
          and t.due_date is not null
          and t.due_date <= %(today)s
          and t.status <> 'cancelled'
          and (
            t.status <> 'completed'
            or (t.completed_at at time zone %(tz)s)::date = %(today)s
          )
        """
        + TASK_ORDER
        + " limit %(limit)s",
        {"u": user_id, "today": today, "tz": tz, "limit": TODAY_TASK_LIMIT + 1},
    ).fetchall()
    return rows[:TODAY_TASK_LIMIT], len(rows) > TODAY_TASK_LIMIT


UPCOMING_EVENT_DAYS = 60
UPCOMING_EVENT_LIMIT = 5


def today_planned_minutes(db: Connection[DictRow], user_id: UUID, today: date, tz: str) -> int:
    """오늘(사용자 시간대) 시간표에 계획한 시간(분). 경계에 걸친 계획은 오늘 안의 부분만."""
    row = db.execute(
        """
        with d as (select (%(t)s::date::timestamp at time zone %(tz)s) as ds, ((%(t)s::date + 1)::timestamp at time zone %(tz)s) as de)
        select coalesce(floor(sum(extract(epoch from least(p.ends_at, d.de) - greatest(p.starts_at, d.ds))) / 60), 0)::int as minutes
        from public.task_time_plans p, d
        where p.user_id = %(u)s and p.starts_at < d.de and p.ends_at > d.ds
        """,
        {"u": user_id, "t": today, "tz": tz},
    ).fetchone()
    return row["minutes"] if row else 0


def get_dashboard(db: Connection[DictRow], user_id: UUID, today: date, tz: str) -> dict[str, Any]:
    # 브리핑용 (2026-11-26 사용자 확정: 내 데이터로 만드는 오늘 브리핑 + 응원 문구)
    from app.api.events import list_events
    from app.api.schedule import blocks_for_weekday

    today_tasks, has_more = list_today_tasks(db, user_id, today, tz)
    return {
        "upcoming_events": list_events(db, user_id, start=today, end=today + timedelta(days=UPCOMING_EVENT_DAYS), limit=UPCOMING_EVENT_LIMIT),
        "today_planned_minutes": today_planned_minutes(db, user_id, today, tz),
        "today_schedule": blocks_for_weekday(db, user_id, (today.weekday() + 1) % 7),  # Python 월=0 → 일=0 기준
        "today": today,
        "kpi": get_kpi(db, user_id),
        "projects": list_dashboard_projects(db, user_id),
        "today_tasks": today_tasks,
        "today_has_more": has_more,
    }
