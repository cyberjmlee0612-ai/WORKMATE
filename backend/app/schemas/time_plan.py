"""업무 계획 블록 입출력 형식. 시간 범위(10분~24시간) 검사는 기존 값과 합쳐야 해서 저장소에서 한다."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator

from app.schemas.time_entry import _require_timezone


class TimePlanCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: UUID
    starts_at: datetime
    ends_at: datetime

    _tz = field_validator("starts_at", "ends_at", mode="after")(_require_timezone)


class TimePlanUpdate(BaseModel):
    """끌어서 옮기기·길이 조절. 보낸 항목만 바꾸며 null은 허용하지 않는다."""

    model_config = ConfigDict(extra="forbid")

    starts_at: datetime | None = None
    ends_at: datetime | None = None

    _tz = field_validator("starts_at", "ends_at", mode="after")(_require_timezone)

    @field_validator("starts_at", "ends_at", mode="before")
    @classmethod
    def _not_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("시각을 입력해 주세요.")
        return value


class TimePlanOut(BaseModel):
    id: UUID
    task_id: UUID
    task_title: str
    task_status: str
    project_id: UUID | None
    project_name: str | None
    starts_at: datetime
    ends_at: datetime
    created_at: datetime
    updated_at: datetime
    # 밀린 계획 처리 결과: rescheduled(다시 배치함, 원래 블록은 '놓침') / done(기록으로 바꿈) / let_go(놓아줌)
    resolution: str | None = None
    missed: bool = False  # 끝났는데 거의 기록하지 않은 계획 (최근 7일, 미처리)
