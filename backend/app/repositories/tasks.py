"""업무 SQL. RLS가 적용된 연결에서 실행되며 user_id 조건도 함께 건다(이중 확인)."""

from typing import Any
from uuid import UUID

from psycopg import Connection, sql
from psycopg.rows import DictRow

from app.core.errors import FieldError
from app.repositories import time_entries as time_repo
from app.schemas.task import TaskCreate, TaskScope, TaskUpdate

LIST_LIMIT = 500  # 페이지 나누기를 도입하기 전 안전장치

_SELECT = """
select
  t.id, t.project_id, p.name as project_name, t.title, t.description, t.status, t.priority,
  t.due_date, t.estimated_minutes, t.completed_at, t.cancelled_at, t.cancel_reason, t.created_at, t.updated_at,
  -- 실제 기록 시간 합계(끝난 기록만, 분 단위 내림). 진행 중인 타이머는 화면에서 따로 더한다.
  coalesce((
    select floor(sum(extract(epoch from e.ended_at - e.started_at)) / 60)::int
    from public.task_time_entries e
    where e.task_id = t.id and e.user_id = t.user_id and e.ended_at is not null
  ), 0) as tracked_minutes,
  -- 시간표에 배치한 계획 시간 합계(분)
  coalesce((
    select floor(sum(extract(epoch from pl.ends_at - pl.starts_at)) / 60)::int
    from public.task_time_plans pl
    where pl.task_id = t.id and pl.user_id = t.user_id and (pl.resolution is null or pl.resolution = 'done')
  ), 0) as planned_minutes,
  -- "상위 › 하위" 경로 (최대 3단계)
  nullif(concat_ws(' › ', gp.name, pp.name, p.name), '') as project_path
from public.tasks t
left join public.projects p on p.id = t.project_id and p.user_id = t.user_id
left join public.projects pp on pp.id = p.parent_id and pp.user_id = t.user_id
left join public.projects gp on gp.id = pp.parent_id and gp.user_id = t.user_id
"""

# project_id와 그 하위(최대 3단계) 프로젝트 ID
_SUBTREE_IDS = """
  select %(project_id)s::uuid
  union all
  select c1.id from public.projects c1 where c1.user_id = %(user_id)s and c1.parent_id = %(project_id)s
  union all
  select c2.id from public.projects c2 join public.projects m on c2.parent_id = m.id
  where c2.user_id = %(user_id)s and m.user_id = %(user_id)s and m.parent_id = %(project_id)s
"""

# 진행 중인 업무 먼저 → 완료 → 제외 순, 그 안에서 마감일 빠른 순(없으면 뒤) → 우선순위 높은 순 → 최근 생성 순
_ORDER = """
order by
  case t.status when 'cancelled' then 2 when 'completed' then 1 else 0 end asc,
  t.due_date asc nulls last,
  case t.priority when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end asc,
  t.created_at desc
"""

PROJECT_NOT_FOUND = "프로젝트를 찾을 수 없습니다. 목록을 새로고침한 뒤 다시 선택해 주세요."


def _ensure_own_project(db: Connection[DictRow], user_id: UUID, project_id: UUID) -> None:
    """타인 소유이거나 없는 프로젝트면 입력칸 오류. (DB 복합 FK가 최후 방어선)"""
    row = db.execute(
        "select 1 from public.projects where user_id = %s and id = %s",
        (user_id, project_id),
    ).fetchone()
    if row is None:
        raise FieldError("project_id", PROJECT_NOT_FOUND)


def list_tasks(
    db: Connection[DictRow],
    user_id: UUID,
    *,
    scope: TaskScope = "all",
    project_id: UUID | None = None,
    status: str | None = None,
    priority: str | None = None,
    include_subprojects: bool = False,
) -> list[DictRow]:
    conditions = [sql.SQL("t.user_id = %(user_id)s")]
    params: dict[str, Any] = {"user_id": user_id, "limit": LIST_LIMIT}

    if project_id is not None:
        # include_subprojects: 그 프로젝트와 하위 프로젝트의 업무를 함께 (2026-11-26 사용자 요청: 상위·하위 보기 분리)
        if include_subprojects:
            conditions.append(sql.SQL("t.project_id in (" + _SUBTREE_IDS + ")"))
        else:
            conditions.append(sql.SQL("t.project_id = %(project_id)s"))
        params["project_id"] = project_id
    elif scope == "personal":
        conditions.append(sql.SQL("t.project_id is null"))
    elif scope == "project":
        conditions.append(sql.SQL("t.project_id is not null"))

    if status is not None:
        conditions.append(sql.SQL("t.status = %(status)s"))
        params["status"] = status
    else:
        # 제외한 업무는 기본 목록에서 숨기고, status=cancelled 필터로만 본다
        conditions.append(sql.SQL("t.status <> 'cancelled'"))
    if priority is not None:
        conditions.append(sql.SQL("t.priority = %(priority)s"))
        params["priority"] = priority

    query = sql.SQL(_SELECT + " where {} " + _ORDER + " limit %(limit)s").format(sql.SQL(" and ").join(conditions))
    return db.execute(query, params).fetchall()


def get_task(db: Connection[DictRow], user_id: UUID, task_id: UUID) -> DictRow | None:
    return db.execute(_SELECT + " where t.user_id = %s and t.id = %s", (user_id, task_id)).fetchone()


def create_task(db: Connection[DictRow], user_id: UUID, data: TaskCreate) -> DictRow:
    if data.project_id is not None:
        _ensure_own_project(db, user_id, data.project_id)

    # completed_at은 DB 트리거가 status에 맞춰 기록한다
    row = db.execute(
        """
        insert into public.tasks (user_id, project_id, title, description, status, priority, due_date, estimated_minutes)
        values (%s, %s, %s, %s, %s, %s, %s, %s)
        returning id
        """,
        (user_id, data.project_id, data.title, data.description, data.status, data.priority, data.due_date, data.estimated_minutes),
    ).fetchone()
    assert row is not None
    created = get_task(db, user_id, row["id"])
    assert created is not None
    return created


def update_task(db: Connection[DictRow], user_id: UUID, task_id: UUID, data: TaskUpdate) -> DictRow | None:
    """없거나 남의 업무면 None."""
    changes: dict[str, Any] = data.model_dump(exclude_unset=True)

    exists = db.execute(
        "select 1 from public.tasks where user_id = %s and id = %s for update",
        (user_id, task_id),
    ).fetchone()
    if exists is None:
        return None
    if changes.get("project_id") is not None:
        _ensure_own_project(db, user_id, changes["project_id"])
    if changes.get("status") in time_repo.CLOSED_TASK_STATUSES:
        # 완료·제외하면 그 업무의 타이머를 멈춘다 (기록은 남는다)
        time_repo.stop_for_task(db, user_id, task_id)

    if changes:
        assignments = sql.SQL(", ").join(
            sql.SQL("{} = {}").format(sql.Identifier(column), sql.Placeholder(column)) for column in changes
        )
        db.execute(
            sql.SQL("update public.tasks set {} where user_id = %(user_id)s and id = %(task_id)s").format(assignments),
            {**changes, "user_id": user_id, "task_id": task_id},
        )
    return get_task(db, user_id, task_id)


CLOSED_PROJECT_MESSAGE = "완료하거나 보관한 프로젝트로는 옮길 수 없어요. 먼저 프로젝트를 다시 열어 주세요."


def move_tasks(db: Connection[DictRow], user_id: UUID, task_ids: list[UUID], project_id: UUID | None) -> dict[str, int]:
    """업무를 다른 프로젝트나 개인 업무(None)로 옮긴다. 업무 ID는 그대로라 시간 기록·계획도 따라간다.

    완료·보관한 프로젝트로는 옮기지 않는다 (목록에서 보이지 않는 곳으로 업무가 사라지지 않게).
    """
    if project_id is not None:
        project = db.execute(
            "select status from public.projects where user_id = %s and id = %s for share",
            (user_id, project_id),
        ).fetchone()
        if project is None:
            raise FieldError("project_id", PROJECT_NOT_FOUND)
        if project["status"] in ("completed", "archived"):
            raise FieldError("project_id", CLOSED_PROJECT_MESSAGE)

    found = db.execute(
        "select id, project_id from public.tasks where user_id = %s and id = any(%s) for update",
        (user_id, task_ids),
    ).fetchall()
    to_move = [r["id"] for r in found if r["project_id"] != project_id]
    if to_move:
        db.execute(
            "update public.tasks set project_id = %s where user_id = %s and id = any(%s)",
            (project_id, user_id, to_move),
        )
    return {"moved": len(to_move), "unchanged": len(found) - len(to_move), "missing": len(task_ids) - len(found)}


def delete_tasks(db: Connection[DictRow], user_id: UUID, task_ids: list[UUID]) -> dict[str, int]:
    """여러 업무 삭제 (편집 모드). 시간 기록·계획은 FK CASCADE로 함께 지워진다."""
    deleted = db.execute(
        "delete from public.tasks where user_id = %s and id = any(%s)",
        (user_id, task_ids),
    ).rowcount
    return {"deleted": deleted, "missing": len(task_ids) - deleted}


def delete_task(db: Connection[DictRow], user_id: UUID, task_id: UUID) -> bool:
    row = db.execute(
        "delete from public.tasks where user_id = %s and id = %s returning id",
        (user_id, task_id),
    ).fetchone()
    return row is not None
