"""집중 모드 API (2026-11-27 사용자 확정: 뽀모도로 25/5·4번째 15분, 방해 이유 기록, 타이머와는 별개).

POST /focus/sessions                       집중 시작 {task_id?, focus_minutes} — 끝나지 않은 이전 집중은 그만둔 것으로 닫는다
POST /focus/sessions/{id}/finish           집중 끝 {completed}
POST /focus/sessions/{id}/interruptions    방해받음 {reason?}
GET  /focus/stats?start=&end=&tz=          기간 통계 (집중 횟수·완주·집중 시간·방해 이유)

카운트다운·휴식은 화면이 관리한다. 서버는 집중 한 번의 시작·끝과 방해만 기록한다.
"""

from datetime import date, datetime, time, timedelta
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field

from app.core.auth import CurrentUserDep
from app.core.errors import FieldError
from app.db import UserDbDep
from app.repositories.time_entries import TASK_NOT_FOUND

router = APIRouter(prefix="/focus", tags=["focus"])

Reason = Literal["message", "call", "thought", "noise", "other"]
MAX_INTERRUPTIONS = 50  # 한 번 집중에서 기록할 수 있는 방해 (실수로 연타 방지)
_NOT_FOUND = HTTPException(status.HTTP_404_NOT_FOUND, "집중 기록을 찾을 수 없어요.")


class StartIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: UUID | None = None
    focus_minutes: int = Field(25, ge=5, le=120)


class SessionOut(BaseModel):
    id: UUID
    task_id: UUID | None
    focus_minutes: int
    started_at: datetime
    ended_at: datetime | None
    completed: bool
    interruptions: int


def _get(db, user_id: UUID, session_id: UUID) -> dict:
    row = db.execute(
        """
        select s.id, s.task_id, s.focus_minutes, s.started_at, s.ended_at, s.completed,
          (select count(*) from public.focus_interruptions i where i.session_id = s.id)::int as interruptions
        from public.focus_sessions s where s.user_id = %s and s.id = %s
        """,
        (user_id, session_id),
    ).fetchone()
    if row is None:
        raise _NOT_FOUND
    return row


@router.post("/sessions", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
def start_session(body: StartIn, user: CurrentUserDep, db: UserDbDep) -> dict:
    if body.task_id is not None and db.execute("select 1 from public.tasks where user_id = %s and id = %s", (user.id, body.task_id)).fetchone() is None:
        raise FieldError("task_id", TASK_NOT_FOUND)
    # 창을 닫는 등으로 끝나지 않은 집중은 '그만둠'으로 닫는다 (끝 시각은 예정 시간을 넘지 않게)
    db.execute(
        """
        update public.focus_sessions
        set ended_at = least(now(), started_at + make_interval(mins => focus_minutes)), completed = false
        where user_id = %s and ended_at is null
        """,
        (user.id,),
    )
    row = db.execute(
        "insert into public.focus_sessions (user_id, task_id, focus_minutes) values (%s, %s, %s) returning id",
        (user.id, body.task_id, body.focus_minutes),
    ).fetchone()
    return _get(db, user.id, row["id"])


class FinishIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    completed: bool


@router.post("/sessions/{session_id}/finish", response_model=SessionOut)
def finish_session(session_id: UUID, body: FinishIn, user: CurrentUserDep, db: UserDbDep) -> dict:
    row = db.execute(
        """
        update public.focus_sessions
        set ended_at = least(now(), started_at + make_interval(mins => focus_minutes + 5)), completed = %s
        where user_id = %s and id = %s and ended_at is null
        returning id
        """,
        (body.completed, user.id, session_id),
    ).fetchone()
    if row is None:
        _get(db, user.id, session_id)  # 없으면 404
        raise HTTPException(status.HTTP_409_CONFLICT, "이미 끝난 집중이에요.")
    return _get(db, user.id, session_id)


class InterruptIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: Reason | None = None


@router.post("/sessions/{session_id}/interruptions", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
def add_interruption(session_id: UUID, body: InterruptIn, user: CurrentUserDep, db: UserDbDep) -> dict:
    session = _get(db, user.id, session_id)
    if session["ended_at"] is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "이미 끝난 집중이에요.")
    if session["interruptions"] >= MAX_INTERRUPTIONS:
        raise HTTPException(status.HTTP_409_CONFLICT, "한 번 집중에서 기록할 수 있는 방해를 모두 썼어요.")
    db.execute("insert into public.focus_interruptions (user_id, session_id, reason) values (%s, %s, %s)", (user.id, session_id, body.reason))
    return _get(db, user.id, session_id)


class ReasonCount(BaseModel):
    reason: Reason | None
    count: int


class StatsOut(BaseModel):
    sessions: int
    completed: int
    focus_minutes: int  # 실제로 집중한 시간 (그만둔 집중은 그만둘 때까지)
    interruptions: int
    by_reason: list[ReasonCount]


@router.get("/stats", response_model=StatsOut)
def get_stats(user: CurrentUserDep, db: UserDbDep, start: date = Query(), end: date = Query(), tz: str = Query("UTC", max_length=64)) -> dict:
    try:
        zone = ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise FieldError("tz", "알 수 없는 시간대입니다.") from exc
    if end < start:
        raise FieldError("end", "끝 날짜는 시작 날짜와 같거나 뒤여야 해요.")
    rs = datetime.combine(start, time(0), tzinfo=zone)
    re = datetime.combine(end + timedelta(days=1), time(0), tzinfo=zone)
    row = db.execute(
        """
        select count(*)::int as sessions,
          count(*) filter (where completed)::int as completed,
          coalesce(floor(sum(extract(epoch from least(coalesce(ended_at, now()), started_at + make_interval(mins => focus_minutes)) - started_at)) / 60), 0)::int as focus_minutes
        from public.focus_sessions where user_id = %s and started_at >= %s and started_at < %s
        """,
        (user.id, rs, re),
    ).fetchone()
    reasons = db.execute(
        """
        select i.reason, count(*)::int as count
        from public.focus_interruptions i join public.focus_sessions s on s.id = i.session_id and s.user_id = i.user_id
        where i.user_id = %s and s.started_at >= %s and s.started_at < %s
        group by i.reason order by count desc
        """,
        (user.id, rs, re),
    ).fetchall()
    return {**row, "interruptions": sum(r["count"] for r in reasons), "by_reason": reasons}
