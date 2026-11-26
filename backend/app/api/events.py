"""이벤트 날짜 API (2026-11-26 사용자 확정: 시험·발표·출품/전시·마감·기타, 프로젝트·개인 모두).

GET    /events?start=&end=&project_id=   기간(날짜, 끝 포함)·프로젝트로 거르기
POST   /events
PATCH  /events/{id}
DELETE /events/{id}

시각이 없으면 종일 이벤트. 프로젝트를 지우면 이벤트는 개인 이벤트로 남는다 (DB FK).
"""

from datetime import date, time
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from psycopg import Connection
from psycopg.rows import DictRow
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.auth import CurrentUserDep
from app.core.errors import FieldError
from app.db import UserDbDep
from app.repositories.tasks import PROJECT_NOT_FOUND

router = APIRouter(prefix="/events", tags=["events"])

TITLE_MAX = 100
NOTE_MAX = 500
LIST_LIMIT = 500
EventKind = Literal["exam", "presentation", "exhibition", "deadline", "other"]

_SELECT = """
select e.id, e.project_id, e.title, e.kind, e.event_date,
       to_char(e.start_time, 'HH24:MI') as start_time, to_char(e.end_time, 'HH24:MI') as end_time,
       e.note, e.created_at, e.updated_at,
       nullif(concat_ws(' › ', gp.name, pp.name, p.name), '') as project_path
from public.events e
left join public.projects p on p.id = e.project_id and p.user_id = e.user_id
left join public.projects pp on pp.id = p.parent_id and pp.user_id = e.user_id
left join public.projects gp on gp.id = pp.parent_id and gp.user_id = e.user_id
"""


def _clean_title(value: str) -> str:
    value = " ".join(value.split())
    if not value:
        raise ValueError("이름을 입력해 주세요.")
    if len(value) > TITLE_MAX:
        raise ValueError(f"이름은 {TITLE_MAX}자 이하로 입력해 주세요.")
    return value


def _clean_note(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if len(value) > NOTE_MAX:
        raise ValueError(f"메모는 {NOTE_MAX}자 이하로 입력해 주세요.")
    return value or None


class EventCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    kind: EventKind = "other"
    event_date: date
    start_time: time | None = None
    end_time: time | None = None
    project_id: UUID | None = None
    note: str | None = None

    @field_validator("title", mode="after")
    @classmethod
    def _title(cls, value: str) -> str:
        return _clean_title(value)

    @field_validator("note", mode="after")
    @classmethod
    def _note(cls, value: str | None) -> str | None:
        return _clean_note(value)


class EventUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    kind: EventKind | None = None
    event_date: date | None = None
    start_time: time | None = None
    end_time: time | None = None
    project_id: UUID | None = None
    note: str | None = None

    @field_validator("title", mode="after")
    @classmethod
    def _title(cls, value: str | None) -> str | None:
        return None if value is None else _clean_title(value)

    @field_validator("note", mode="after")
    @classmethod
    def _note(cls, value: str | None) -> str | None:
        return _clean_note(value)


class EventOut(BaseModel):
    id: UUID
    project_id: UUID | None
    project_path: str | None
    title: str
    kind: EventKind
    event_date: date
    start_time: str | None
    end_time: str | None
    note: str | None


def list_events(db: Connection[DictRow], user_id: UUID, *, start: date | None = None, end: date | None = None,
                project_id: UUID | None = None, limit: int = LIST_LIMIT) -> list[DictRow]:
    where = ["e.user_id = %(u)s"]
    params: dict[str, Any] = {"u": user_id, "limit": limit}
    if start is not None:
        where.append("e.event_date >= %(s)s")
        params["s"] = start
    if end is not None:
        where.append("e.event_date <= %(e)s")
        params["e"] = end
    if project_id is not None:
        where.append("e.project_id = %(p)s")
        params["p"] = project_id
    return db.execute(
        _SELECT + " where " + " and ".join(where) + " order by e.event_date, e.start_time nulls first, e.title limit %(limit)s",
        params,
    ).fetchall()


def _get(db: Connection[DictRow], user_id: UUID, event_id: UUID) -> DictRow:
    row = db.execute(_SELECT + " where e.user_id = %s and e.id = %s", (user_id, event_id)).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "이벤트를 찾을 수 없어요. 새로고침해 주세요.")
    return row


def _check(db: Connection[DictRow], user_id: UUID, data: dict[str, Any]) -> None:
    start, end = data.get("start_time"), data.get("end_time")
    if end is not None and start is None:
        raise FieldError("start_time", "끝 시각을 정하려면 시작 시각도 정해 주세요.")
    if start is not None and end is not None and end <= start:
        raise FieldError("end_time", "끝 시각은 시작보다 늦어야 해요.")
    if data.get("project_id") is not None:
        found = db.execute("select 1 from public.projects where user_id = %s and id = %s", (user_id, data["project_id"])).fetchone()
        if found is None:
            raise FieldError("project_id", PROJECT_NOT_FOUND)


@router.get("", response_model=list[EventOut])
def get_events(
    user: CurrentUserDep,
    db: UserDbDep,
    start: date | None = Query(None),
    end: date | None = Query(None),
    project_id: UUID | None = Query(None),
) -> list[DictRow]:
    if start and end and end < start:
        raise FieldError("end", "끝 날짜는 시작 날짜와 같거나 뒤여야 해요.")
    return list_events(db, user.id, start=start, end=end, project_id=project_id)


@router.post("", response_model=EventOut, status_code=status.HTTP_201_CREATED)
def create_event(body: EventCreate, user: CurrentUserDep, db: UserDbDep) -> DictRow:
    data = body.model_dump()
    _check(db, user.id, data)
    row = db.execute(
        """
        insert into public.events (user_id, project_id, title, kind, event_date, start_time, end_time, note)
        values (%(u)s, %(project_id)s, %(title)s, %(kind)s, %(event_date)s, %(start_time)s, %(end_time)s, %(note)s)
        returning id
        """,
        {"u": user.id, **data},
    ).fetchone()
    return _get(db, user.id, row["id"])


@router.patch("/{event_id}", response_model=EventOut)
def update_event(event_id: UUID, body: EventUpdate, user: CurrentUserDep, db: UserDbDep) -> DictRow:
    current = db.execute(
        "select project_id, title, kind, event_date, start_time, end_time, note from public.events where user_id = %s and id = %s for update",
        (user.id, event_id),
    ).fetchone()
    if current is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "이벤트를 찾을 수 없어요. 새로고침해 주세요.")
    patch = body.model_dump(exclude_unset=True)
    for required in ("title", "kind", "event_date"):
        if required in patch and patch[required] is None:
            raise FieldError(required, "값을 입력해 주세요.")
    merged = {**current, **patch}
    _check(db, user.id, merged)
    db.execute(
        """
        update public.events set project_id = %(project_id)s, title = %(title)s, kind = %(kind)s, event_date = %(event_date)s,
          start_time = %(start_time)s, end_time = %(end_time)s, note = %(note)s
        where user_id = %(u)s and id = %(id)s
        """,
        {**merged, "u": user.id, "id": event_id},
    )
    return _get(db, user.id, event_id)


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(event_id: UUID, user: CurrentUserDep, db: UserDbDep) -> None:
    deleted = db.execute("delete from public.events where user_id = %s and id = %s returning id", (user.id, event_id)).fetchone()
    if deleted is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "이벤트를 찾을 수 없어요. 새로고침해 주세요.")
