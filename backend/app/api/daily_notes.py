"""날짜별 메모 API (시간표 일간 보기). 날짜는 사용자 시간대 기준 달력 날짜("YYYY-MM-DD").

GET  /daily-notes/{date}  메모가 없으면 content="" (404 대신 빈 메모)
PUT  /daily-notes/{date}  전체 내용 저장. 빈 내용이면 삭제한다.
"""

from datetime import date, datetime
from uuid import UUID

from fastapi import APIRouter
from psycopg import Connection
from psycopg.rows import DictRow
from pydantic import BaseModel, ConfigDict, field_validator

from app.core.auth import CurrentUserDep
from app.db import UserDbDep

router = APIRouter(prefix="/daily-notes", tags=["time"])

CONTENT_MAX_LENGTH = 5000


class DailyNoteSave(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str

    @field_validator("content", mode="after")
    @classmethod
    def _check(cls, value: str) -> str:
        if len(value) > CONTENT_MAX_LENGTH:
            raise ValueError(f"메모는 {CONTENT_MAX_LENGTH:,}자 이하로 입력해 주세요.")
        return value


class DailyNoteOut(BaseModel):
    note_date: date
    content: str
    updated_at: datetime | None  # 저장된 적 없으면 null


def _get(db: Connection[DictRow], user_id: UUID, note_date: date) -> dict:
    row = db.execute(
        "select note_date, content, updated_at from public.daily_notes where user_id = %s and note_date = %s",
        (user_id, note_date),
    ).fetchone()
    return dict(row) if row else {"note_date": note_date, "content": "", "updated_at": None}


@router.get("/{note_date}", response_model=DailyNoteOut)
def get_note(note_date: date, user: CurrentUserDep, db: UserDbDep) -> dict:
    return _get(db, user.id, note_date)


@router.put("/{note_date}", response_model=DailyNoteOut)
def save_note(note_date: date, body: DailyNoteSave, user: CurrentUserDep, db: UserDbDep) -> dict:
    # 공백만 남으면 지운 것으로 본다 (빈 메모 행을 남기지 않음). 내용 자체는 앞뒤 공백·줄바꿈을 보존한다.
    if not body.content.strip():
        db.execute("delete from public.daily_notes where user_id = %s and note_date = %s", (user.id, note_date))
    else:
        db.execute(
            """
            insert into public.daily_notes (user_id, note_date, content) values (%s, %s, %s)
            on conflict (user_id, note_date) do update set content = excluded.content
            """,
            (user.id, note_date, body.content),
        )
    return _get(db, user.id, note_date)
