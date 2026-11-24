"""실제 Supabase DB에서 대시보드 KPI·오늘의 업무 규칙을 확인하는 통합 테스트.

db fixture는 tests/conftest.py (트랜잭션 안에서 실행 후 롤백).
실행: RUN_DB_TESTS=1 pytest tests/test_dashboard_db.py
"""

import os
from datetime import timedelta

import pytest

from app.repositories import dashboard as repo
from app.repositories import projects as project_repo
from app.repositories import tasks as task_repo
from app.schemas.project import ProjectCreate
from app.schemas.task import TaskCreate

pytestmark = pytest.mark.skipif(os.environ.get("RUN_DB_TESTS") != "1", reason="RUN_DB_TESTS=1 일 때만 실행")


def _today(conn, tz: str = "UTC"):
    return conn.execute("select (now() at time zone %s)::date as d", (tz,)).fetchone()["d"]


def test_kpi_rules(db) -> None:
    conn, a, b, as_user = db
    with as_user(a):
        p1 = project_repo.create_project(conn, a, ProjectCreate(name="진행"))
        p2 = project_repo.create_project(conn, a, ProjectCreate(name="보관 예정"))
        project_repo.create_project(conn, a, ProjectCreate(name="완료 예정"))
        # completed/archived는 폼으로 만들 수 없으므로 직접 바꾼다
        conn.execute("update public.projects set status = 'archived' where id = %s", (p2["id"],))
        conn.execute("update public.projects set status = 'completed' where name = '완료 예정' and user_id = %s", (a,))
        task_repo.create_task(conn, a, TaskCreate(title="1", project_id=p1["id"], status="completed"))
        task_repo.create_task(conn, a, TaskCreate(title="2", project_id=p1["id"]))
        task_repo.create_task(conn, a, TaskCreate(title="개인", status="completed"))
        dropped = task_repo.create_task(conn, a, TaskCreate(title="제외", project_id=p1["id"]))
        conn.execute("update public.tasks set status = 'cancelled' where id = %s", (dropped["id"],))
        kpi = repo.get_kpi(conn, a)
    assert kpi["total_projects"] == 2  # 보관 제외 (진행 + 완료)
    assert kpi["active_projects"] == 1
    assert kpi["total_tasks"] == 3  # 개인 업무 포함, 제외한 업무는 빠짐
    assert kpi["completed_tasks"] == 2
    assert kpi["progress"] == 66  # 2/3 → 66 (내림)

    with as_user(b):
        assert repo.get_kpi(conn, b) == {"total_projects": 0, "active_projects": 0, "total_tasks": 0, "completed_tasks": 0, "progress": 0}


def test_today_tasks_selection(db) -> None:
    conn, a, b, as_user = db
    with as_user(a):
        today = _today(conn)
        make = lambda **kw: task_repo.create_task(conn, a, TaskCreate(**kw))  # noqa: E731
        make(title="지연", due_date=today - timedelta(days=3))
        make(title="오늘 마감", due_date=today)
        make(title="내일 마감", due_date=today + timedelta(days=1))
        make(title="마감 없음")
        dropped = make(title="오늘 마감이지만 제외", due_date=today)
        conn.execute("update public.tasks set status = 'cancelled' where id = %s", (dropped["id"],))
        make(title="오늘 완료", due_date=today, status="completed")
        old = make(title="어제 완료", due_date=today - timedelta(days=1), status="completed")
        conn.execute("update public.tasks set completed_at = now() - interval '1 day' where id = %s", (old["id"],))
        rows, more = repo.list_today_tasks(conn, a, today, "UTC")
    assert [r["title"] for r in rows] == ["지연", "오늘 마감", "오늘 완료"]
    assert more is False

    with as_user(b):
        assert repo.list_today_tasks(conn, b, today, "UTC") == ([], False)


def test_completed_today_uses_user_timezone(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        today_seoul = _today(conn, "Asia/Seoul")
        task = task_repo.create_task(conn, a, TaskCreate(title="t", due_date=today_seoul, status="completed"))
        # 서울 기준 '오늘 0시 직후'에 완료 = UTC로는 전날 15시대
        conn.execute(
            "update public.tasks set completed_at = (%s::date::timestamp at time zone 'Asia/Seoul') + interval '1 minute' where id = %s",
            (today_seoul, task["id"]),
        )
        seoul_rows, _ = repo.list_today_tasks(conn, a, today_seoul, "Asia/Seoul")
    assert [r["id"] for r in seoul_rows] == [task["id"]]


def test_today_limit(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        today = _today(conn)
        for i in range(repo.TODAY_TASK_LIMIT + 1):
            task_repo.create_task(conn, a, TaskCreate(title=f"t{i}", due_date=today))
        rows, more = repo.list_today_tasks(conn, a, today, "UTC")
    assert len(rows) == repo.TODAY_TASK_LIMIT and more is True


def test_dashboard_projects_active_only_and_limited(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        for i in range(repo.DASHBOARD_PROJECT_LIMIT + 2):
            project_repo.create_project(conn, a, ProjectCreate(name=f"p{i}"))
        conn.execute("update public.projects set status = 'completed' where name = 'p0' and user_id = %s", (a,))
        rows = repo.list_dashboard_projects(conn, a)
    assert len(rows) == repo.DASHBOARD_PROJECT_LIMIT
    assert all(r["status"] in repo.ACTIVE_PROJECT_STATUSES for r in rows)
