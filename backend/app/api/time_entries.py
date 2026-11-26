"""업무 시간 기록·타이머 API.

/timer        진행 중인 타이머 조회·시작·멈춤 (사용자당 하나)
/time-entries 기록 목록·직접 입력·수정·삭제
409 응답은 {"detail", "code"} 형식: overlap(겹침, conflict 포함), task_closed, timer_needs_review, no_running_timer.
"""

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, Response, status

from app.core.auth import CurrentUserDep
from app.core.errors import FieldError
from app.db import UserDbDep
from app.repositories import time_entries as repo
from app.schemas.time_entry import (
    TimeEntryCreate, TimeEntryOut, TimeEntryUpdate, TimerStart, TimerStartResult, TimerState, TimerStop, TimerStopResult,
)

timer_router = APIRouter(prefix="/timer", tags=["time"])
entries_router = APIRouter(prefix="/time-entries", tags=["time"])

_NOT_FOUND = HTTPException(status.HTTP_404_NOT_FOUND, "기록을 찾을 수 없습니다.")
_TASK_NOT_FOUND = HTTPException(status.HTTP_404_NOT_FOUND, "업무를 찾을 수 없습니다.")


@timer_router.get("", response_model=TimerState)
def get_timer(user: CurrentUserDep, db: UserDbDep) -> dict:
    return {"running": repo.get_running(db, user.id), "server_now": repo.now(db)}


@timer_router.post("/start", response_model=TimerStartResult)
def start_timer(body: TimerStart, user: CurrentUserDep, db: UserDbDep) -> dict:
    result = repo.start_timer(db, user.id, body.task_id)
    if result is None:
        raise _TASK_NOT_FOUND
    return result


@timer_router.post("/stop", response_model=TimerStopResult)
def stop_timer(body: TimerStop, user: CurrentUserDep, db: UserDbDep) -> dict:
    return repo.stop_timer(db, user.id, body.ended_at)


@entries_router.get("", response_model=list[TimeEntryOut])
def list_entries(
    user: CurrentUserDep,
    db: UserDbDep,
    task_id: UUID | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
) -> list[dict]:
    """task_id: 그 업무의 기록. start·end: 그 구간과 겹치는 기록(시간표용). 최신순, 최대 1000건."""
    for name, value in (("start", start), ("end", end)):
        if value is not None and value.tzinfo is None:
            raise FieldError(name, "시간대가 포함된 시각이어야 합니다.")
    if start is not None and end is not None and end <= start:
        raise FieldError("end", "끝 시각은 시작 시각보다 늦어야 합니다.")
    return repo.list_entries(db, user.id, task_id=task_id, start=start, end=end)


@entries_router.post("", response_model=TimeEntryOut, status_code=status.HTTP_201_CREATED)
def create_entry(body: TimeEntryCreate, user: CurrentUserDep, db: UserDbDep) -> dict:
    return repo.create_entry(db, user.id, body)


@entries_router.patch("/{entry_id}", response_model=TimeEntryOut)
def update_entry(entry_id: UUID, body: TimeEntryUpdate, user: CurrentUserDep, db: UserDbDep) -> dict:
    entry = repo.update_entry(db, user.id, entry_id, body)
    if entry is None:
        raise _NOT_FOUND
    return entry


@entries_router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entry(entry_id: UUID, user: CurrentUserDep, db: UserDbDep) -> Response:
    if not repo.delete_entry(db, user.id, entry_id):
        raise _NOT_FOUND
    return Response(status_code=status.HTTP_204_NO_CONTENT)
