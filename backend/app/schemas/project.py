from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator, model_validator

ProjectStatus = Literal["planning", "in_progress", "review", "completed", "archived"]
# 생성·수정 폼에서 직접 고를 수 있는 상태. completed/archived는 P1 완료·보관 흐름에서만 바꾼다.
EditableProjectStatus = Literal["planning", "in_progress", "review"]

NAME_MAX_LENGTH = 200
DESCRIPTION_MAX_LENGTH = 2000


def _clean_name(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("프로젝트 이름을 입력해 주세요.")
    if len(value) > NAME_MAX_LENGTH:
        raise ValueError(f"프로젝트 이름은 {NAME_MAX_LENGTH}자 이하로 입력해 주세요.")
    return value


def _clean_description(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if len(value) > DESCRIPTION_MAX_LENGTH:
        raise ValueError(f"설명은 {DESCRIPTION_MAX_LENGTH}자 이하로 입력해 주세요.")
    return value or None  # 공백만 있으면 비어 있는 것으로 저장


def check_date_order(start_date: date | None, due_date: date | None) -> None:
    if start_date and due_date and start_date > due_date:
        raise ValueError("마감일은 시작일과 같거나 이후여야 합니다.")


class ProjectCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")  # user_id 등 클라이언트가 정하면 안 되는 필드를 거절

    name: str
    description: str | None = None
    status: EditableProjectStatus = "planning"
    start_date: date | None = None
    due_date: date | None = None

    _name = field_validator("name")(_clean_name)
    _description = field_validator("description")(_clean_description)

    @model_validator(mode="after")
    def _dates(self) -> "ProjectCreate":
        check_date_order(self.start_date, self.due_date)
        return self


class ProjectUpdate(BaseModel):
    """PATCH: 보낸 필드만 바꾼다. 날짜 순서는 기존 값과 합친 뒤 저장소에서 다시 검사한다."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    description: str | None = None
    status: EditableProjectStatus | None = None
    start_date: date | None = None
    due_date: date | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, value: str | None) -> str:
        if value is None:
            raise ValueError("프로젝트 이름을 입력해 주세요.")
        return _clean_name(value)

    @field_validator("status")
    @classmethod
    def _status(cls, value: str | None) -> str:
        if value is None:
            raise ValueError("상태를 선택해 주세요.")
        return value

    _description = field_validator("description")(_clean_description)

    @model_validator(mode="after")
    def _dates(self) -> "ProjectUpdate":
        check_date_order(self.start_date, self.due_date)
        return self


class ProjectOut(BaseModel):
    id: UUID
    name: str
    description: str | None
    status: ProjectStatus
    start_date: date | None
    due_date: date | None
    created_at: datetime
    updated_at: datetime
    total_tasks: int
    completed_tasks: int
    progress: int  # 0–100, 내림 (99.6% → 99%)
