"""업무 계획 블록 API (시간표에 끌어다 놓은 계획). 409 task_closed: 완료·제외한 업무는 새로 배치 불가."""

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, Response, status

from app.core.auth import CurrentUserDep
from app.core.errors import FieldError
from app.db import UserDbDep
from app.repositories import time_plans as repo
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
