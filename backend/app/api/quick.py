"""빠른 입력 · 검색 API (2026-11-27 사용자 확정: Ctrl+K 입력창).

POST /quick/parse      한 줄 → 만들 것 미리보기 (규칙 해석, 저장하지 않음)
POST /quick/ai-parse   한 줄 → 미리보기 (Gemini 해석, 하루 AI 한도 사용, 저장하지 않음)
POST /quick/create     미리보기(고친 값)로 업무(+계획) / 이벤트 / 반복 만들기 — 한 트랜잭션
GET  /search?q=        업무·프로젝트·이벤트 제목 검색 (각 최대 6개)
"""

from datetime import date, datetime, time, timedelta
from datetime import date as Date  # 필드 이름 date와 겹치지 않게
from typing import Any, Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, HTTPException, Query, status
from psycopg import Connection
from psycopg.rows import DictRow
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.ai.provider import AiProviderError
from app.api import ai as ai_api
from app.api import events as events_api
from app.api import routines as routines_api
from app.core.auth import CurrentUserDep
from app.core.errors import FieldError
from app.db import UserDbDep
from app.quick.parser import Draft, parse
from app.repositories import routines as routine_repo
from app.repositories import slots
from app.repositories import tasks as task_repo
from app.repositories import time_plans as plan_repo
from app.schemas.task import TaskCreate
from app.schemas.time_plan import TimePlanCreate

router = APIRouter(tags=["quick"])

TEXT_MAX = 300
DEFAULT_PLAN_MINUTES = 60
SEARCH_LIMIT = 6
Kind = Literal["task", "event", "routine"]
HHMM = r"^(([01]\d|2[0-3]):[0-5]\d|24:00)$"


def _today(tz: str) -> tuple[date, datetime]:
    try:
        now = datetime.now(ZoneInfo(tz))
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise FieldError("tz", "알 수 없는 시간대입니다.") from exc
    return now.date(), now


def _hhmm(minutes: int | None) -> str | None:
    return None if minutes is None else f"{minutes // 60:02d}:{minutes % 60:02d}"


def _norm(text: str) -> str:
    return "".join(text.split()).lower()


def match_project(db: Connection[DictRow], user_id: UUID, query: str | None) -> DictRow | None:
    """#이름 → 프로젝트. 공백을 빼고 비교, 진행 중 프로젝트 먼저, 정확히 → 앞부분 → 포함."""
    if not query:
        return None
    rows = db.execute(
        "select id, name, status from public.projects where user_id = %s order by (status in ('completed', 'archived')), updated_at desc",
        (user_id,),
    ).fetchall()
    q = _norm(query)
    for test in (lambda n: n == q, lambda n: n.startswith(q), lambda n: q in n):
        found = next((r for r in rows if test(_norm(r["name"]))), None)
        if found:
            return found
    return None


class ParseIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=TEXT_MAX)
    tz: str = Field("UTC", max_length=64)


class DraftOut(BaseModel):
    kind: Kind
    title: str
    date: Date | None
    start: str | None
    end: str | None
    duration: int | None
    priority: Literal["low", "medium", "high", "urgent"] | None
    project_id: UUID | None
    project_name: str | None
    project_query: str | None  # #태그를 썼는데 맞는 프로젝트가 없으면 남는다
    event_kind: Literal["exam", "presentation", "exhibition", "deadline", "other"] | None
    mode: Literal["task", "habit"]
    freq: Literal["daily", "weekly", "monthly", "interval"] | None
    weekdays: list[int]
    every_weeks: int
    month_day: int | None
    interval_days: int | None
    matched: list[str]


def draft_out(db: Connection[DictRow], user_id: UUID, d: Draft, today: date, now: datetime) -> dict[str, Any]:
    project = match_project(db, user_id, d.project_query)
    day = d.day
    # 날짜 없이 시각만 쓴 업무인데 그 시각이 이미 지났으면 내일로
    if d.kind == "task" and day is None and d.start_minute is not None and d.start_minute < now.hour * 60 + now.minute:
        day = today + timedelta(days=1)
        d.matched.append("(지난 시각이라 내일로)")
    if d.kind == "event" and day is None:
        day = today
    return {
        "kind": d.kind,
        "title": d.title,
        "date": day,
        "start": _hhmm(d.start_minute),
        "end": _hhmm(d.end_minute),
        "duration": d.duration,
        "priority": d.priority,
        "project_id": project["id"] if project else None,
        "project_name": project["name"] if project else None,
        "project_query": None if project else d.project_query,
        "event_kind": d.event_kind if d.kind == "event" else None,
        "mode": d.mode,
        "freq": d.freq,
        "weekdays": d.weekdays,
        "every_weeks": d.every_weeks,
        "month_day": d.month_day,
        "interval_days": d.interval_days,
        "matched": d.matched,
    }


@router.post("/quick/parse", response_model=DraftOut)
def post_parse(body: ParseIn, user: CurrentUserDep, db: UserDbDep) -> dict:
    today, now = _today(body.tz)
    return draft_out(db, user.id, parse(body.text, today), today, now)


# ---------------------------------------------------------------- AI 해석


class AiQuick(BaseModel):
    kind: Literal["task", "event", "routine"]
    title: str = Field(description="짧은 제목 (날짜·시각·프로젝트 말은 빼고)")
    date: str | None = Field(None, description="YYYY-MM-DD. 업무 마감일·이벤트 날짜·반복 시작일")
    start: str | None = Field(None, description="HH:MM 24시간")
    end: str | None = Field(None, description="HH:MM 24시간")
    minutes: int | None = Field(None, description="걸리는 시간(분)")
    priority: Literal["low", "medium", "high", "urgent"] | None = None
    project: str | None = Field(None, description="목록에 있는 프로젝트 이름 그대로, 없으면 null")
    event_kind: Literal["exam", "presentation", "exhibition", "deadline", "other"] | None = None
    habit: bool = Field(False, description="반복 중 체크만 하는 습관이면 true")
    freq: Literal["daily", "weekly", "monthly", "interval"] | None = None
    weekdays: list[int] = Field(default_factory=list, description="weekly일 때 0=일 … 6=토")
    every_weeks: int = 1
    month_day: int | None = None
    interval_days: int | None = None


AI_SYSTEM = """너는 업무 관리 서비스의 빠른 입력 해석기다. 사용자가 쓴 한 줄을 구조화한다.
- kind: 할 일이면 task, 시험·발표·출품·전시·마감처럼 날짜 자체가 중요한 일이면 event, 매일·매주처럼 반복하면 routine.
- 날짜는 오늘 기준으로 계산해 YYYY-MM-DD로. 모르면 null. 시각은 24시간 HH:MM.
- 프로젝트는 주어진 목록에 있는 이름만 그대로 쓴다.
- 제목에는 날짜·시각·길이·프로젝트 말을 넣지 않는다."""


def _clean_hhmm(value: str | None) -> int | None:
    if not value:
        return None
    try:
        h, m = value.strip().split(":")
        minutes = int(h) * 60 + int(m)
    except ValueError:
        return None
    return minutes if 0 <= minutes <= 24 * 60 else None


@router.post("/quick/ai-parse", response_model=DraftOut)
def post_ai_parse(body: ParseIn, user: CurrentUserDep, db: UserDbDep) -> dict:
    today, now = _today(body.tz)
    projects = [r["name"] for r in db.execute(
        "select name from public.projects where user_id = %s and status not in ('completed', 'archived') order by updated_at desc limit 50", (user.id,)
    ).fetchall()]
    provider = ai_api._provider()
    ai_api._count_usage(db, user.id, today)
    weekday = "월화수목금토일"[today.weekday()]
    prompt = f"오늘: {today.isoformat()} ({weekday}요일)\n프로젝트 목록: {', '.join(projects) or '없음'}\n입력: {body.text}"
    try:
        r = provider.generate(AI_SYSTEM, prompt, AiQuick)
    except AiProviderError as exc:
        raise ai_api._provider_failed(exc) from exc

    d = Draft(kind=r.kind, title=" ".join(r.title.split())[:100], priority=r.priority, project_query=r.project, matched=["AI 해석"])
    try:
        d.day = date.fromisoformat(r.date) if r.date else None
    except ValueError:
        d.day = None
    d.start_minute, d.end_minute = _clean_hhmm(r.start), _clean_hhmm(r.end)
    d.duration = r.minutes if r.minutes and 0 < r.minutes <= 1440 else None
    if d.start_minute is not None and d.end_minute is None and d.duration:
        d.end_minute = min(24 * 60, d.start_minute + d.duration)
    if r.kind == "event":
        d.event_kind = r.event_kind or "other"
    if r.kind == "routine":
        d.mode = "habit" if r.habit else "task"
        d.freq = r.freq or "daily"
        d.weekdays = sorted({w for w in r.weekdays if 0 <= w <= 6})
        d.every_weeks = min(8, max(1, r.every_weeks))
        d.month_day = r.month_day if r.month_day and 1 <= r.month_day <= 31 else None
        d.interval_days = r.interval_days if r.interval_days and 2 <= r.interval_days <= 365 else None
        if d.freq == "weekly" and not d.weekdays:
            d.freq = "daily"
    if not d.title:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "AI가 해석하지 못했어요. 조금 더 구체적으로 적어 주세요.")
    return draft_out(db, user.id, d, today, now)


# ---------------------------------------------------------------- 만들기


class CreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Kind
    title: str = Field(min_length=1, max_length=100)
    date: Date | None = None
    start: str | None = Field(None, pattern=HHMM)
    end: str | None = Field(None, pattern=HHMM)
    duration: int | None = Field(None, ge=1, le=1440)
    priority: Literal["low", "medium", "high", "urgent"] | None = None
    project_id: UUID | None = None
    event_kind: Literal["exam", "presentation", "exhibition", "deadline", "other"] | None = None
    mode: Literal["task", "habit"] = "task"
    freq: Literal["daily", "weekly", "monthly", "interval"] | None = None
    weekdays: list[int] = Field(default_factory=list, max_length=7)
    every_weeks: int = Field(1, ge=1, le=8)
    month_day: int | None = Field(None, ge=1, le=31)
    interval_days: int | None = Field(None, ge=2, le=365)
    tz: str = Field("UTC", max_length=64)

    @field_validator("title", mode="after")
    @classmethod
    def _title(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("제목을 입력해 주세요.")
        return value


class CreateOut(BaseModel):
    kind: Kind
    id: UUID
    title: str
    message: str


def _to_minutes(value: str | None) -> int | None:
    return None if value is None else int(value[:2]) * 60 + int(value[3:])


@router.post("/quick/create", response_model=CreateOut, status_code=status.HTTP_201_CREATED)
def post_create(body: CreateIn, user: CurrentUserDep, db: UserDbDep) -> dict:
    today, _ = _today(body.tz)
    start, end = _to_minutes(body.start), _to_minutes(body.end)
    if start is not None and end is None:
        end = min(24 * 60, start + (body.duration or DEFAULT_PLAN_MINUTES))
    if start is not None and end is not None and end - start < 10:
        raise FieldError("end", "끝 시각은 시작보다 10분 이상 늦어야 해요.")

    if body.kind == "task":
        task = task_repo.create_task(db, user.id, TaskCreate(
            title=body.title, project_id=body.project_id, priority=body.priority or "medium",
            due_date=body.date, estimated_minutes=body.duration or (end - start if start is not None and end is not None else None),
        ))
        message = "업무를 만들었어요."
        if start is not None and end is not None:
            day = body.date or today
            plan_repo.create_plan(db, user.id, TimePlanCreate(task_id=task["id"], starts_at=slots.at(day, body.tz, start), ends_at=slots.at(day, body.tz, end)))
            message = f"업무를 만들고 {day.month}/{day.day} {body.start}에 계획했어요."
        return {"kind": "task", "id": task["id"], "title": task["title"], "message": message}

    if body.kind == "event":
        ev = events_api.create_event(events_api.EventCreate(
            title=body.title, kind=body.event_kind or "other", event_date=body.date or today,
            start_time=time(start // 60, start % 60) if start is not None and start < 24 * 60 else None,
            end_time=time(end // 60, end % 60) if start is not None and end is not None and end < 24 * 60 else None,
            project_id=body.project_id,
        ), user, db)
        return {"kind": "event", "id": ev["id"], "title": ev["title"], "message": f"이벤트를 {ev['event_date'].month}/{ev['event_date'].day}에 추가했어요."}

    routine = routines_api.create_routine(routines_api.RoutineIn(
        title=body.title, mode=body.mode, project_id=body.project_id, priority=body.priority or "medium",
        estimated_minutes=body.duration if body.mode == "task" else None, freq=body.freq or "daily", weekdays=body.weekdays,
        every_weeks=body.every_weeks, month_day=body.month_day, interval_days=body.interval_days, start_date=body.date or today,
        start_time=time(start // 60, start % 60) if start is not None and end is not None and end < 24 * 60 else None,
        end_time=time(end // 60, end % 60) if start is not None and end is not None and end < 24 * 60 else None,
    ), user, db, tz=body.tz)
    routine_repo.materialize(db, user.id, today, body.tz)  # 오늘 반복하면 오늘 업무도 바로
    label = "습관" if body.mode == "habit" else "반복 업무"
    return {"kind": "routine", "id": routine["id"], "title": routine["title"], "message": f"{label}을(를) 만들었어요."}


# ---------------------------------------------------------------- 검색


class SearchTask(BaseModel):
    id: UUID
    title: str
    status: str
    due_date: date | None
    project_path: str | None


class SearchProject(BaseModel):
    id: UUID
    name: str
    status: str


class SearchEvent(BaseModel):
    id: UUID
    title: str
    kind: str
    event_date: date


class SearchOut(BaseModel):
    tasks: list[SearchTask]
    projects: list[SearchProject]
    events: list[SearchEvent]


@router.get("/search", response_model=SearchOut)
def search(user: CurrentUserDep, db: UserDbDep, q: str = Query(min_length=1, max_length=100)) -> dict:
    pattern = "%" + q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    tasks = db.execute(
        task_repo._SELECT + """ where t.user_id = %s and t.title ilike %s
        order by (t.status in ('completed', 'cancelled')), t.due_date nulls last, t.updated_at desc limit %s""",
        (user.id, pattern, SEARCH_LIMIT),
    ).fetchall()
    projects = db.execute(
        "select id, name, status from public.projects where user_id = %s and name ilike %s order by (status in ('completed', 'archived')), updated_at desc limit %s",
        (user.id, pattern, SEARCH_LIMIT),
    ).fetchall()
    events = db.execute(
        "select id, title, kind, event_date from public.events where user_id = %s and title ilike %s order by (event_date < current_date), event_date limit %s",
        (user.id, pattern, SEARCH_LIMIT),
    ).fetchall()
    return {"tasks": tasks, "projects": projects, "events": events}
