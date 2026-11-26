"""실제 Supabase DB에서 계획 블록 규칙을 확인하는 통합 테스트 (트랜잭션 안에서 실행 후 롤백).

실행: RUN_DB_TESTS=1 pytest tests/test_time_plans_db.py
"""

import os
from datetime import datetime, timedelta, timezone

import pytest

from app.core.errors import ConflictError, FieldError
from app.repositories import tasks as task_repo
from app.repositories import time_plans as repo
from app.schemas.task import TaskCreate, TaskUpdate
from app.schemas.time_plan import TimePlanCreate, TimePlanUpdate

pytestmark = pytest.mark.skipif(os.environ.get("RUN_DB_TESTS") != "1", reason="RUN_DB_TESTS=1 일 때만 실행")

T0 = datetime(2026, 11, 30, 1, 0, tzinfo=timezone.utc)  # 서울 10:00


def _plan(conn, user, task_id, start=T0, minutes=60):
    return repo.create_plan(conn, user, TimePlanCreate(task_id=task_id, starts_at=start, ends_at=start + timedelta(minutes=minutes)))


def test_multiple_and_overlapping_plans_allowed(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        task = task_repo.create_task(conn, a, TaskCreate(title="기획서", estimated_minutes=180))
        _plan(conn, a, task["id"])
        _plan(conn, a, task["id"], T0 + timedelta(minutes=30), 90)  # 겹쳐도 허용
        _plan(conn, a, task["id"], T0 + timedelta(days=2), 30)
        assert task_repo.get_task(conn, a, task["id"])["planned_minutes"] == 180
        week = repo.list_plans(conn, a, start=T0 - timedelta(hours=1), end=T0 + timedelta(days=1))
        assert [p["starts_at"] for p in week] == [T0, T0 + timedelta(minutes=30)]
        assert week[0]["task_title"] == "기획서"


def test_range_listing_includes_plans_crossing_boundary(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        task = task_repo.create_task(conn, a, TaskCreate(title="야간"))
        _plan(conn, a, task["id"], T0, 120)
        assert len(repo.list_plans(conn, a, start=T0 + timedelta(hours=1), end=T0 + timedelta(hours=3))) == 1
        assert repo.list_plans(conn, a, start=T0 + timedelta(hours=2), end=T0 + timedelta(hours=3)) == []  # 끝과 맞닿음


def test_move_and_resize_validate_merged_range(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        task = task_repo.create_task(conn, a, TaskCreate(title="업무"))
        plan = _plan(conn, a, task["id"])
        moved = repo.update_plan(conn, a, plan["id"], TimePlanUpdate(starts_at=T0 + timedelta(hours=2), ends_at=T0 + timedelta(hours=3)))
        assert moved["starts_at"] == T0 + timedelta(hours=2)
        resized = repo.update_plan(conn, a, plan["id"], TimePlanUpdate(ends_at=T0 + timedelta(hours=2, minutes=10)))
        assert resized["ends_at"] - resized["starts_at"] == timedelta(minutes=10)
        with pytest.raises(FieldError):  # 10분 미만
            repo.update_plan(conn, a, plan["id"], TimePlanUpdate(ends_at=T0 + timedelta(hours=2, minutes=5)))
        with pytest.raises(FieldError):  # 시작이 끝보다 늦어짐
            repo.update_plan(conn, a, plan["id"], TimePlanUpdate(starts_at=T0 + timedelta(hours=5)))


def test_closed_task_cannot_be_planned_but_existing_plans_stay(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        task = task_repo.create_task(conn, a, TaskCreate(title="업무"))
        plan = _plan(conn, a, task["id"])
        task_repo.update_task(conn, a, task["id"], TaskUpdate(status="completed"))
        with pytest.raises(ConflictError) as exc:
            _plan(conn, a, task["id"], T0 + timedelta(days=1))
        assert exc.value.code == "task_closed"
        assert repo.update_plan(conn, a, plan["id"], TimePlanUpdate(starts_at=T0 + timedelta(minutes=10))) is not None


def test_isolation_between_users(db) -> None:
    conn, a, b, as_user = db
    with as_user(a):
        task = task_repo.create_task(conn, a, TaskCreate(title="업무"))
        plan = _plan(conn, a, task["id"])
    with as_user(b):
        assert repo.list_plans(conn, b, start=T0 - timedelta(days=1), end=T0 + timedelta(days=1)) == []
        assert repo.update_plan(conn, b, plan["id"], TimePlanUpdate(starts_at=T0)) is None
        assert repo.delete_plan(conn, b, plan["id"]) is False
        with pytest.raises(FieldError):
            _plan(conn, b, task["id"])
    with as_user(a):
        assert repo.delete_plan(conn, a, plan["id"]) is True
