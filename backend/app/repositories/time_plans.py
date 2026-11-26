"""업무 계획 블록 SQL. RLS가 적용된 연결에서 실행되며 user_id 조건도 함께 건다(이중 확인).

규칙 (2026-11-26 사용자 확정, 마이그레이션 20261126010000 참고):
  * 같은 업무를 여러 번 배치할 수 있고, 계획끼리 겹쳐도 된다.
  * 블록은 10분~24시간. 과거 시각에도 계획을 둘 수 있다(지난 계획과 실제 비교용).
  * 완료·제외한 업무는 새로 배치할 수 없다. 이미 놓인 계획은 옮기거나 지울 수 있다.

밀린 계획 (2026-11-26 사용자 확정, 마이그레이션 20261126080000):
  * 끝난 지 7일 안의 계획 중 처리하지 않았고, 업무가 미완료이며, 그 시간에 그 업무를 기록한 시간이 계획의 절반 미만.
  * 처리하면 원래 블록은 남기고 결과(resolution)를 적는다: rescheduled / done / let_go.
"""

from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from psycopg import Connection, sql
from psycopg.rows import DictRow

from app.core.errors import ConflictError, FieldError
from app.repositories.time_entries import CLOSED_TASK_STATUSES, TASK_NOT_FOUND
from app.schemas.time_plan import TimePlanCreate, TimePlanUpdate

MIN_DURATION = timedelta(minutes=10)
MAX_DURATION = timedelta(hours=24)
LIST_LIMIT = 1000

# 밀린 계획 조건 (now()는 요청 트랜잭션 시작 시각)
_MISSED = """(
  pl.resolution is null
  and pl.ends_at <= now() and pl.ends_at > now() - interval '7 days'
  and t.status not in ('completed', 'cancelled')
  and coalesce((
    select sum(extract(epoch from least(coalesce(e.ended_at, now()), pl.ends_at) - greatest(e.started_at, pl.starts_at)))
    from public.task_time_entries e
    where e.user_id = pl.user_id and e.task_id = pl.task_id and e.started_at < pl.ends_at and coalesce(e.ended_at, now()) > pl.starts_at
  ), 0) * 2 < extract(epoch from pl.ends_at - pl.starts_at)
)"""

_SELECT = """
select
  pl.id, pl.task_id, t.title as task_title, t.status as task_status, t.project_id, p.name as project_name,
  pl.starts_at, pl.ends_at, pl.created_at, pl.updated_at, pl.resolution,
  {missed} as missed
from public.task_time_plans pl
join public.tasks t on t.id = pl.task_id and t.user_id = pl.user_id
left join public.projects p on p.id = t.project_id and p.user_id = t.user_id
""".format(missed=_MISSED)


def _check_range(start: datetime, end: datetime) -> None:
    if end <= start:
        raise FieldError("ends_at", "끝 시각은 시작 시각보다 늦어야 해요.")
    if end - start < MIN_DURATION:
        raise FieldError("ends_at", "계획은 10분 이상이어야 해요.")
    if end - start > MAX_DURATION:
        raise FieldError("ends_at", "계획 하나는 최대 24시간이에요.")


def _get(db: Connection[DictRow], user_id: UUID, plan_id: UUID) -> DictRow | None:
    return db.execute(_SELECT + " where pl.user_id = %s and pl.id = %s", (user_id, plan_id)).fetchone()


def list_plans(db: Connection[DictRow], user_id: UUID, *, start: datetime, end: datetime) -> list[DictRow]:
    """start~end 구간과 겹치는 계획 (시작 시각 순)."""
    return db.execute(
        _SELECT + " where pl.user_id = %s and pl.ends_at > %s and pl.starts_at < %s order by pl.starts_at limit %s",
        (user_id, start, end, LIST_LIMIT),
    ).fetchall()


def create_plan(db: Connection[DictRow], user_id: UUID, data: TimePlanCreate) -> DictRow:
    task = db.execute("select status from public.tasks where user_id = %s and id = %s", (user_id, data.task_id)).fetchone()
    if task is None:
        raise FieldError("task_id", TASK_NOT_FOUND)
    if task["status"] in CLOSED_TASK_STATUSES:
        raise ConflictError("완료했거나 제외한 업무는 새로 배치할 수 없어요.", "task_closed")
    _check_range(data.starts_at, data.ends_at)
    row = db.execute(
        "insert into public.task_time_plans (user_id, task_id, starts_at, ends_at) values (%s, %s, %s, %s) returning id",
        (user_id, data.task_id, data.starts_at, data.ends_at),
    ).fetchone()
    assert row is not None
    created = _get(db, user_id, row["id"])
    assert created is not None
    return created


def update_plan(db: Connection[DictRow], user_id: UUID, plan_id: UUID, data: TimePlanUpdate) -> DictRow | None:
    """없거나 남의 계획이면 None."""
    changes: dict[str, Any] = data.model_dump(exclude_unset=True)
    plan = db.execute(
        "select starts_at, ends_at from public.task_time_plans where user_id = %s and id = %s for update",
        (user_id, plan_id),
    ).fetchone()
    if plan is None:
        return None
    _check_range(changes.get("starts_at", plan["starts_at"]), changes.get("ends_at", plan["ends_at"]))
    if changes:
        assignments = sql.SQL(", ").join(
            sql.SQL("{} = {}").format(sql.Identifier(column), sql.Placeholder(column)) for column in changes
        )
        db.execute(
            sql.SQL("update public.task_time_plans set {} where user_id = %(user_id)s and id = %(plan_id)s").format(assignments),
            {**changes, "user_id": user_id, "plan_id": plan_id},
        )
    return _get(db, user_id, plan_id)


def delete_plan(db: Connection[DictRow], user_id: UUID, plan_id: UUID) -> bool:
    row = db.execute(
        "delete from public.task_time_plans where user_id = %s and id = %s returning id",
        (user_id, plan_id),
    ).fetchone()
    return row is not None


def list_missed(db: Connection[DictRow], user_id: UUID, limit: int = 30) -> list[DictRow]:
    """밀린 계획 (오래된 순)."""
    return db.execute(_SELECT + " where pl.user_id = %s and " + _MISSED + " order by pl.starts_at limit %s", (user_id, limit)).fetchall()


def get_plan(db: Connection[DictRow], user_id: UUID, plan_id: UUID) -> DictRow | None:
    return _get(db, user_id, plan_id)


def mark_resolved(db: Connection[DictRow], user_id: UUID, plan_id: UUID, resolution: str) -> None:
    db.execute(
        "update public.task_time_plans set resolution = %s, resolved_at = now() where user_id = %s and id = %s",
        (resolution, user_id, plan_id),
    )


def lock_for_resolve(db: Connection[DictRow], user_id: UUID, plan_id: UUID) -> DictRow | None:
    """처리할 계획을 잠그고 돌려준다. 없으면 None. 이미 처리했거나 아직 끝나지 않았으면 409."""
    row = db.execute(
        "select id, task_id, starts_at, ends_at, resolution, ends_at <= now() as ended from public.task_time_plans where user_id = %s and id = %s for update",
        (user_id, plan_id),
    ).fetchone()
    if row is None:
        return None
    if row["resolution"] is not None:
        raise ConflictError("이미 처리한 계획이에요. 새로고침해 주세요.", "already_resolved")
    if not row["ended"]:
        raise ConflictError("아직 끝나지 않은 계획이에요.", "not_ended")
    return row

