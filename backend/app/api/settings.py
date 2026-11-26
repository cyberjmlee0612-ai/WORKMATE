"""사용자 설정 API (2026-11-26 사용자 확정).

GET /settings   표시 이름 (저장한 적 없으면 null)
PUT /settings   저장 (한 행 upsert)

일하는 시간·쉬는 시간은 요일별 반복 블록(/schedule-blocks)으로 옮겼다.
"""

from typing import Any
from uuid import UUID

from fastapi import APIRouter
from psycopg import Connection
from psycopg.rows import DictRow
from pydantic import BaseModel, ConfigDict, field_validator

from app.core.auth import CurrentUserDep
from app.db import UserDbDep

router = APIRouter(prefix="/settings", tags=["settings"])

DISPLAY_NAME_MAX = 30
DEFAULTS: dict[str, Any] = {"display_name": None}


class SettingsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: str | None = None

    @field_validator("display_name", mode="after")
    @classmethod
    def _name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = " ".join(value.split())  # 앞뒤·연속 공백 정리
        if len(value) > DISPLAY_NAME_MAX:
            raise ValueError(f"이름은 {DISPLAY_NAME_MAX}자 이하로 입력해 주세요.")
        return value or None


class SettingsOut(BaseModel):
    email: str | None
    display_name: str | None


def read_settings(db: Connection[DictRow], user_id: UUID) -> dict[str, Any]:
    row = db.execute("select display_name from public.user_settings where user_id = %s", (user_id,)).fetchone()
    return dict(row) if row else dict(DEFAULTS)


@router.get("", response_model=SettingsOut)
def get_settings_route(user: CurrentUserDep, db: UserDbDep) -> dict:
    return {"email": user.email, **read_settings(db, user.id)}


@router.put("", response_model=SettingsOut)
def put_settings(body: SettingsIn, user: CurrentUserDep, db: UserDbDep) -> dict:
    db.execute(
        """
        insert into public.user_settings (user_id, display_name) values (%s, %s)
        on conflict (user_id) do update set display_name = excluded.display_name
        """,
        (user.id, body.display_name),
    )
    return {"email": user.email, **read_settings(db, user.id)}
