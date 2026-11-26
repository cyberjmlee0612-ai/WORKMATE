"""업무 시간 기록·타이머 SQL. RLS가 적용된 연결에서 실행되며 user_id 조건도 함께 건다(이중 확인).

규칙 (2026-11-26 사용자 확정, 마이그레이션 20261126000000 참고):
  * 진행 중인 타이머는 사용자당 하나. 다른 업무에서 시작하면 기존 타이머를 지금 시각으로 멈춘다.
  * 기록끼리 시간이 겹치면 저장하지 않는다 → ConflictError(code="overlap", conflict=겹친 기록).
  * 기록은 1분~24시간. 1분 미만으로 멈춘 타이머는 기록하지 않는다(삭제).
  * 12시간 이상 켜 둔 타이머는 사용자가 실제 끝난 시각을 확인해야 하므로 자동으로 멈추지 않는다.
'지금'은 DB의 now()(트랜잭션 시작 시각)를 쓴다. 사용자 PC 시계와 무관하고, 한 요청 안에서 같은 값이다.
"""

from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from psycopg import Connection, sql
from psycopg.rows import DictRow

from app.core.errors import ConflictError, FieldError
from app.schemas.time_entry import TimeEntryCreate, TimeEntryUpdate

MIN_DURATION = timedelta(minutes=1)
MAX_DURATION = timedelta(hours=24)
LONG_RUNNING = timedelta(hours=12)
LIST_LIMIT = 1000
CLOSED_TASK_STATUSES = ("completed", "cancelled")

_SELECT = """
select
  e.id, e.task_id, t.title as task_title, t.status as task_status, t.project_id, p.name as project_name,
  e.started_at, e.ended_at, e.source, e.note, e.created_at, e.updated_at
from public.task_time_entries e
join public.tasks t on t.id = e.task_id and t.user_id = e.user_id
left join public.projects p on p.id = t.project_id and p.user_id = t.user_id
"""

TASK_NOT_FOUND = "업무를 찾을 수 없습니다. 목록을 새로고침한 뒤 다시 선택해 주세요."
LONG_TIMER_MESSAGE = "타이머가 12시간 넘게 켜져 있어요. 먼저 타이머를 멈추고 실제로 끝난 시각을 확인해 주세요."


def now(db: Connection[DictRow]) -> datetime:
    row = db.execute("select now() as now").fetchone()
    assert row is not None
    return row["now"]


def _get(db: Connection[DictRow], user_id: UUID, entry_id: UUID) -> DictRow | None:
    return db.execute(_SELECT + " where e.user_id = %s and e.id = %s", (user_id, entry_id)).fetchone()


def get_running(db: Connection[DictRow], user_id: UUID) -> DictRow | None:
    return db.execute(_SELECT + " where e.user_id = %s and e.ended_at is null", (user_id,)).fetchone()


def list_entries(
    db: Connection[DictRow],
    user_id: UUID,
    *,
    task_id: UUID | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
) -> list[DictRow]:
    """최신순. start~end를 주면 그 구간과 겹치는 기록(시간표용), task_id를 주면 그 업무의 기록."""
    conditions = [sql.SQL("e.user_id = %(user_id)s")]
    params: dict[str, Any] = {"user_id": user_id, "limit": LIST_LIMIT}
    if task_id is not None:
        conditions.append(sql.SQL("e.task_id = %(task_id)s"))
        params["task_id"] = task_id
    if start is not None:
        conditions.append(sql.SQL("coalesce(e.ended_at, 'infinity'::timestamptz) > %(start)s"))
        params["start"] = start
    if end is not None:
        conditions.append(sql.SQL("e.started_at < %(end)s"))
        params["end"] = end
    query = sql.SQL(_SELECT + " where {} order by e.started_at desc limit %(limit)s").format(sql.SQL(" and ").join(conditions))
    return db.execute(query, params).fetchall()


def _find_overlap(db: Connection[DictRow], user_id: UUID, start: datetime, end: datetime | None, exclude_id: UUID | None) -> DictRow | None:
    return db.execute(
        _SELECT
        + """
        where e.user_id = %(u)s
          and (%(exclude)s::uuid is null or e.id <> %(exclude)s::uuid)
          and tstzrange(e.started_at, coalesce(e.ended_at, 'infinity'::timestamptz), '[)')
              && tstzrange(%(start)s, coalesce(%(end)s::timestamptz, 'infinity'::timestamptz), '[)')
        order by e.started_at
        limit 1
        """,
        {"u": user_id, "exclude": exclude_id, "start": start, "end": end},
    ).fetchone()


def _ensure_no_overlap(db: Connection[DictRow], user_id: UUID, start: datetime, end: datetime | None, exclude_id: UUID | None = None) -> None:
    conflict = _find_overlap(db, user_id, start, end, exclude_id)
    if conflict is not None:
        raise ConflictError("다른 기록과 시간이 겹쳐요. 시각을 조정해 주세요.", "overlap", conflict=dict(conflict))


def _check_closed_range(start: datetime, end: datetime, current: datetime) -> None:
    """끝난 기록의 시작·끝 시각 검사. 오류는 끝 시각 칸에 표시한다(시작이 미래면 시작 칸)."""
    if start > current:
        raise FieldError("started_at", "미래 시각은 기록할 수 없어요.")
    if end > current:
        raise FieldError("ended_at", "미래 시각은 기록할 수 없어요.")
    if end <= start:
        raise FieldError("ended_at", "끝난 시각은 시작 시각보다 늦어야 해요.")
    if end - start < MIN_DURATION:
        raise FieldError("ended_at", "기록은 1분 이상이어야 해요.")
    if end - start > MAX_DURATION:
        raise FieldError("ended_at", "기록 하나는 최대 24시간이에요. 나눠서 기록해 주세요.")


def _lock_running(db: Connection[DictRow], user_id: UUID) -> DictRow | None:
    return db.execute(
        "select id, task_id, started_at from public.task_time_entries where user_id = %s and ended_at is null for update",
        (user_id,),
    ).fetchone()


def _close_running(db: Connection[DictRow], user_id: UUID, running: DictRow, end: datetime) -> tuple[DictRow | None, bool]:
    """진행 중인 기록을 end에 멈춘다. 1분 미만이면 기록하지 않고 지운다. (멈춘 기록, 버렸는지)"""
    if end - running["started_at"] < MIN_DURATION:
        db.execute("delete from public.task_time_entries where user_id = %s and id = %s", (user_id, running["id"]))
        return None, True
    db.execute(
        "update public.task_time_entries set ended_at = %s where user_id = %s and id = %s",
        (end, user_id, running["id"]),
    )
    return _get(db, user_id, running["id"]), False


# ---------------------------------------------------------------- 타이머


def start_timer(db: Connection[DictRow], user_id: UUID, task_id: UUID) -> dict[str, Any] | None:
    """업무 타이머 시작. 업무가 없으면 None. 이미 이 업무의 타이머가 돌고 있으면 그대로 돌려준다."""
    task = db.execute(
        "select status from public.tasks where user_id = %s and id = %s for update",
        (user_id, task_id),
    ).fetchone()
    if task is None:
        return None
    if task["status"] in CLOSED_TASK_STATUSES:
        raise ConflictError("완료했거나 제외한 업무는 타이머를 시작할 수 없어요. 상태를 바꾼 뒤 시작해 주세요.", "task_closed")

    current = now(db)
    running = _lock_running(db, user_id)
    stopped, discarded = None, False
    if running is not None:
        if running["task_id"] == task_id:
            entry = _get(db, user_id, running["id"])
            return {"running": entry, "stopped": None, "discarded": False, "server_now": current}
        if current - running["started_at"] >= LONG_RUNNING:
            raise ConflictError(LONG_TIMER_MESSAGE, "timer_needs_review")
        stopped, discarded = _close_running(db, user_id, running, current)

    row = db.execute(
        """
        insert into public.task_time_entries (user_id, task_id, started_at, source)
        values (%s, %s, %s, 'timer')
        returning id
        """,
        (user_id, task_id, current),
    ).fetchone()
    assert row is not None
    return {"running": _get(db, user_id, row["id"]), "stopped": stopped, "discarded": discarded, "server_now": current}


def stop_timer(db: Connection[DictRow], user_id: UUID, ended_at: datetime | None = None) -> dict[str, Any]:
    """진행 중인 타이머를 멈춘다. ended_at이 없으면 지금 시각.

    12시간 이상 켜져 있었다면 ended_at(실제 끝난 시각)을 반드시 받는다.
    """
    running = _lock_running(db, user_id)
    if running is None:
        raise ConflictError("진행 중인 타이머가 없어요. 다른 곳에서 이미 멈췄을 수 있어요.", "no_running_timer")

    current = now(db)
    if ended_at is None:
        if current - running["started_at"] >= LONG_RUNNING:
            raise ConflictError(LONG_TIMER_MESSAGE, "timer_needs_review", started_at=running["started_at"])
        entry, discarded = _close_running(db, user_id, running, current)
    else:
        _check_closed_range(running["started_at"], ended_at, current)
        entry, discarded = _close_running(db, user_id, running, ended_at)
    return {"entry": entry, "discarded": discarded}


def stop_for_task(db: Connection[DictRow], user_id: UUID, task_id: UUID) -> None:
    """업무를 완료·제외할 때 그 업무의 타이머를 멈춘다. 12시간 이상이면 사용자 확인이 필요하므로 막는다."""
    running = _lock_running(db, user_id)
    if running is None or running["task_id"] != task_id:
        return
    current = now(db)
    if current - running["started_at"] >= LONG_RUNNING:
        raise ConflictError(LONG_TIMER_MESSAGE, "timer_needs_review")
    _close_running(db, user_id, running, current)


# ---------------------------------------------------------------- 직접 입력·수정·삭제


def create_entry(db: Connection[DictRow], user_id: UUID, data: TimeEntryCreate) -> DictRow:
    task = db.execute("select 1 from public.tasks where user_id = %s and id = %s", (user_id, data.task_id)).fetchone()
    if task is None:
        raise FieldError("task_id", TASK_NOT_FOUND)
    _check_closed_range(data.started_at, data.ended_at, now(db))
    _ensure_no_overlap(db, user_id, data.started_at, data.ended_at)

    row = db.execute(
        """
        insert into public.task_time_entries (user_id, task_id, started_at, ended_at, source, note)
        values (%s, %s, %s, %s, 'manual', %s)
        returning id
        """,
        (user_id, data.task_id, data.started_at, data.ended_at, data.note),
    ).fetchone()
    assert row is not None
    created = _get(db, user_id, row["id"])
    assert created is not None
    return created


def update_entry(db: Connection[DictRow], user_id: UUID, entry_id: UUID, data: TimeEntryUpdate) -> DictRow | None:
    """없거나 남의 기록이면 None. 진행 중인 타이머는 시작 시각·메모만 고칠 수 있다(끝내기는 '멈춤')."""
    changes: dict[str, Any] = data.model_dump(exclude_unset=True)
    entry = db.execute(
        "select id, started_at, ended_at from public.task_time_entries where user_id = %s and id = %s for update",
        (user_id, entry_id),
    ).fetchone()
    if entry is None:
        return None

    start = changes.get("started_at", entry["started_at"])
    end = changes.get("ended_at", entry["ended_at"])
    if "started_at" in changes or "ended_at" in changes:
        current = now(db)
        if entry["ended_at"] is None:
            if "ended_at" in changes:
                raise FieldError("ended_at", "진행 중인 타이머는 ‘멈춤’으로 끝내 주세요.")
            if start > current:
                raise FieldError("started_at", "미래 시각은 기록할 수 없어요.")
        else:
            _check_closed_range(start, end, current)
        _ensure_no_overlap(db, user_id, start, end, exclude_id=entry_id)

    if changes:
        assignments = sql.SQL(", ").join(
            sql.SQL("{} = {}").format(sql.Identifier(column), sql.Placeholder(column)) for column in changes
        )
        db.execute(
            sql.SQL("update public.task_time_entries set {} where user_id = %(user_id)s and id = %(entry_id)s").format(assignments),
            {**changes, "user_id": user_id, "entry_id": entry_id},
        )
    return _get(db, user_id, entry_id)


def delete_entry(db: Connection[DictRow], user_id: UUID, entry_id: UUID) -> bool:
    row = db.execute(
        "delete from public.task_time_entries where user_id = %s and id = %s returning id",
        (user_id, entry_id),
    ).fetchone()
    return row is not None
