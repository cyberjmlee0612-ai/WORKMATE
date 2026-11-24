from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator

# P1에서 취소 기능을 넣을 때 "cancelled"를 추가한다 (DB CHECK 제약도 함께)
TaskStatus = Literal["todo", "in_progress", "review", "completed"]
TaskPriority = Literal["low", "medium", "high", "urgent"]
TaskScope = Literal["all", "project", "personal"]

TITLE_MAX_LENGTH = 300
DESCRIPTION_MAX_LENGTH = 2000
ESTIMATED_MINUTES_MAX = 10_000  # 약 7일. PRD에 상한이 없어 임의로 정한 안전장치


def _clean_title(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("업무 제목을 입력해 주세요.")
    if len(value) > TITLE_MAX_LENGTH:
        raise ValueError(f"업무 제목은 {TITLE_MAX_LENGTH}자 이하로 입력해 주세요.")
    return value


def _clean_description(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if len(value) > DESCRIPTION_MAX_LENGTH:
        raise ValueError(f"설명은 {DESCRIPTION_MAX_LENGTH}자 이하로 입력해 주세요.")
    return value or None


def _check_minutes(value: int | None) -> int | None:
    if value is None:
        return None
    if value <= 0:
        raise ValueError("예상 시간은 1분 이상이어야 합니다.")
    if value > ESTIMATED_MINUTES_MAX:
        raise ValueError(f"예상 시간은 {ESTIMATED_MINUTES_MAX:,}분 이하로 입력해 주세요.")
    return value


class TaskCreate(BaseModel):
    # extra="forbid": user_id, completed_at 등 서버가 정하는 값을 클라이언트가 보내면 거절
    # strict 정수: 1.5, "30", true 같은 값이 조용히 정수로 바뀌지 않게 한다
    model_config = ConfigDict(extra="forbid")

    title: str
    description: str | None = None
    project_id: UUID | None = None  # None이면 개인 업무
    status: TaskStatus = "todo"
    priority: TaskPriority = "medium"
    due_date: date | None = None
    estimated_minutes: int | None = None

    _title = field_validator("title")(_clean_title)
    _description = field_validator("description")(_clean_description)
    _minutes = field_validator("estimated_minutes", mode="after")(_check_minutes)

    @field_validator("estimated_minutes", mode="before")
    @classmethod
    def _minutes_strict(cls, value: object) -> object:
        if value is not None and (isinstance(value, bool) or not isinstance(value, int)):
            raise ValueError("예상 시간은 분 단위 정수로 입력해 주세요.")
        return value


class TaskUpdate(BaseModel):
    """PATCH: 보낸 필드만 바꾼다. project_id에 null을 보내면 개인 업무로 전환된다."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    description: str | None = None
    project_id: UUID | None = None
    status: TaskStatus | None = None
    priority: TaskPriority | None = None
    due_date: date | None = None
    estimated_minutes: int | None = None

    @field_validator("title")
    @classmethod
    def _title(cls, value: str | None) -> str:
        if value is None:
            raise ValueError("업무 제목을 입력해 주세요.")
        return _clean_title(value)

    @field_validator("status", "priority")
    @classmethod
    def _not_null(cls, value: str | None) -> str:
        if value is None:
            raise ValueError("값을 선택해 주세요.")
        return value

    _description = field_validator("description")(_clean_description)
    _minutes = field_validator("estimated_minutes", mode="after")(_check_minutes)

    @field_validator("estimated_minutes", mode="before")
    @classmethod
    def _minutes_strict(cls, value: object) -> object:
        if value is not None and (isinstance(value, bool) or not isinstance(value, int)):
            raise ValueError("예상 시간은 분 단위 정수로 입력해 주세요.")
        return value


class TaskOut(BaseModel):
    id: UUID
    project_id: UUID | None
    project_name: str | None
    title: str
    description: str | None
    status: TaskStatus
    priority: TaskPriority
    due_date: date | None
    estimated_minutes: int | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime
