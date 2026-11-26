"""리포트 집계 (2026-11-26 사용자 확정: 주간·월간·직접 기간, 최대 92일).

- 기간은 사용자 시간대의 날짜 [start, end] (end 포함). 경계에 걸친 기록·계획은 기간 안에 든 부분만 센다.
- 진행 중인 타이머는 지금까지 센다.
- 프로젝트별 시간은 하위 프로젝트 시간을 상위로 합산한다(total_*), own_*는 그 프로젝트 자체 업무만.
- 한 요청(트랜잭션) 안에서 모두 조회해 수치가 서로 어긋나지 않게 한다.
"""

from datetime import date, datetime, time, timedelta
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from psycopg import Connection
from psycopg.rows import DictRow

MAX_DAYS = 92
TOP_TASK_LIMIT = 10
ESTIMATE_LIMIT = 20


def _bounds(start: date, end: date, tz: str) -> tuple[datetime, datetime]:
    zone = ZoneInfo(tz)
    return datetime.combine(start, time(0), tzinfo=zone), datetime.combine(end + timedelta(days=1), time(0), tzinfo=zone)


def daily(db: Connection[DictRow], user_id: UUID, start: date, end: date, tz: str) -> list[DictRow]:
    """날짜별 계획·실제 시간(분)과 완료한 업무 수."""
    return db.execute(
        """
        with days as (
          select d::date as day,
                 (d::date::timestamp at time zone %(tz)s) as ds,
                 ((d::date + 1)::timestamp at time zone %(tz)s) as de
          from generate_series(%(s)s::date, %(e)s::date, interval '1 day') d
        )
        select d.day,
          coalesce((
            select floor(sum(extract(epoch from least(coalesce(e.ended_at, now()), d.de) - greatest(e.started_at, d.ds))) / 60)::int
            from public.task_time_entries e
            where e.user_id = %(u)s and e.started_at < d.de and coalesce(e.ended_at, now()) > d.ds
          ), 0) as tracked_minutes,
          coalesce((
            select floor(sum(extract(epoch from least(pl.ends_at, d.de) - greatest(pl.starts_at, d.ds))) / 60)::int
            from public.task_time_plans pl
            where pl.user_id = %(u)s and pl.starts_at < d.de and pl.ends_at > d.ds
          ), 0) as planned_minutes,
          (
            select count(*) from public.tasks t
            where t.user_id = %(u)s and t.status = 'completed' and t.completed_at >= d.ds and t.completed_at < d.de
          )::int as completed_tasks
        from days d
        order by d.day
        """,
        {"u": user_id, "s": start, "e": end, "tz": tz},
    ).fetchall()


def _due_stats(db: Connection[DictRow], user_id: UUID, start: date, end: date, tz: str, today: date) -> DictRow:
    """마감일이 기간 안인 업무(제외 빼고) 중 결과가 정해진 것(완료했거나 마감일이 지난 것)의 마감 지킴."""
    row = db.execute(
        """
        select
          count(*) filter (where status = 'completed' or due_date < %(today)s)::int as due_settled,
          count(*) filter (where status = 'completed' and (completed_at at time zone %(tz)s)::date <= due_date)::int as due_on_time,
          count(*) filter (where status <> 'completed' and due_date < %(today)s)::int as due_overdue
        from public.tasks
        where user_id = %(u)s and status <> 'cancelled' and due_date between %(s)s and %(e)s
        """,
        {"u": user_id, "s": start, "e": end, "tz": tz, "today": today},
    ).fetchone()
    assert row is not None
    return row


def _task_times(db: Connection[DictRow], user_id: UUID, rs: datetime, re: datetime) -> list[DictRow]:
    """기간 안에 기록이나 계획이 있는 업무별 초 단위 합계 (경계는 잘라서)."""
    return db.execute(
        """
        with ent as (
          select e.task_id, sum(extract(epoch from least(coalesce(e.ended_at, now()), %(re)s) - greatest(e.started_at, %(rs)s))) as secs
          from public.task_time_entries e
          where e.user_id = %(u)s and e.started_at < %(re)s and coalesce(e.ended_at, now()) > %(rs)s
          group by e.task_id
        ), pl as (
          select p.task_id, sum(extract(epoch from least(p.ends_at, %(re)s) - greatest(p.starts_at, %(rs)s))) as secs
          from public.task_time_plans p
          where p.user_id = %(u)s and p.starts_at < %(re)s and p.ends_at > %(rs)s
          group by p.task_id
        )
        select t.id, t.title, t.status, t.project_id,
               coalesce(ent.secs, 0)::float as tracked_secs, coalesce(pl.secs, 0)::float as planned_secs
        from public.tasks t
        left join ent on ent.task_id = t.id
        left join pl on pl.task_id = t.id
        where t.user_id = %(u)s and (ent.task_id is not null or pl.task_id is not null)
        """,
        {"u": user_id, "rs": rs, "re": re},
    ).fetchall()


def _projects(db: Connection[DictRow], user_id: UUID) -> dict[UUID, DictRow]:
    rows = db.execute("select id, name, parent_id, status from public.projects where user_id = %s", (user_id,)).fetchall()
    return {r["id"]: r for r in rows}


def _path(projects: dict[UUID, DictRow], project_id: UUID | None) -> str | None:
    names: list[str] = []
    current = projects.get(project_id) if project_id else None
    while current is not None and len(names) < 3:
        names.append(current["name"])
        current = projects.get(current["parent_id"]) if current["parent_id"] else None
    return " › ".join(reversed(names)) or None


def _minutes(secs: float) -> int:
    return int(secs // 60)


def _summary(db: Connection[DictRow], user_id: UUID, start: date, end: date, tz: str, today: date) -> dict[str, Any]:
    days = daily(db, user_id, start, end, tz)
    due = _due_stats(db, user_id, start, end, tz, today)
    return {
        "tracked_minutes": sum(d["tracked_minutes"] for d in days),
        "planned_minutes": sum(d["planned_minutes"] for d in days),
        "completed_tasks": sum(d["completed_tasks"] for d in days),
        "active_days": sum(1 for d in days if d["tracked_minutes"] > 0),
        **due,
    }, days


def _estimates(db: Connection[DictRow], user_id: UUID, rs: datetime, re: datetime, projects: dict[UUID, DictRow]) -> dict[str, Any]:
    """기간 안에 완료한 업무 중 예상 시간이 있는 것: 예상 vs 실제(전체 기록, 끝난 기록만)."""
    rows = db.execute(
        """
        select t.id, t.title, t.project_id, t.estimated_minutes,
          coalesce((
            select floor(sum(extract(epoch from e.ended_at - e.started_at)) / 60)::int
            from public.task_time_entries e
            where e.task_id = t.id and e.user_id = t.user_id and e.ended_at is not null
          ), 0) as tracked_minutes
        from public.tasks t
        where t.user_id = %(u)s and t.status = 'completed' and t.estimated_minutes is not null
          and t.completed_at >= %(rs)s and t.completed_at < %(re)s
        """,
        {"u": user_id, "rs": rs, "re": re},
    ).fetchall()
    measured = [r for r in rows if r["tracked_minutes"] > 0]
    measured.sort(key=lambda r: (-abs(r["tracked_minutes"] - r["estimated_minutes"]), r["title"]))
    est_total = sum(r["estimated_minutes"] for r in measured)
    tracked_total = sum(r["tracked_minutes"] for r in measured)
    return {
        "items": [
            {
                "task_id": r["id"],
                "title": r["title"],
                "project_path": _path(projects, r["project_id"]),
                "estimated_minutes": r["estimated_minutes"],
                "tracked_minutes": r["tracked_minutes"],
            }
            for r in measured[:ESTIMATE_LIMIT]
        ],
        "measured_count": len(measured),
        "unmeasured_count": len(rows) - len(measured),  # 완료했지만 시간 기록이 없는 업무
        "estimated_total": est_total,
        "tracked_total": tracked_total,
    }


def get_report(db: Connection[DictRow], user_id: UUID, start: date, end: date, tz: str, today: date) -> dict[str, Any]:
    rs, re = _bounds(start, end, tz)
    length = (end - start).days + 1
    prev_start, prev_end = start - timedelta(days=length), start - timedelta(days=1)

    summary, days = _summary(db, user_id, start, end, tz, today)
    previous, _ = _summary(db, user_id, prev_start, prev_end, tz, today)

    projects = _projects(db, user_id)
    tasks = _task_times(db, user_id, rs, re)

    # 프로젝트별: 자기 업무(own) + 하위 합산(total). 개인 업무는 따로.
    own: dict[UUID, list[float]] = {}
    personal = [0.0, 0.0]
    for t in tasks:
        bucket = own.setdefault(t["project_id"], [0.0, 0.0]) if t["project_id"] else personal
        bucket[0] += t["tracked_secs"]
        bucket[1] += t["planned_secs"]
    total: dict[UUID, list[float]] = {}
    for pid, (tracked, planned) in own.items():
        current, depth = pid, 0
        while current is not None and current in projects and depth < 5:
            acc = total.setdefault(current, [0.0, 0.0])
            acc[0] += tracked
            acc[1] += planned
            current, depth = projects[current]["parent_id"], depth + 1
    project_rows = [
        {
            "id": pid,
            "name": projects[pid]["name"],
            "parent_id": projects[pid]["parent_id"] if projects[pid]["parent_id"] in total else None,
            "status": projects[pid]["status"],
            "own_tracked_minutes": _minutes(own.get(pid, [0.0, 0.0])[0]),
            "own_planned_minutes": _minutes(own.get(pid, [0.0, 0.0])[1]),
            "tracked_minutes": _minutes(acc[0]),
            "planned_minutes": _minutes(acc[1]),
        }
        for pid, acc in total.items()
    ]
    project_rows.sort(key=lambda r: (-r["tracked_minutes"], -r["planned_minutes"], r["name"]))

    top = sorted((t for t in tasks if t["tracked_secs"] >= 60), key=lambda t: -t["tracked_secs"])[:TOP_TASK_LIMIT]

    return {
        "start": start,
        "end": end,
        "previous": {"start": prev_start, "end": prev_end, **previous},
        "summary": summary,
        "daily": days,
        "projects": project_rows,
        "personal": {"tracked_minutes": _minutes(personal[0]), "planned_minutes": _minutes(personal[1])},
        "top_tasks": [
            {
                "task_id": t["id"],
                "title": t["title"],
                "status": t["status"],
                "project_path": _path(projects, t["project_id"]),
                "tracked_minutes": _minutes(t["tracked_secs"]),
                "planned_minutes": _minutes(t["planned_secs"]),
            }
            for t in top
        ],
        "estimates": _estimates(db, user_id, rs, re, projects),
    }
