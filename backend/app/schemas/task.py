from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, ValidationInfo, field_validator

# cancelled = '업무에서 제외'. 삭제와 달리 보존되며 KPI·진행률 계산에서 빠진다.
TaskStatus = Literal["todo", "in_progress", "review", "completed", "cancelled"]
# 새 업무는 제외 상태로 만들 수 없다
CreatableTaskStatus = Literal["todo", "in_progress", "review", "completed"]
TaskPriority = Literal["low", "medium", "high", "urgent"]
TaskScope = Literal["all", "project", "personal"]

TITLE_MAX_LENGTH = 300
DESCRIPTION_MAX_LENGTH = 2000
CANCEL_REASON_MAX_LENGTH = 500
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
    status: CreatableTaskStatus = "todo"
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
    """PATCH: 보낸 필드만 바꾼다.

    - project_id에 null을 보내면 개인 업무로 전환된다.
    - status를 'cancelled'로 바꾸면 업무에서 제외된다(cancel_reason은 선택).
      다른 상태로 바꾸면 제외가 풀리고 시각·사유는 DB 트리거가 비운다.
    """

    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    description: str | None = None
    project_id: UUID | None = None
    status: TaskStatus | None = None
    priority: TaskPriority | None = None
    due_date: date | None = None
    estimated_minutes: int | None = None
    cancel_reason: str | None = None

    @field_validator("cancel_reason")
    @classmethod
    def _cancel_reason(cls, value: str | None, info: ValidationInfo) -> str | None:
        if value is None:
            return None
        # 사유는 제외할 때만 의미가 있다. 다른 상태로 바꾸면서 사유를 보내는 것은 실수로 본다.
        # (status 필드가 먼저 선언되어 있어 info.data에서 읽을 수 있다)
        status = info.data.get("status")
        if status is not None and status != "cancelled":
            raise ValueError("제외 사유는 업무를 제외할 때만 입력할 수 있습니다.")
        value = value.strip()
        if len(value) > CANCEL_REASON_MAX_LENGTH:
            raise ValueError(f"제외 사유는 {CANCEL_REASON_MAX_LENGTH}자 이하로 입력해 주세요.")
        return value or None

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
    cancelled_at: datetime | None
    cancel_reason: str | None
    tracked_minutes: int = 0  # 실제 기록 시간 합계 (끝난 기록만)
    created_at: datetime
    updated_at: datetime
