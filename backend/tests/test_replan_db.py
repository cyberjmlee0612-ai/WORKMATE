"""밀린 계획 다시 짜기 테스트 (RUN_DB_TESTS=1).

- 밀린 계획 판정: 끝남·최근 7일·미처리·업무 미완료·기록이 계획의 절반 미만
- 처리: 놓아주기 / 실제로 했어요(기록으로) / 오늘·내일 빈칸에 다시(원래 블록은 '놓침'으로 남음)
"""

import os
from datetime import datetime, timedelta, timezone
from uuid import UUID
from zoneinfo import ZoneInfo

import pytest
from fastapi import HTTPException

from app.api import schedule as schedule_api
from app.api import time_plans as api
from app.core.auth import CurrentUser
from app.core.errors import ConflictError
from app.repositories import tasks as task_repo
from app.repositories import time_plans as repo
from app.schemas.task import TaskCreate, TaskUpdate

pytestmark = pytest.mark.skipif(os.environ.get("RUN_DB_TESTS") != "1", reason="RUN_DB_TESTS=1 일 때만 실행")
TZ = "Asia/Seoul"


def _user(uid: UUID) -> CurrentUser:
    return CurrentUser(id=uid, email=None, claims={})


def _plan(conn, user, task_id, start, minutes=60):
    return conn.execute(
        "insert into public.task_time_plans (user_id, task_id, starts_at, ends_at) values (%s, %s, %s, %s) returning id",
        (user, task_id, start, start + timedelta(minutes=minutes)),
    ).fetchone()["id"]


def _entry(conn, user, task_id, start, minutes):
    conn.execute(
        "insert into public.task_time_entries (user_id, task_id, started_at, ended_at, source) values (%s, %s, %s, %s, 'manual')",
        (user, task_id, start, start + timedelta(minutes=minutes)),
    )


def test_missed_detection(db) -> None:
    conn, a, b, as_user = db
    now = datetime.now(timezone.utc).replace(microsecond=0)
    with as_user(a):
        mk = lambda title: task_repo.create_task(conn, a, TaskCreate(title=title))  # noqa: E731
        none, little, enough, finished, old, future = (mk(t) for t in ("기록 없음", "조금", "충분", "완료", "오래됨", "아직"))
        p_none = _plan(conn, a, none["id"], now - timedelta(hours=3))
        p_little = _plan(conn, a, little["id"], now - timedelta(hours=5))
        _entry(conn, a, little["id"], now - timedelta(hours=5), 20)  # 60분 중 20분 → 밀림
        _plan(conn, a, enough["id"], now - timedelta(hours=7))
        _entry(conn, a, enough["id"], now - timedelta(hours=7, minutes=10), 40)  # 계획 안 30분 → 절반 → 밀리지 않음
        _plan(conn, a, finished["id"], now - timedelta(hours=9))
        task_repo.update_task(conn, a, finished["id"], TaskUpdate(status="completed"))
        _plan(conn, a, old["id"], now - timedelta(days=8))
        _plan(conn, a, future["id"], now + timedelta(hours=1))

        missed = repo.list_missed(conn, a)
        assert [m["task_title"] for m in missed] == ["조금", "기록 없음"]  # 오래된 순
        assert {p["id"]: p["missed"] for p in repo.list_plans(conn, a, start=now - timedelta(days=1), end=now + timedelta(days=1))}[p_none] is True
        assert p_little in {m["id"] for m in missed}
    with as_user(b):
        assert repo.list_missed(conn, b) == []


def test_resolve_actions(db) -> None:
    conn, a, b, as_user = db
    ua = _user(a)
    now = datetime.now(timezone.utc).replace(microsecond=0)
    with as_user(a):
        # 매일 06:00–23:50 일·공부 시간 → 내일 빈칸은 06:00부터
        schedule_api.replace_blocks(schedule_api.BlocksReplace(blocks=[
            schedule_api.BlockIn(title="공부", kind="work", weekdays=list(range(7)), start="06:00", end="23:50"),
        ]), ua, conn)
        task = task_repo.create_task(conn, a, TaskCreate(title="보고서", estimated_minutes=120))
        p1 = _plan(conn, a, task["id"], now - timedelta(hours=4), 50)
        p2 = _plan(conn, a, task["id"], now - timedelta(hours=10), 30)
        p3 = _plan(conn, a, task["id"], now - timedelta(hours=20), 30)
        pending = _plan(conn, a, task["id"], now + timedelta(hours=2), 30)
        assert task_repo.get_task(conn, a, task["id"])["planned_minutes"] == 140

        out = api.resolve_plan(p1, api.ResolveIn(action="tomorrow", tz=TZ), ua, conn)
        new = out["new_plan"]
        local = new["starts_at"].astimezone(ZoneInfo(TZ))
        assert (local.hour, local.minute) == (6, 0) and new["ends_at"] - new["starts_at"] == timedelta(minutes=50)
        assert (out["plan"]["resolution"], out["plan"]["missed"]) == ("rescheduled", False)
        # 원래 블록은 남지만 업무의 계획 합계에서는 빠지고 새 블록이 더해진다
        assert task_repo.get_task(conn, a, task["id"])["planned_minutes"] == 140

        out = api.resolve_plan(p2, api.ResolveIn(action="done", tz=TZ), ua, conn)
        assert out["plan"]["resolution"] == "done" and out["new_plan"] is None
        assert task_repo.get_task(conn, a, task["id"])["tracked_minutes"] == 30

        out = api.resolve_plan(p3, api.ResolveIn(action="let_go", tz=TZ), ua, conn)
        assert out["plan"]["resolution"] == "let_go"
        assert repo.list_missed(conn, a) == []

        with pytest.raises(ConflictError) as err:
            api.resolve_plan(p3, api.ResolveIn(action="let_go", tz=TZ), ua, conn)
        assert err.value.code == "already_resolved"
        with pytest.raises(ConflictError) as err:
            api.resolve_plan(pending, api.ResolveIn(action="let_go", tz=TZ), ua, conn)
        assert err.value.code == "not_ended"
    with as_user(b):
        with pytest.raises(HTTPException) as http:
            api.resolve_plan(pending, api.ResolveIn(action="let_go", tz=TZ), _user(b), conn)
        assert http.value.status_code == 404


def test_resolve_conflicts(db) -> None:
    conn, a, _, as_user = db
    ua = _user(a)
    now = datetime.now(timezone.utc).replace(microsecond=0)
    with as_user(a):
        # 일·공부 시간이 20분뿐 → 60분 계획은 넣을 빈칸이 없다
        schedule_api.replace_blocks(schedule_api.BlocksReplace(blocks=[
            schedule_api.BlockIn(title="짧음", kind="work", weekdays=list(range(7)), start="06:00", end="06:20"),
        ]), ua, conn)
        task = task_repo.create_task(conn, a, TaskCreate(title="과제"))
        plan = _plan(conn, a, task["id"], now - timedelta(hours=3))
        conn.execute("savepoint s")
        with pytest.raises(ConflictError) as err:
            api.resolve_plan(plan, api.ResolveIn(action="tomorrow", tz=TZ), ua, conn)
        assert err.value.code == "no_slot"
        conn.execute("rollback to savepoint s")

        # 같은 시간에 다른 기록이 있으면 '실제로 했어요'는 겹침으로 막힌다
        other = task_repo.create_task(conn, a, TaskCreate(title="다른 일"))
        _entry(conn, a, other["id"], now - timedelta(hours=3), 30)
        conn.execute("savepoint s2")
        with pytest.raises(ConflictError) as err:
            api.resolve_plan(plan, api.ResolveIn(action="done", tz=TZ), ua, conn)
        assert err.value.code == "overlap"
        conn.execute("rollback to savepoint s2")
        assert repo.get_plan(conn, a, plan)["resolution"] is None
