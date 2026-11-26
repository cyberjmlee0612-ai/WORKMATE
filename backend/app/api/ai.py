"""AI 업무 도우미 API.

GET  /ai/usage?tz=        오늘 사용량과 AI 사용 가능 여부
POST /ai/breakdown        자연어 → 세부 업무 제안 (저장하지 않음)

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

from app.ai import breakdown
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
    used = db.execute(
        """
        insert into public.ai_usage (user_id, used_on, count) values (%s, %s, 1)
        on conflict (user_id, used_on) do update set count = public.ai_usage.count + 1
        returning count
        """,
        (user.id, today),
    ).fetchone()["count"]
    if used > get_settings().ai_daily_limit:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, f"오늘 AI 사용 횟수({get_settings().ai_daily_limit}회)를 모두 썼어요. 내일 다시 이용해 주세요.")

    try:
        result = breakdown.suggest(provider, body.text, today, project, existing)
    except AiProviderError as exc:
        # 예외 → 트랜잭션 롤백 → 이번 요청은 사용량에 세지 않는다
        code = status.HTTP_503_SERVICE_UNAVAILABLE if exc.rate_limited else status.HTTP_502_BAD_GATEWAY
        raise HTTPException(code, exc.message) from exc
    if not result["tasks"]:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "AI가 업무를 제안하지 못했어요. 조금 더 구체적으로 적어 주세요.")
    return {**result, "usage": _usage(used)}
