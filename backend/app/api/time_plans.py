"""업무 계획 블록 API (시간표에 끌어다 놓은 계획). 409 task_closed: 완료·제외한 업무는 새로 배치 불가."""

from datetime import datetime, timedelta
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict, Field

from app.core.auth import CurrentUserDep
from app.core.errors import ConflictError, FieldError
from app.db import UserDbDep
from app.repositories import slots
from app.repositories import time_entries as entry_repo
from app.repositories import time_plans as repo
from app.schemas.time_entry import TimeEntryCreate
from app.schemas.time_plan import TimePlanCreate, TimePlanOut, TimePlanUpdate

router = APIRouter(prefix="/time-plans", tags=["time"])

_NOT_FOUND = HTTPException(status.HTTP_404_NOT_FOUND, "계획을 찾을 수 없습니다.")
MAX_RANGE_DAYS = 42  # 한 번에 조회하는 구간 (주간 보기 + 여유)


@router.get("", response_model=list[TimePlanOut])
def list_plans(start: datetime, end: datetime, user: CurrentUserDep, db: UserDbDep) -> list[dict]:
    for name, value in (("start", start), ("end", end)):
        if value.tzinfo is None:
            raise FieldError(name, "시간대가 포함된 시각이어야 합니다.")
    if end <= start:
        raise FieldError("end", "끝 시각은 시작 시각보다 늦어야 합니다.")
    if (end - start).days > MAX_RANGE_DAYS:
        raise FieldError("end", f"한 번에 {MAX_RANGE_DAYS}일까지 조회할 수 있습니다.")
    return repo.list_plans(db, user.id, start=start, end=end)


@router.post("", response_model=TimePlanOut, status_code=status.HTTP_201_CREATED)
def create_plan(body: TimePlanCreate, user: CurrentUserDep, db: UserDbDep) -> dict:
    return repo.create_plan(db, user.id, body)


class TimePlanBulkCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    plans: list[TimePlanCreate] = Field(min_length=1, max_length=30)


@router.post("/bulk", response_model=list[TimePlanOut], status_code=status.HTTP_201_CREATED)
def create_plans_bulk(body: TimePlanBulkCreate, user: CurrentUserDep, db: UserDbDep) -> list[dict]:
    """여러 계획을 한 번에 저장 (AI 하루 계획 승인용). 하나라도 실패하면 아무것도 저장하지 않는다."""
    return [repo.create_plan(db, user.id, plan) for plan in body.plans]


# ---------------------------------------------------------------- 밀린 계획 (2026-11-26 사용자 확정)

MAX_RESCHEDULE_MINUTES = 180


@router.get("/missed", response_model=list[TimePlanOut])
def list_missed(user: CurrentUserDep, db: UserDbDep) -> list[dict]:
    """끝났는데 거의 기록하지 않은 계획 (최근 7일, 처리 안 함, 업무 미완료)."""
    return repo.list_missed(db, user.id)


class ResolveIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # today/tomorrow: 그날 일·공부 시간의 가장 이른 빈칸에 다시 배치 (원래 블록은 '놓침'으로 남음)
    # done: 계획 시간을 그대로 실제 기록으로 / let_go: 놓아주기
    action: Literal["today", "tomorrow", "done", "let_go"]
    tz: str = Field("UTC", max_length=64)


class ResolveOut(BaseModel):
    plan: TimePlanOut
    new_plan: TimePlanOut | None = None


@router.post("/{plan_id}/resolve", response_model=ResolveOut)
def resolve_plan(plan_id: UUID, body: ResolveIn, user: CurrentUserDep, db: UserDbDep) -> dict:
    try:
        zone = ZoneInfo(body.tz)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise FieldError("tz", "알 수 없는 시간대입니다.") from exc
    plan = repo.lock_for_resolve(db, user.id, plan_id)
    if plan is None:
        raise _NOT_FOUND

    new_plan = None
    if body.action in ("today", "tomorrow"):
        day = datetime.now(zone).date() + timedelta(days=1 if body.action == "tomorrow" else 0)
        duration = int((plan["ends_at"] - plan["starts_at"]).total_seconds() // 60)
        minutes = min(MAX_RESCHEDULE_MINUTES, -(-duration // slots.SNAP) * slots.SNAP)
        start = slots.find_slot(db, user.id, day, body.tz, minutes)
        if start is None:
            when = "오늘 남은" if body.action == "today" else "내일"
            raise ConflictError(f"{when} 일·공부 시간에 {minutes}분이 들어갈 빈칸이 없어요. 캘린더에서 직접 옮겨 주세요.", "no_slot")
        new_plan = repo.create_plan(
            db, user.id, TimePlanCreate(task_id=plan["task_id"], starts_at=slots.at(day, body.tz, start), ends_at=slots.at(day, body.tz, start + minutes))
        )
        repo.mark_resolved(db, user.id, plan_id, "rescheduled")
    elif body.action == "done":
        # 겹치는 기록이 있으면 409 overlap (기존 기록 규칙)
        entry_repo.create_entry(db, user.id, TimeEntryCreate(task_id=plan["task_id"], started_at=plan["starts_at"], ended_at=plan["ends_at"], note="계획 시간을 실제 기록으로 바꿈"))
        repo.mark_resolved(db, user.id, plan_id, "done")
    else:
        repo.mark_resolved(db, user.id, plan_id, "let_go")
    return {"plan": repo.get_plan(db, user.id, plan_id), "new_plan": new_plan}


@router.patch("/{plan_id}", response_model=TimePlanOut)
def update_plan(plan_id: UUID, body: TimePlanUpdate, user: CurrentUserDep, db: UserDbDep) -> dict:
    plan = repo.update_plan(db, user.id, plan_id, body)
    if plan is None:
        raise _NOT_FOUND
    return plan


@router.delete("/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_plan(plan_id: UUID, user: CurrentUserDep, db: UserDbDep) -> Response:
    if not repo.delete_plan(db, user.id, plan_id):
        raise _NOT_FOUND
    return Response(status_code=status.HTTP_204_NO_CONTENT)
