"""업무 시간 기록·타이머 입출력 형식.

시작·끝 시각의 범위(1분~24시간, 미래 금지, 겹침 금지)는 '현재 시각'과 기존 기록이 필요하므로 저장소에서 검사한다.
여기서는 형식(시간대 포함 여부, 메모 길이)만 확인한다.
"""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator

TimeEntrySource = Literal["timer", "manual"]

NOTE_MAX_LENGTH = 500


def _require_timezone(value: datetime | None) -> datetime | None:
    # 시간대 없는 시각은 서버(UTC)와 사용자 중 어느 기준인지 알 수 없어 거절한다
    if value is not None and value.tzinfo is None:
        raise ValueError("시간대가 포함된 시각이어야 합니다.")
    return value


def _clean_note(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if len(value) > NOTE_MAX_LENGTH:
        raise ValueError(f"메모는 {NOTE_MAX_LENGTH}자 이하로 입력해 주세요.")
    return value or None


class TimeEntryCreate(BaseModel):
    """직접 입력한 기록. 끝 시각이 반드시 있어야 한다 (진행 중 기록은 타이머로만)."""

    model_config = ConfigDict(extra="forbid")

    task_id: UUID
    started_at: datetime
    ended_at: datetime
    note: str | None = None

    _tz = field_validator("started_at", "ended_at", mode="after")(_require_timezone)
    _note = field_validator("note", mode="after")(_clean_note)


class TimeEntryUpdate(BaseModel):
    """보낸 항목만 바꾼다. 시작·끝 시각은 null로 지울 수 없다."""

    model_config = ConfigDict(extra="forbid")

    started_at: datetime | None = None
    ended_at: datetime | None = None
    note: str | None = None

    _tz = field_validator("started_at", "ended_at", mode="after")(_require_timezone)
    _note = field_validator("note", mode="after")(_clean_note)

    @field_validator("started_at", "ended_at", mode="before")
    @classmethod
    def _not_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("시각을 입력해 주세요.")
        return value


class TimerStart(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: UUID


class TimerStop(BaseModel):
    """ended_at을 비우면 지금 멈춘다. 오래 켜 둔 타이머는 실제 끝난 시각을 넣는다."""

    model_config = ConfigDict(extra="forbid")

    ended_at: datetime | None = None

    _tz = field_validator("ended_at", mode="after")(_require_timezone)


class TimeEntryOut(BaseModel):
    id: UUID
    task_id: UUID
    task_title: str
    task_status: str
    project_id: UUID | None
    project_name: str | None
    started_at: datetime
    ended_at: datetime | None  # null = 진행 중인 타이머
    source: TimeEntrySource
    note: str | None
    created_at: datetime
    updated_at: datetime


class TimerState(BaseModel):
    running: TimeEntryOut | None
    # 경과 시간을 서버 시각 기준으로 계산할 수 있도록 함께 보낸다 (사용자 PC 시계가 틀려도 정확하게)
    server_now: datetime


class TimerStartResult(BaseModel):
    running: TimeEntryOut
    stopped: TimeEntryOut | None  # 다른 업무 타이머를 멈추고 시작했으면 그 기록
    discarded: bool  # 멈춘 타이머가 1분 미만이라 기록하지 않았으면 true
    server_now: datetime


class TimerStopResult(BaseModel):
    entry: TimeEntryOut | None  # 1분 미만이라 기록하지 않았으면 null
    discarded: bool
