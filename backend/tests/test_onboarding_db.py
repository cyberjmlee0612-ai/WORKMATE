"""처음 사용자 안내 테스트 (RUN_DB_TESTS=1): 새 사용자만 자동 안내, 상태 바꾸기, 단계는 실제 데이터로."""

import os
from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest

from app.api import onboarding as api
from app.api import schedule as schedule_api
from app.api import settings as settings_api
from app.core.auth import CurrentUser
from app.repositories import tasks as task_repo
from app.schemas.task import TaskCreate

pytestmark = pytest.mark.skipif(os.environ.get("RUN_DB_TESTS") != "1", reason="RUN_DB_TESTS=1 일 때만 실행")


def _user(uid: UUID) -> CurrentUser:
    return CurrentUser(id=uid, email=None, claims={})


def test_new_user_flow(db) -> None:
    conn, a, _, as_user = db
    ua = _user(a)
    with as_user(a):
        out = api.get_onboarding(ua, conn)
        assert (out["state"], out["show_wizard"], out["show_checklist"]) == (None, True, False)
        assert out["steps"] == {"schedule": False, "task": False, "plan": False}

        schedule_api.replace_blocks(schedule_api.BlocksReplace(blocks=[
            schedule_api.BlockIn(title="일하는 시간", kind="work", weekdays=[1, 2, 3, 4, 5], start="09:00", end="18:00"),
        ]), ua, conn)
        task = task_repo.create_task(conn, a, TaskCreate(title="첫 업무"))
        start = datetime.now(timezone.utc) + timedelta(hours=1)
        conn.execute("insert into public.task_time_plans (user_id, task_id, starts_at, ends_at) values (%s, %s, %s, %s)", (a, task["id"], start, start + timedelta(hours=1)))
        # 안내 화면을 나가면 체크리스트로
        out = api.set_onboarding(api.StateIn(state="checklist"), ua, conn)
        assert (out["show_wizard"], out["show_checklist"]) == (False, True)
        assert out["steps"] == {"schedule": True, "task": True, "plan": True}
        out = api.set_onboarding(api.StateIn(state="done"), ua, conn)
        assert (out["show_wizard"], out["show_checklist"]) == (False, False)
        # 설정의 표시 이름 저장과 함께 써도 상태가 지워지지 않는다
        settings_api.put_settings(settings_api.SettingsIn(display_name="민"), ua, conn)
        assert api.get_onboarding(ua, conn)["state"] == "done"
        # 다시 보기
        assert api.set_onboarding(api.StateIn(state="wizard"), ua, conn)["show_wizard"] is True


def test_existing_user_not_shown(db) -> None:
    conn, _, b, as_user = db
    with as_user(b):
        task_repo.create_task(conn, b, TaskCreate(title="이미 쓰던 업무"))
        out = api.get_onboarding(_user(b), conn)
        assert (out["state"], out["show_wizard"], out["show_checklist"]) == (None, False, False)
