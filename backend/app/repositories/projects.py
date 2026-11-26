"""프로젝트 SQL. 모든 쿼리는 RLS가 적용된 연결에서 실행되며, user_id 조건도 함께 건다(이중 확인)."""

from typing import Any
from uuid import UUID

from psycopg import Connection, sql
from psycopg.rows import DictRow

from app.core.errors import FieldError
from app.repositories import project_tree as tree
from app.schemas.project import ProjectCreate, ProjectUpdate, check_date_order

# 진행률 = completed 업무 수 ÷ 제외(cancelled)되지 않은 업무 수 × 100, 정수 내림. 업무가 없으면 0.
# 제외한 업무는 분자·분모 모두에서 빠지고, 개수는 cancelled_tasks로 따로 돌려준다.
#
# 계층(2026-11-26): 진행률·전체 업무 수는 하위 프로젝트(최대 3단계)의 업무까지 합산하고,
# 완료 확인 등에 쓰는 '직접 속한 업무' 수는 own_*로 따로 돌려준다.
_SELECT_WITH_PROGRESS = """
select
  p.id, p.name, p.description, p.status, p.start_date, p.due_date, p.created_at, p.updated_at,
  p.parent_id, pp.name as parent_name,
  coalesce(sc.n, 0)::int as subproject_count,
  coalesce(t.total, 0)::int as total_tasks,
  coalesce(t.completed, 0)::int as completed_tasks,
  coalesce(t.completed * 100 / nullif(t.total, 0), 0)::int as progress,
  coalesce(o.total, 0)::int as own_total_tasks,
  coalesce(o.completed, 0)::int as own_completed_tasks,
  coalesce(o.cancelled, 0)::int as cancelled_tasks,
  -- 완료 정보는 현재 '완료' 상태일 때만, 보관 시각은 현재 '보관' 상태일 때만 의미가 있다
  case when p.status = 'completed' then c.occurred_at end as completed_at,
  case when p.status = 'completed' then c.open_tasks end as open_tasks_at_completion,
  case when p.status = 'archived' then a.occurred_at end as archived_at
from public.projects p
left join public.projects pp on pp.id = p.parent_id and pp.user_id = p.user_id
left join lateral (
  select count(*) as n from public.projects ch where ch.user_id = p.user_id and ch.parent_id = p.id
) sc on true
left join lateral (
  select
    count(*) filter (where status <> 'cancelled') as total,
    count(*) filter (where status = 'completed') as completed,
    count(*) filter (where status = 'cancelled') as cancelled
  from public.tasks
  where tasks.project_id = p.id and tasks.user_id = p.user_id
) o on true
left join lateral (
  select
    count(*) filter (where tk.status <> 'cancelled') as total,
    count(*) filter (where tk.status = 'completed') as completed
  from public.tasks tk
  where tk.user_id = p.user_id and tk.project_id in (
    select p.id
    union all
    select c1.id from public.projects c1 where c1.user_id = p.user_id and c1.parent_id = p.id
    union all
    select c2.id from public.projects c2 join public.projects m on c2.parent_id = m.id
    where c2.user_id = p.user_id and m.user_id = p.user_id and m.parent_id = p.id
  )
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
    if data.parent_id is not None:
        tree.lock_tree(db, user_id)
        tree.check_parent(db, user_id, None, data.parent_id)
    row = db.execute(
        """
        insert into public.projects (user_id, name, description, status, start_date, due_date, parent_id)
        values (%s, %s, %s, %s, %s, %s, %s)
        returning id
        """,
        (user_id, data.name, data.description, data.status, data.start_date, data.due_date, data.parent_id),
    ).fetchone()
    assert row is not None
    created = get_project(db, user_id, row["id"])
    assert created is not None
    return created


def move_projects(db: Connection[DictRow], user_id: UUID, project_ids: list[UUID], parent_id: UUID | None) -> dict[str, int]:
    """여러 프로젝트를 parent_id 아래(None = 최상위)로 옮긴다 (편집 모드, 2026-11-26 사용자 요청).

    선택한 것 중 조상이 함께 선택된 것은 조상을 따라가므로 따로 옮기지 않는다(skipped).
    하나라도 규칙(3단계·순환·완료/보관)에 걸리면 FieldError로 전체를 취소한다.
    """
    tree.lock_tree(db, user_id)
    rows = db.execute(
        "select id, name, parent_id from public.projects where user_id = %s and id = any(%s) for update",
        (user_id, project_ids),
    ).fetchall()
    selected = {r["id"] for r in rows}
    moved = unchanged = skipped = 0
    for row in rows:
        if any(a["id"] in selected for a in tree.ancestors(db, user_id, row["id"])):
            skipped += 1
            continue
        if row["parent_id"] == parent_id:
            unchanged += 1
            continue
        if parent_id is not None:
            try:
                tree.check_parent(db, user_id, row["id"], parent_id)
            except FieldError as exc:
                raise FieldError("parent_id", f"‘{row['name']}’: {exc.message}") from exc
        db.execute("update public.projects set parent_id = %s where user_id = %s and id = %s", (parent_id, user_id, row["id"]))
        moved += 1
    return {"moved": moved, "unchanged": unchanged, "skipped": skipped, "missing": len(set(project_ids)) - len(rows)}


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
    if "parent_id" in changes:
        tree.lock_tree(db, user_id)
        if changes["parent_id"] is not None:
            tree.check_parent(db, user_id, project_id, changes["parent_id"])

    if changes:
        assignments = sql.SQL(", ").join(
            sql.SQL("{} = {}").format(sql.Identifier(column), sql.Placeholder(column)) for column in changes
        )
        db.execute(
            sql.SQL("update public.projects set {} where user_id = %(user_id)s and id = %(project_id)s").format(assignments),
            {**changes, "user_id": user_id, "project_id": project_id},
        )
    return get_project(db, user_id, project_id)
