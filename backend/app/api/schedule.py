"""요일별 반복 시간 블록 API (2026-11-26 사용자 확정).

GET /schedule-blocks   내 블록 전체 (시작 시각 순)
PUT /schedule-blocks   전체 바꾸기 (설정 화면에서 한 번에 저장, 하나라도 잘못되면 아무것도 바뀌지 않음)

종류: work(일·공부 시간: AI가 업무를 배치하는 곳), fixed(수업·고정 일정), break(쉬는 시간).
요일은 0=일 … 6=토 목록으로 주고받고, DB에는 비트 묶음(일=1 … 토=64)으로 저장한다.
"""

from typing import Literal
from uuid import UUID

from fastapi import APIRouter
from psycopg import Connection
from psycopg.rows import DictRow
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.auth import CurrentUserDep
from app.db import UserDbDep

router = APIRouter(prefix="/schedule-blocks", tags=["schedule"])

MAX_BLOCKS = 50
TITLE_MAX = 40
HHMM = r"^(([01]\d|2[0-3]):[0-5]\d|24:00)$"
BlockKind = Literal["work", "fixed", "break"]


def to_minutes(value: str) -> int:
    h, m = value.split(":")
    return int(h) * 60 + int(m)


def weekdays_to_mask(days: list[int]) -> int:
    return sum(1 << d for d in set(days))


def mask_to_weekdays(mask: int) -> list[int]:
    return [d for d in range(7) if mask & (1 << d)]


class BlockIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    kind: BlockKind
    weekdays: list[int] = Field(min_length=1, max_length=7)
    start: str = Field(pattern=HHMM)
    end: str = Field(pattern=HHMM)

    @field_validator("title", mode="after")
    @classmethod
    def _title(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("이름을 입력해 주세요.")
        if len(value) > TITLE_MAX:
            raise ValueError(f"이름은 {TITLE_MAX}자 이하로 입력해 주세요.")
        return value

    @field_validator("weekdays", mode="after")
    @classmethod
    def _days(cls, value: list[int]) -> list[int]:
        if any(d < 0 or d > 6 for d in value):
            raise ValueError("요일이 올바르지 않아요.")
        return sorted(set(value))

    @model_validator(mode="after")
    def _window(self) -> "BlockIn":
        if self.start == "24:00":
            raise ValueError("시작 시각은 24:00이 될 수 없어요.")
        if to_minutes(self.end) - to_minutes(self.start) < 10:
            raise ValueError("끝 시각은 시작보다 10분 이상 늦어야 해요.")
        return self


class BlocksReplace(BaseModel):
    model_config = ConfigDict(extra="forbid")

    blocks: list[BlockIn] = Field(max_length=MAX_BLOCKS)


class BlockOut(BaseModel):
    id: UUID
    title: str
    kind: BlockKind
    weekdays: list[int]
    start: str
    end: str


def list_blocks(db: Connection[DictRow], user_id: UUID) -> list[dict]:
    rows = db.execute(
        """
        select id, title, kind, weekdays, to_char(start_time, 'HH24:MI') as start, to_char(end_time, 'HH24:MI') as "end"
        from public.schedule_blocks where user_id = %s
        order by start_time, end_time, title
        """,
        (user_id,),
    ).fetchall()
    return [{**r, "weekdays": mask_to_weekdays(r["weekdays"])} for r in rows]


def blocks_for_weekday(db: Connection[DictRow], user_id: UUID, weekday: int) -> list[dict]:
    """weekday: 0=일 … 6=토"""
    return [b for b in list_blocks(db, user_id) if weekday in b["weekdays"]]


@router.get("", response_model=list[BlockOut])
def get_blocks(user: CurrentUserDep, db: UserDbDep) -> list[dict]:
    return list_blocks(db, user.id)


@router.put("", response_model=list[BlockOut])
def replace_blocks(body: BlocksReplace, user: CurrentUserDep, db: UserDbDep) -> list[dict]:
    db.execute("delete from public.schedule_blocks where user_id = %s", (user.id,))
    for b in body.blocks:
        db.execute(
            "insert into public.schedule_blocks (user_id, title, kind, weekdays, start_time, end_time) values (%s, %s, %s, %s, %s, %s)",
            (user.id, b.title, b.kind, weekdays_to_mask(b.weekdays), b.start, b.end),
        )
    return list_blocks(db, user.id)
