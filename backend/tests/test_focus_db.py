"""집중 모드 테스트 (RUN_DB_TESTS=1): 시작·끝·방해·통계, 끝나지 않은 집중 정리, 격리."""

import os
from datetime import datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

import pytest
from fastapi import HTTPException

from app.api import focus as api
from app.core.auth import CurrentUser
from app.core.errors import FieldError
from app.repositories import tasks as task_repo
from app.schemas.task import TaskCreate

pytestmark = pytest.mark.skipif(os.environ.get("RUN_DB_TESTS") != "1", reason="RUN_DB_TESTS=1 일 때만 실행")
TZ = "Asia/Seoul"


def _user(uid: UUID) -> CurrentUser:
    return CurrentUser(id=uid, email=None, claims={})


def test_focus_flow_and_stats(db) -> None:
    conn, a, b, as_user = db
    ua = _user(a)
    today = datetime.now(ZoneInfo(TZ)).date()
    with as_user(a):
        task = task_repo.create_task(conn, a, TaskCreate(title="보고서"))
        first = api.start_session(api.StartIn(task_id=task["id"], focus_minutes=25), ua, conn)
        assert (first["task_id"], first["focus_minutes"], first["ended_at"], first["interruptions"]) == (task["id"], 25, None, 0)
        api.add_interruption(first["id"], api.InterruptIn(reason="message"), ua, conn)
        out = api.add_interruption(first["id"], api.InterruptIn(), ua, conn)
        assert out["interruptions"] == 2

        # 25분 전에 시작한 것처럼 바꾸고 완주로 끝낸다
        conn.execute("update public.focus_sessions set started_at = now() - interval '25 minutes' where id = %s", (first["id"],))
        done = api.finish_session(first["id"], api.FinishIn(completed=True), ua, conn)
        assert done["completed"] is True and done["ended_at"] is not None
        with pytest.raises(HTTPException) as err:  # 두 번 끝낼 수 없다
            api.finish_session(first["id"], api.FinishIn(completed=True), ua, conn)
        assert err.value.status_code == 409
        with pytest.raises(HTTPException):  # 끝난 집중에는 방해를 기록할 수 없다
            api.add_interruption(first["id"], api.InterruptIn(reason="call"), ua, conn)

        # 끝내지 않은 집중은 다음 집중을 시작할 때 '그만둠'으로 닫힌다 (예정 시간까지만)
        second = api.start_session(api.StartIn(focus_minutes=50), ua, conn)
        conn.execute("update public.focus_sessions set started_at = now() - interval '3 hours' where id = %s", (second["id"],))
        api.add_interruption(second["id"], api.InterruptIn(reason="message"), ua, conn)
        third = api.start_session(api.StartIn(focus_minutes=25), ua, conn)
        closed = api._get(conn, a, second["id"])
        assert closed["completed"] is False and closed["ended_at"] - closed["started_at"] == timedelta(minutes=50)

        stats = api.get_stats(ua, conn, start=today - timedelta(days=1), end=today, tz=TZ)
        assert (stats["sessions"], stats["completed"], stats["interruptions"]) == (3, 1, 3)
        assert stats["focus_minutes"] == 25 + 50  # 진행 중인 세 번째는 방금 시작
        assert stats["by_reason"][0] == {"reason": "message", "count": 2}

        with pytest.raises(FieldError):
            api.start_session(api.StartIn(task_id=UUID(int=7)), ua, conn)

        # 업무를 지워도 집중 기록은 남는다
        task_repo.delete_task(conn, a, task["id"])
        assert api._get(conn, a, first["id"])["task_id"] is None
        assert third["id"]

    with as_user(b):
        with pytest.raises(HTTPException) as err:
            api.add_interruption(third["id"], api.InterruptIn(), _user(b), conn)
        assert err.value.status_code == 404
        assert api.get_stats(_user(b), conn, start=today, end=today, tz=TZ)["sessions"] == 0


def test_validation() -> None:
    with pytest.raises(ValueError):
        api.StartIn(focus_minutes=3)
    with pytest.raises(ValueError):
        api.InterruptIn(reason="boss")
