"""프로젝트 계층 (상위 → 하위 → 그 하위, 최대 3단계) — 2026-11-26 사용자 확정.

DB 트리거(check_project_tree)가 최후 방어선이고, 여기서 먼저 검사해 입력칸 오류로 알린다.
같은 사용자의 계층 변경은 advisory lock으로 차례로 처리해 동시 이동으로 순환이 생기지 않게 한다.
"""

from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow

from app.core.errors import FieldError

MAX_DEPTH = 3
CLOSED_STATUSES = ("completed", "archived")


def lock_tree(db: Connection[DictRow], user_id: UUID) -> None:
    db.execute("select pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"project-tree:{user_id}",))


def ancestors(db: Connection[DictRow], user_id: UUID, project_id: UUID) -> list[DictRow]:
    """최상위부터 바로 위 상위까지 (자기 자신 제외)."""
    rows = db.execute(
        """
        with recursive anc as (
          select p.id, p.name, p.status, p.parent_id, 1 as lvl
          from public.projects p
          where p.user_id = %(u)s and p.id = (select parent_id from public.projects where user_id = %(u)s and id = %(id)s)
          union all
          select p.id, p.name, p.status, p.parent_id, anc.lvl + 1
          from public.projects p join anc on p.id = anc.parent_id
          where p.user_id = %(u)s and anc.lvl < 10
        )
        select id, name, status from anc order by lvl desc
        """,
        {"u": user_id, "id": project_id},
    ).fetchall()
    return rows


def descendants(db: Connection[DictRow], user_id: UUID, project_id: UUID) -> list[DictRow]:
    """모든 하위 프로젝트 (자기 자신 제외). depth: 바로 아래 = 1. 깊은 것부터 처리할 수 있게 depth를 준다."""
    return db.execute(
        """
        with recursive sub as (
          select p.id, p.name, p.status, p.parent_id, 1 as depth
          from public.projects p where p.user_id = %(u)s and p.parent_id = %(id)s
          union all
          select p.id, p.name, p.status, p.parent_id, sub.depth + 1
          from public.projects p join sub on p.parent_id = sub.id
          where p.user_id = %(u)s and sub.depth < 10
        )
        select id, name, status, parent_id, depth from sub order by depth, name
        """,
        {"u": user_id, "id": project_id},
    ).fetchall()


def check_parent(db: Connection[DictRow], user_id: UUID, project_id: UUID | None, parent_id: UUID) -> None:
    """project_id(새로 만들면 None)를 parent_id 아래에 둘 수 있는지. 안 되면 FieldError('parent_id')."""
    parent = db.execute(
        "select id, status from public.projects where user_id = %s and id = %s",
        (user_id, parent_id),
    ).fetchone()
    if parent is None:
        raise FieldError("parent_id", "상위 프로젝트를 찾을 수 없어요. 목록을 새로고침한 뒤 다시 선택해 주세요.")
    if parent["status"] in CLOSED_STATUSES:
        raise FieldError("parent_id", "완료하거나 보관한 프로젝트 안에는 넣을 수 없어요. 먼저 다시 열어 주세요.")

    height = 0
    if project_id is not None:
        if parent_id == project_id:
            raise FieldError("parent_id", "자기 자신 안에는 넣을 수 없어요.")
        below = descendants(db, user_id, project_id)
        if any(row["id"] == parent_id for row in below):
            raise FieldError("parent_id", "자기 하위 프로젝트 안으로는 옮길 수 없어요.")
        height = max((row["depth"] for row in below), default=0)

    parent_depth = len(ancestors(db, user_id, parent_id)) + 1
    if parent_depth + 1 + height > MAX_DEPTH:
        raise FieldError("parent_id", f"프로젝트는 {MAX_DEPTH}단계까지만 만들 수 있어요.")
