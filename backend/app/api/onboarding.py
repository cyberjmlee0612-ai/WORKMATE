"""처음 사용자 안내 API (2026-11-27 사용자 확정).

GET  /onboarding          단계 완료 여부(실제 데이터 기준)와 안내 화면·체크리스트를 보여 줄지
POST /onboarding {state}  wizard(다시 보기) / checklist(안내 화면 나감) / done(끝냄·닫음)

새 사용자(업무·시간표가 하나도 없고 상태가 정해지지 않음)에게만 자동으로 안내 화면을 보여 준다.
이미 쓰고 있는 계정은 보여 주지 않고, 설정의 '시작 안내 다시 보기'로만 연다.
"""

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict

from app.core.auth import CurrentUserDep
from app.db import UserDbDep

router = APIRouter(prefix="/onboarding", tags=["onboarding"])


class Steps(BaseModel):
    schedule: bool  # 요일별 시간표 블록이 있다
    task: bool  # 업무가 하나라도 있다
    plan: bool  # 시간표에 계획 블록이 있다


class OnboardingOut(BaseModel):
    state: Literal["wizard", "checklist", "done"] | None
    steps: Steps
    show_wizard: bool
    show_checklist: bool


class StateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    state: Literal["wizard", "checklist", "done"]


def _read(db, user_id) -> dict:
    row = db.execute(
        """
        select
          (select onboarding_state from public.user_settings where user_id = %(u)s) as state,
          exists (select 1 from public.schedule_blocks where user_id = %(u)s) as schedule,
          exists (select 1 from public.tasks where user_id = %(u)s) as task,
          exists (select 1 from public.task_time_plans where user_id = %(u)s) as plan
        """,
        {"u": user_id},
    ).fetchone()
    steps = {"schedule": row["schedule"], "task": row["task"], "plan": row["plan"]}
    state = row["state"]
    new_user = state is None and not row["schedule"] and not row["task"]
    return {
        "state": state,
        "steps": steps,
        "show_wizard": state == "wizard" or new_user,
        "show_checklist": state == "checklist",
    }


@router.get("", response_model=OnboardingOut)
def get_onboarding(user: CurrentUserDep, db: UserDbDep) -> dict:
    return _read(db, user.id)


@router.post("", response_model=OnboardingOut)
def set_onboarding(body: StateIn, user: CurrentUserDep, db: UserDbDep) -> dict:
    db.execute(
        """
        insert into public.user_settings (user_id, onboarding_state) values (%s, %s)
        on conflict (user_id) do update set onboarding_state = excluded.onboarding_state
        """,
        (user.id, body.state),
    )
    return _read(db, user.id)
