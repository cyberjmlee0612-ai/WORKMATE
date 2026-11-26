"""프로젝트 SQL. 모든 쿼리는 RLS가 적용된 연결에서 실행되며, user_id 조건도 함께 건다(이중 확인)."""

from typing import Any
from uuid import UUID

from psycopg import Connection, sql
from psycopg.rows import DictRow

from app.core.errors import FieldError
from app.schemas.project import ProjectCreate, ProjectUpdate, check_date_order

# 진행률 = completed 업무 수 ÷ 제외(cancelled)되지 않은 업무 수 × 100, 정수 내림. 업무가 없으면 0.
# 제외한 업무는 분자·분모 모두에서 빠지고, 개수는 cancelled_tasks로 따로 돌려준다.
_SELECT_WITH_PROGRESS = """
select
  p.id, p.name, p.description, p.status, p.start_date, p.due_date, p.created_at, p.updated_at,
  coalesce(t.total, 0)::int as total_tasks,
  coalesce(t.completed, 0)::int as completed_tasks,
  coalesce(t.cancelled, 0)::int as cancelled_tasks,
  coalesce(t.completed * 100 / nullif(t.total, 0), 0)::int as progress,
  -- 완료 정보는 현재 '완료' 상태일 때만, 보관 시각은 현재 '보관' 상태일 때만 의미가 있다
  case when p.status = 'completed' then c.occurred_at end as completed_at,
  case when p.status = 'completed' then c.open_tasks end as open_tasks_at_completion,
  case when p.status = 'archived' then a.occurred_at end as archived_at
from public.projects p
left join lateral (
  select
    count(*) filter (where status <> 'cancelled') as total,
    count(*) filter (where status = 'completed') as completed,
    count(*) filter (where status = 'cancelled') as cancelled
  from public.tasks
  where tasks.project_id = p.id and tasks.user_id = p.user_id
) t on true
left join lateral (
  select e.occurred_at, e.open_tasks from public.project_status_events e
  where e.project_id = p.id and e.user_id = p.user_id and e.action = 'complete'
  order by e.occurred_at desc limit 1
) c on true
left join lateral (
  select e.occurred_at from public.project_status_events e
  where e.project_id = p.id and e.user_id = p.user_id and e.action = 'archive'
  order by e.occurred_at desc limit 1
) a on true
"""


def list_projects(db: Connection[DictRow], user_id: UUID) -> list[DictRow]:
    return db.execute(
        _SELECT_WITH_PROGRESS + " where p.user_id = %s order by p.updated_at desc, p.created_at desc",
        (user_id,),
    ).fetchall()


def get_project(db: Connection[DictRow], user_id: UUID, project_id: UUID) -> DictRow | None:
    return db.execute(
        _SELECT_WITH_PROGRESS + " where p.user_id = %s and p.id = %s",
        (user_id, project_id),
    ).fetchone()


def create_project(db: Connection[DictRow], user_id: UUID, data: ProjectCreate) -> DictRow:
    row = db.execute(
        """
        insert into public.projects (user_id, name, description, status, start_date, due_date)
        values (%s, %s, %s, %s, %s, %s)
        returning id
        """,
        (user_id, data.name, data.description, data.status, data.start_date, data.due_date),
    ).fetchone()
    assert row is not None
    created = get_project(db, user_id, row["id"])
    assert created is not None
    return created


def update_project(db: Connection[DictRow], user_id: UUID, project_id: UUID, data: ProjectUpdate) -> DictRow | None:
    """없거나 남의 프로젝트면 None. 날짜 순서가 기존 값과 합쳐 어긋나면 ValueError."""
    changes: dict[str, Any] = data.model_dump(exclude_unset=True)

    # 동시에 다른 요청이 날짜를 바꾸지 못하게 행을 잠그고 기존 값과 합쳐 검사
    current = db.execute(
        "select status, start_date, due_date from public.projects where user_id = %s and id = %s for update",
        (user_id, project_id),
    ).fetchone()
    if current is None:
        return None
    # 완료·보관 상태는 이력을 남기는 복원 기능으로만 바꾼다 (수정으로 바꾸면 이력이 빠진다)
    if "status" in changes and current["status"] in ("completed", "archived"):
        raise FieldError("status", "완료·보관한 프로젝트는 ‘복원’으로 다시 열 수 있습니다.")
    check_date_order(changes.get("start_date", current["start_date"]), changes.get("due_date", current["due_date"]))

    if changes:
        assignments = sql.SQL(", ").join(
            sql.SQL("{} = {}").format(sql.Identifier(column), sql.Placeholder(column)) for column in changes
        )
        db.execute(
            sql.SQL("update public.projects set {} where user_id = %(user_id)s and id = %(project_id)s").format(assignments),
            {**changes, "user_id": user_id, "project_id": project_id},
        )
    return get_project(db, user_id, project_id)
