"""AI 업무 도우미 API.

GET  /ai/usage?tz=        오늘 사용량과 AI 사용 가능 여부
POST /ai/breakdown        자연어 → 세부 업무 제안 (저장하지 않음)
POST /ai/day-plan         남은 업무로 그날 시간표 배치 제안 (저장하지 않음)
POST /ai/report-review    리포트 기간 회고 (저장하지 않음)

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

from app.ai import breakdown, day_plan, report_review
from app.ai.provider import AiNotConfigured, AiProviderError, get_provider, is_configured
from app.core.auth import CurrentUserDep
from app.core.config import get_settings
from app.core.errors import FieldError
from app.db import UserDbDep
from app.api.reports import validate_period
from app.repositories import reports as report_repo
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

HHMM = r"^(([01]\d|2[0-3]):[0-5]\d|24:00)$"
NOTE_MAX_LENGTH = 300
MAX_RANGES = 20


class TimeRange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start: str = Field(pattern=HHMM)
    end: str = Field(pattern=HHMM)
    label: str = Field("", max_length=40)


class DayPlanRequest(BaseModel):
    """windows: 업무를 넣을 일·공부 시간 구간, blocked: 피할 시간(수업·고정 일정·쉬는 시간).
    화면이 설정의 요일별 반복 블록으로 채워 보내고, 사용자는 요청마다 고칠 수 있다."""

    model_config = ConfigDict(extra="forbid")

    date: date
    tz: str = Field("UTC", max_length=64)
    windows: list[TimeRange] = Field(min_length=1, max_length=MAX_RANGES)
    blocked: list[TimeRange] = Field(default_factory=list, max_length=MAX_RANGES)
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


def _merge(ranges: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """겹치거나 맞닿은 구간을 합친다 (시작 순)."""
    merged: list[tuple[int, int]] = []
    for a, b in sorted(ranges):
        if merged and a <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], b))
        else:
            merged.append((a, b))
    return merged


@router.post("/day-plan", response_model=DayPlanOut)
def post_day_plan(body: DayPlanRequest, user: CurrentUserDep, db: UserDbDep) -> dict:
    """남은 업무로 그날 시간표 배치를 제안한다 (저장하지 않음). 승인한 것만 /time-plans/bulk로 저장."""
    today = _user_today(body.tz)
    ranges = [(_minutes(r.start), _minutes(r.end)) for r in body.windows]
    if any(b <= a for a, b in ranges):
        raise FieldError("windows", "일할 시간의 끝은 시작보다 늦어야 해요.")
    windows = _merge(ranges)
    if sum(b - a for a, b in windows) < 30:
        raise FieldError("windows", "일할 시간은 모두 합쳐 30분 이상이어야 해요.")
    blocked = [(_minutes(r.start), _minutes(r.end), r.label.strip() or "쉬는 시간") for r in body.blocked]
    if any(b <= a for a, b, _ in blocked):
        raise FieldError("blocked", "피할 시간의 끝은 시작보다 늦어야 해요.")
    if body.date == today:
        now = datetime.now(ZoneInfo(body.tz))
        if now.hour * 60 + now.minute >= windows[-1][1] - 10:
            raise FieldError("windows", "오늘 남은 일할 시간이 없어요. 다른 날짜를 고르거나 시간을 늘려 주세요.")

    provider = _provider()
    used = _count_usage(db, user.id, today)
    try:
        result = day_plan.suggest(db, user.id, provider, day=body.date, tz=body.tz, windows=windows, blocked=blocked, note=body.note)
    except AiProviderError as exc:
        raise _provider_failed(exc) from exc
    if result.get("reason") == "no_tasks":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "계획할 업무가 없어요. 먼저 업무를 추가해 주세요.")
    if not result["blocks"]:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "빈 시간에 맞는 계획을 만들지 못했어요. 시간대를 넓히거나 다시 시도해 주세요.")
    return {**result, "usage": _usage(used)}


# ---------------------------------------------------------------- 리포트 회고


class ReportReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start: date
    end: date
    tz: str = Field("UTC", max_length=64)


class ReportReviewOut(BaseModel):
    headline: str
    good: list[str]
    improve: list[str]
    suggestions: list[str]
    usage: UsageOut


@router.post("/report-review", response_model=ReportReviewOut)
def post_report_review(body: ReportReviewRequest, user: CurrentUserDep, db: UserDbDep) -> dict:
    """리포트 기간의 숫자로 회고를 받는다 (저장하지 않음)."""
    today = validate_period(body.start, body.end, body.tz)
    report = report_repo.get_report(db, user.id, body.start, body.end, body.tz, today)
    if not report_review.has_data(report):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "이 기간에는 분석할 기록이 없어요. 시간을 기록하거나 업무를 완료한 뒤 다시 시도해 주세요.")
    provider = _provider()
    used = _count_usage(db, user.id, today)
    try:
        result = report_review.review(provider, report)
    except AiProviderError as exc:
        raise _provider_failed(exc) from exc
    if not result["headline"] and not result["good"] and not result["improve"]:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "AI가 회고를 만들지 못했어요. 잠시 후 다시 시도해 주세요.")
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
