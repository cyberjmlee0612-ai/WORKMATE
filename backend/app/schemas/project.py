from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

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
    parent_id: UUID | None = None  # 상위 프로젝트 (없으면 최상위). 최대 3단계

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
    parent_id: UUID | None = None  # null을 보내면 최상위로 꺼낸다

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
    parent_id: UUID | None = None
    parent_name: str | None = None
    subproject_count: int = 0  # 바로 아래 하위 프로젝트 수
    # 진행률 관련 수는 하위 프로젝트 업무까지 합산 (2026-11-26 사용자 확정)
    total_tasks: int  # 제외(cancelled)된 업무는 빠진 수
    completed_tasks: int
    progress: int  # 0–100, 내림 (99.6% → 99%)
    # 이 프로젝트에 직접 속한 업무만
    own_total_tasks: int = 0
    own_completed_tasks: int = 0
    cancelled_tasks: int
    completed_at: datetime | None  # 현재 완료 상태일 때: 마지막 완료 시각
    open_tasks_at_completion: int | None  # 현재 완료 상태일 때: 완료 당시 미완료 업무 수
    archived_at: datetime | None  # 현재 보관 상태일 때: 마지막 보관 시각


ProjectAction = Literal["complete", "archive", "restore"]


class ProjectCompleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # 확인 창에서 사용자에게 보여준 미완료 업무 수. 실제 수와 다르면 409로 다시 확인시킨다.
    confirmed_open_tasks: int = Field(ge=0)


class ProjectStatusEvent(BaseModel):
    id: UUID
    action: ProjectAction
    from_status: ProjectStatus
    to_status: ProjectStatus
    open_tasks: int | None
    occurred_at: datetime
    via_project_name: str | None = None  # 상위 프로젝트와 함께 보관·복원된 경우 그 상위 이름
