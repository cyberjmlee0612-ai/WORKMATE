"""반복 업무 · 습관 API (2026-11-27 사용자 확정).

GET    /routines?tz=                 목록 (오늘 반복 여부, 다음 날짜, 습관 연속 기록·최근 7일)
POST   /routines                     만들기
PATCH  /routines/{id}                고치기 (규칙을 바꿔도 이미 만든 업무는 그대로)
DELETE /routines/{id}                지우기 (만든 업무는 남고, 습관 체크 기록은 함께 지워짐)
POST   /routines/{id}/check          습관 체크/해제 {date, checked}
POST   /routines/materialize         오늘 반복 업무 만들기 + 지난 것 건너뜀 정리 {tz} (하루 여러 번 불러도 같음)
"""

from datetime import date, datetime, time, timedelta
from typing import Any, Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, HTTPException, Query, status
from psycopg import Connection
from psycopg.rows import DictRow
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.api.schedule import weekdays_to_mask
from app.core.auth import CurrentUserDep
from app.core.errors import FieldError
from app.db import UserDbDep
from app.repositories import routines as repo
from app.repositories.tasks import PROJECT_NOT_FOUND

router = APIRouter(prefix="/routines", tags=["routines"])

MAX_ROUTINES = 50
CHECK_BACK_DAYS = 7  # 지난 습관은 7일 전까지 체크·해제할 수 있다
TITLE_MAX = 100
Freq = Literal["daily", "weekly", "monthly", "interval"]


def _today(tz: str) -> date:
    try:
        return datetime.now(ZoneInfo(tz)).date()
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise FieldError("tz", "알 수 없는 시간대입니다.") from exc


class RoutineIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    mode: Literal["task", "habit"] = "task"
    project_id: UUID | None = None
    priority: Literal["low", "medium", "high", "urgent"] = "medium"
    estimated_minutes: int | None = Field(None, ge=1, le=1440)
    freq: Freq
    weekdays: list[int] = Field(default_factory=list, max_length=7)  # weekly: 0=일 … 6=토
    every_weeks: int = Field(1, ge=1, le=8)  # weekly: 2면 격주
    month_day: int | None = Field(None, ge=1, le=31)
    interval_days: int | None = Field(None, ge=2, le=365)
    start_date: date
    start_time: time | None = None
    end_time: time | None = None
    active: bool = True

    @field_validator("title", mode="after")
    @classmethod
    def _title(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("이름을 입력해 주세요.")
        if len(value) > TITLE_MAX:
            raise ValueError(f"이름은 {TITLE_MAX}자 이하로 입력해 주세요.")
        return value

    @model_validator(mode="after")
    def _rule(self) -> "RoutineIn":
        if any(d < 0 or d > 6 for d in self.weekdays):
            raise ValueError("요일이 올바르지 않아요.")
        if self.freq == "weekly" and not self.weekdays:
            raise ValueError("반복할 요일을 하나 이상 골라 주세요.")
        if self.freq == "monthly" and self.month_day is None:
            raise ValueError("매월 며칠에 반복할지 골라 주세요.")
        if self.freq == "interval" and self.interval_days is None:
            raise ValueError("며칠마다 반복할지 입력해 주세요.")
        if (self.start_time is None) != (self.end_time is None):
            raise ValueError("시각은 시작과 끝을 함께 정해 주세요.")
        if self.start_time and self.end_time:
            minutes = (self.end_time.hour * 60 + self.end_time.minute) - (self.start_time.hour * 60 + self.start_time.minute)
            if minutes < 10:
                raise ValueError("끝 시각은 시작보다 10분 이상 늦어야 해요.")
        return self


class RecentDay(BaseModel):
    date: date
    due: bool
    checked: bool


class RoutineOut(BaseModel):
    id: UUID
    title: str
    mode: Literal["task", "habit"]
    project_id: UUID | None
    project_path: str | None
    priority: str
    estimated_minutes: int | None
    freq: Freq
    weekdays: list[int]
    every_weeks: int
    month_day: int | None
    interval_days: int | None
    start_date: date
    start_time: str | None
    end_time: str | None
    active: bool
    occurs_today: bool
    next_date: date | None
    checked_today: bool
    streak: int
    recent: list[RecentDay]


def _out(row: dict[str, Any]) -> dict[str, Any]:
    return {**row, "weekdays": row["weekday_list"]}


def _values(user_id: UUID, body: RoutineIn) -> dict[str, Any]:
    weekly = body.freq == "weekly"
    return {
        "u": user_id,
        "title": body.title,
        "mode": body.mode,
        # 습관은 업무를 만들지 않으므로 프로젝트·우선순위·예상 시간을 쓰지 않는다
        "project_id": body.project_id if body.mode == "task" else None,
        "priority": body.priority,
        "estimated_minutes": body.estimated_minutes if body.mode == "task" else None,
        "freq": body.freq,
        "weekdays": weekdays_to_mask(body.weekdays) if weekly else None,
        "every_weeks": body.every_weeks if weekly else 1,
        "month_day": body.month_day if body.freq == "monthly" else None,
        "interval_days": body.interval_days if body.freq == "interval" else None,
        "start_date": body.start_date,
        "start_time": body.start_time,
        "end_time": body.end_time,
        "active": body.active,
    }


def _check_project(db: Connection[DictRow], user_id: UUID, project_id: UUID | None) -> None:
    if project_id is not None and db.execute("select 1 from public.projects where user_id = %s and id = %s", (user_id, project_id)).fetchone() is None:
        raise FieldError("project_id", PROJECT_NOT_FOUND)


def _find(db: Connection[DictRow], user_id: UUID, routine_id: UUID, today: date) -> dict[str, Any]:
    row = next((r for r in repo.list_routines(db, user_id, today) if r["id"] == routine_id), None)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "반복을 찾을 수 없어요. 새로고침해 주세요.")
    return _out(row)


@router.get("", response_model=list[RoutineOut])
def get_routines(user: CurrentUserDep, db: UserDbDep, tz: str = Query("UTC", max_length=64)) -> list[dict]:
    return [_out(r) for r in repo.list_routines(db, user.id, _today(tz))]


@router.post("", response_model=RoutineOut, status_code=status.HTTP_201_CREATED)
def create_routine(body: RoutineIn, user: CurrentUserDep, db: UserDbDep, tz: str = Query("UTC", max_length=64)) -> dict:
    today = _today(tz)
    count = db.execute("select count(*) as n from public.routines where user_id = %s", (user.id,)).fetchone()["n"]
    if count >= MAX_ROUTINES:
        raise FieldError("title", f"반복은 {MAX_ROUTINES}개까지 만들 수 있어요.")
    _check_project(db, user.id, body.project_id)
    row = db.execute(
        """
        insert into public.routines (user_id, title, mode, project_id, priority, estimated_minutes, freq, weekdays, every_weeks,
          month_day, interval_days, start_date, start_time, end_time, active)
        values (%(u)s, %(title)s, %(mode)s, %(project_id)s, %(priority)s, %(estimated_minutes)s, %(freq)s, %(weekdays)s, %(every_weeks)s,
          %(month_day)s, %(interval_days)s, %(start_date)s, %(start_time)s, %(end_time)s, %(active)s)
        returning id
        """,
        _values(user.id, body),
    ).fetchone()
    return _find(db, user.id, row["id"], today)


@router.patch("/{routine_id}", response_model=RoutineOut)
def update_routine(routine_id: UUID, body: RoutineIn, user: CurrentUserDep, db: UserDbDep, tz: str = Query("UTC", max_length=64)) -> dict:
    """전체 값을 보낸다 (폼 저장). 이미 만든 업무·계획은 바꾸지 않는다."""
    today = _today(tz)
    _check_project(db, user.id, body.project_id)
    updated = db.execute(
        """
        update public.routines set title = %(title)s, mode = %(mode)s, project_id = %(project_id)s, priority = %(priority)s,
          estimated_minutes = %(estimated_minutes)s, freq = %(freq)s, weekdays = %(weekdays)s, every_weeks = %(every_weeks)s,
          month_day = %(month_day)s, interval_days = %(interval_days)s, start_date = %(start_date)s,
          start_time = %(start_time)s, end_time = %(end_time)s, active = %(active)s
        where user_id = %(u)s and id = %(id)s
        returning id
        """,
        {**_values(user.id, body), "id": routine_id},
    ).fetchone()
    if updated is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "반복을 찾을 수 없어요. 새로고침해 주세요.")
    return _find(db, user.id, routine_id, today)


@router.delete("/{routine_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_routine(routine_id: UUID, user: CurrentUserDep, db: UserDbDep) -> None:
    if db.execute("delete from public.routines where user_id = %s and id = %s returning id", (user.id, routine_id)).fetchone() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "반복을 찾을 수 없어요. 새로고침해 주세요.")


class CheckIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date: date
    checked: bool
    tz: str = Field("UTC", max_length=64)


@router.post("/{routine_id}/check", response_model=RoutineOut)
def check_habit(routine_id: UUID, body: CheckIn, user: CurrentUserDep, db: UserDbDep) -> dict:
    today = _today(body.tz)
    routine = db.execute(
        "select id, mode, freq, weekdays, every_weeks, month_day, interval_days, start_date from public.routines where user_id = %s and id = %s",
        (user.id, routine_id),
    ).fetchone()
    if routine is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "반복을 찾을 수 없어요. 새로고침해 주세요.")
    if routine["mode"] != "habit":
        raise FieldError("date", "반복 업무는 업무에서 완료 체크해 주세요.")
    if body.date > today or body.date < today - timedelta(days=CHECK_BACK_DAYS):
        raise FieldError("date", f"오늘부터 {CHECK_BACK_DAYS}일 전까지만 체크할 수 있어요.")
    if not repo.occurs(routine, body.date):
        raise FieldError("date", "반복하는 날이 아니에요.")
    if body.checked:
        db.execute(
            "insert into public.habit_checks (user_id, routine_id, check_date) values (%s, %s, %s) on conflict do nothing",
            (user.id, routine_id, body.date),
        )
    else:
        db.execute("delete from public.habit_checks where user_id = %s and routine_id = %s and check_date = %s", (user.id, routine_id, body.date))
    return _find(db, user.id, routine_id, today)


class MaterializeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tz: str = Field("UTC", max_length=64)


class MaterializeOut(BaseModel):
    created: int
    skipped: int


@router.post("/materialize", response_model=MaterializeOut)
def post_materialize(body: MaterializeIn, user: CurrentUserDep, db: UserDbDep) -> dict:
    return repo.materialize(db, user.id, _today(body.tz), body.tz)

