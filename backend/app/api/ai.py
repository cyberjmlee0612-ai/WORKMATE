"""AI 업무 도우미 API.

GET  /ai/usage?tz=        오늘 사용량과 AI 사용 가능 여부
POST /ai/breakdown        자연어 → 세부 업무 제안 (저장하지 않음)
POST /ai/day-plan         남은 업무로 그날 시간표 배치 제안 (저장하지 않음)

하루 사용량(사용자 시간대 기준)은 AI 호출 전에 1 늘린다. 호출이 실패하면 예외로 요청 트랜잭션이
롤백되므로 실패한 요청은 세지 않는다. 같은 사용자의 요청은 사용량 행 잠금 때문에 차례로 처리된다.
"""

from datetime import date, datetime
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, HTTPException, Query, status
from psycopg import Connection
from psycopg.rows import DictRow
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.ai import breakdown, day_plan
from app.ai.provider import AiNotConfigured, AiProviderError, get_provider, is_configured
from app.core.auth import CurrentUserDep
from app.core.config import get_settings
from app.core.errors import FieldError
from app.db import UserDbDep
from app.repositories.tasks import PROJECT_NOT_FOUND

router = APIRouter(prefix="/ai", tags=["ai"])

TEXT_MAX_LENGTH = 2000
EXISTING_TITLES_LIMIT = 50


class UsageOut(BaseModel):
    configured: bool
    provider: str
    model: str | None
    used: int
    limit: int
    remaining: int


class BreakdownRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str
    project_id: UUID | None = None
    tz: str = Field("UTC", max_length=64)

    @field_validator("text", mode="after")
    @classmethod
    def _text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("하고 싶은 일을 입력해 주세요.")
        if len(value) > TEXT_MAX_LENGTH:
            raise ValueError(f"{TEXT_MAX_LENGTH:,}자 이하로 입력해 주세요.")
        return value


class SuggestedTask(BaseModel):
    title: str
    description: str | None
    priority: Literal["low", "medium", "high", "urgent"]
    estimated_minutes: int | None
    due_date: date | None


class BreakdownOut(BaseModel):
    summary: str
    project_name: str  # '새 프로젝트로 저장'할 때 미리 채울 이름 (비어 있을 수 있음)
    tasks: list[SuggestedTask]
    usage: UsageOut


def _user_today(tz: str) -> date:
    # '오늘'은 서버가 사용자 시간대로 계산한다 (클라이언트가 날짜를 바꿔 한도를 피하지 못하게)
    try:
        return datetime.now(ZoneInfo(tz)).date()
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise FieldError("tz", "알 수 없는 시간대입니다.") from exc


def _usage(used: int) -> dict:
    settings = get_settings()
    configured = is_configured()
    return {
        "configured": configured,
        "provider": settings.ai_provider,
        "model": settings.gemini_model if configured else None,
        "used": used,
        "limit": settings.ai_daily_limit,
        "remaining": max(0, settings.ai_daily_limit - used),
    }


def _used_today(db: Connection[DictRow], user_id: UUID, today: date) -> int:
    row = db.execute("select count from public.ai_usage where user_id = %s and used_on = %s", (user_id, today)).fetchone()
    return row["count"] if row else 0


def _count_usage(db: Connection[DictRow], user_id: UUID, today: date) -> int:
    """오늘 사용량 +1 (한도 초과면 429). 한도 확인과 증가를 한 번에 해서 동시 요청도 정확히 센다.
    이후 AI 호출이 실패하면 예외로 트랜잭션이 롤백되어 이 증가도 취소된다."""
    used = db.execute(
        """
        insert into public.ai_usage (user_id, used_on, count) values (%s, %s, 1)
        on conflict (user_id, used_on) do update set count = public.ai_usage.count + 1
        returning count
        """,
        (user_id, today),
    ).fetchone()["count"]
    limit = get_settings().ai_daily_limit
    if used > limit:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, f"오늘 AI 사용 횟수({limit}회)를 모두 썼어요. 내일 다시 이용해 주세요.")
    return used


def _provider():
    try:
        return get_provider()
    except AiNotConfigured as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "AI 기능이 아직 설정되지 않았어요. 관리자에게 API 키 설정을 요청해 주세요.") from exc


def _provider_failed(exc: AiProviderError) -> HTTPException:
    return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE if exc.rate_limited else status.HTTP_502_BAD_GATEWAY, exc.message)


# ---------------------------------------------------------------- 하루 계획 제안

HHMM = r"^([01]\d|2[0-4]):[0-5]\d$"
NOTE_MAX_LENGTH = 300


class DayPlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date: date
    tz: str = Field("UTC", max_length=64)
    work_start: str = Field("09:00", pattern=HHMM)
    work_end: str = Field("18:00", pattern=HHMM)
    lunch_start: str | None = Field("12:00", pattern=HHMM)  # 둘 다 null이면 쉬는 시간 없음
    lunch_end: str | None = Field("13:00", pattern=HHMM)
    note: str | None = None

    @field_validator("note", mode="after")
    @classmethod
    def _note(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if len(value) > NOTE_MAX_LENGTH:
            raise ValueError(f"요청 메모는 {NOTE_MAX_LENGTH}자 이하로 입력해 주세요.")
        return value or None


class DayPlanBlock(BaseModel):
    task_id: UUID
    task_title: str
    project_path: str | None
    starts_at: datetime
    ends_at: datetime
    reason: str


class DayPlanOut(BaseModel):
    summary: str
    blocks: list[DayPlanBlock]
    usage: UsageOut


def _minutes(value: str) -> int:
    h, m = value.split(":")
    return int(h) * 60 + int(m)


@router.post("/day-plan", response_model=DayPlanOut)
def post_day_plan(body: DayPlanRequest, user: CurrentUserDep, db: UserDbDep) -> dict:
    """남은 업무로 그날 시간표 배치를 제안한다 (저장하지 않음). 승인한 것만 /time-plans/bulk로 저장."""
    today = _user_today(body.tz)
    window = (_minutes(body.work_start), _minutes(body.work_end))
    if window[1] - window[0] < 30:
        raise FieldError("work_end", "일할 시간은 30분 이상이어야 해요.")
    lunch: tuple[int, int] | None = None
    if body.lunch_start and body.lunch_end:
        lunch = (_minutes(body.lunch_start), _minutes(body.lunch_end))
        if lunch[1] <= lunch[0]:
            raise FieldError("lunch_end", "쉬는 시간 끝은 시작보다 늦어야 해요.")
    if body.date == today:
        now = datetime.now(ZoneInfo(body.tz))
        if now.hour * 60 + now.minute >= window[1] - 10:
            raise FieldError("work_end", "오늘 남은 일할 시간이 없어요. 다른 날짜를 고르거나 끝 시각을 늦춰 주세요.")

    provider = _provider()
    used = _count_usage(db, user.id, today)
    try:
        result = day_plan.suggest(db, user.id, provider, day=body.date, tz=body.tz, window=window, lunch=lunch, note=body.note)
    except AiProviderError as exc:
        raise _provider_failed(exc) from exc
    if result.get("reason") == "no_tasks":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "계획할 업무가 없어요. 먼저 업무를 추가해 주세요.")
    if not result["blocks"]:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "빈 시간에 맞는 계획을 만들지 못했어요. 시간대를 넓히거나 다시 시도해 주세요.")
    return {**result, "usage": _usage(used)}


@router.get("/usage", response_model=UsageOut)
def get_usage(user: CurrentUserDep, db: UserDbDep, tz: str = Query("UTC", max_length=64)) -> dict:
    return _usage(_used_today(db, user.id, _user_today(tz)))


@router.post("/breakdown", response_model=BreakdownOut)
def post_breakdown(body: BreakdownRequest, user: CurrentUserDep, db: UserDbDep) -> dict:
    today = _user_today(body.tz)
    try:
        provider = get_provider()
    except AiNotConfigured as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "AI 기능이 아직 설정되지 않았어요. 관리자에게 API 키 설정을 요청해 주세요.") from exc

    project = None
    existing: list[str] = []
    if body.project_id is not None:
        project = db.execute(
            "select id, name, description, due_date from public.projects where user_id = %s and id = %s",
            (user.id, body.project_id),
        ).fetchone()
        if project is None:
            raise FieldError("project_id", PROJECT_NOT_FOUND)
        existing = [
            r["title"]
            for r in db.execute(
                "select title from public.tasks where user_id = %s and project_id = %s and status <> 'cancelled' order by created_at desc limit %s",
                (user.id, body.project_id, EXISTING_TITLES_LIMIT),
            ).fetchall()
        ]

    # 한도 확인과 증가를 한 번에 (행 잠금으로 동시 요청도 정확히 센다)
    used = _count_usage(db, user.id, today)

    try:
        result = breakdown.suggest(provider, body.text, today, project, existing)
    except AiProviderError as exc:
        # 예외 → 트랜잭션 롤백 → 이번 요청은 사용량에 세지 않는다
        code = status.HTTP_503_SERVICE_UNAVAILABLE if exc.rate_limited else status.HTTP_502_BAD_GATEWAY
        raise HTTPException(code, exc.message) from exc
    if not result["tasks"]:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "AI가 업무를 제안하지 못했어요. 조금 더 구체적으로 적어 주세요.")
    return {**result, "usage": _usage(used)}
