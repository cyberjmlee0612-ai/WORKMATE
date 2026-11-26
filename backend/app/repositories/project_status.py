"""프로젝트 완료·보관·복원 (PRD P1).

- 완료: 진행 중 상태(계획/진행 중/검토)에서만. 미완료 업무가 있어도 가능하며 그 수를 이력에 남긴다.
- 보관: 어떤 상태에서든 가능 (이미 보관이면 불가).
- 복원: 현재 상태로 들어오게 만든 마지막 완료/보관 이벤트의 from_status로 되돌린다.
  예) 진행 중 → 완료 → 보관 이면, 복원 시 완료, 한 번 더 복원 시 진행 중.
- 모든 변경은 project_status_events에 추가로만 기록한다. 업무 데이터는 건드리지 않는다.
"""

from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow

ACTIVE_STATUSES = ("planning", "in_progress", "review")


class InvalidTransition(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class OpenTasksChanged(Exception):
    """사용자가 확인한 미완료 업무 수와 실제 수가 다르다 (다른 탭에서 변경 등)."""

    def __init__(self, open_tasks: int) -> None:
        super().__init__("open tasks changed")
        self.open_tasks = open_tasks


def _lock_status(db: Connection[DictRow], user_id: UUID, project_id: UUID) -> str | None:
    row = db.execute(
        "select status from public.projects where user_id = %s and id = %s for update",
        (user_id, project_id),
    ).fetchone()
    return None if row is None else row["status"]


def count_open_tasks(db: Connection[DictRow], user_id: UUID, project_id: UUID) -> int:
    """미완료 업무 = 완료도 제외도 아닌 업무"""
    row = db.execute(
        """
        select count(*)::int as n from public.tasks
        where user_id = %s and project_id = %s and status not in ('completed', 'cancelled')
        """,
        (user_id, project_id),
    ).fetchone()
    assert row is not None
    return row["n"]


def _change(db: Connection[DictRow], user_id: UUID, project_id: UUID, action: str, from_status: str, to_status: str,
            open_tasks: int | None = None) -> None:
    db.execute("update public.projects set status = %s where user_id = %s and id = %s", (to_status, user_id, project_id))
    # clock_timestamp(): 같은 트랜잭션 안의 여러 이벤트도 순서가 구분되도록 (now()는 트랜잭션 시작 시각으로 고정)
    db.execute(
        """
        insert into public.project_status_events (user_id, project_id, action, from_status, to_status, open_tasks, occurred_at)
        values (%s, %s, %s, %s, %s, %s, clock_timestamp())
        """,
        (user_id, project_id, action, from_status, to_status, open_tasks),
    )


def complete(db: Connection[DictRow], user_id: UUID, project_id: UUID, confirmed_open_tasks: int) -> bool:
    """없거나 남의 프로젝트면 False."""
    status = _lock_status(db, user_id, project_id)
    if status is None:
        return False
    if status == "completed":
        raise InvalidTransition("이미 완료된 프로젝트입니다.")
    if status == "archived":
        raise InvalidTransition("보관한 프로젝트는 먼저 복원한 뒤 완료할 수 있습니다.")

    # 업무 행도 잠가 확인~완료 사이에 미완료 수가 바뀌지 않게 한다
    db.execute("select id from public.tasks where user_id = %s and project_id = %s for update", (user_id, project_id))
    open_tasks = count_open_tasks(db, user_id, project_id)
    if open_tasks != confirmed_open_tasks:
        raise OpenTasksChanged(open_tasks)

    _change(db, user_id, project_id, "complete", status, "completed", open_tasks)
    return True


def archive(db: Connection[DictRow], user_id: UUID, project_id: UUID) -> bool:
    status = _lock_status(db, user_id, project_id)
    if status is None:
        return False
    if status == "archived":
        raise InvalidTransition("이미 보관한 프로젝트입니다.")
    _change(db, user_id, project_id, "archive", status, "archived")
    return True


def restore(db: Connection[DictRow], user_id: UUID, project_id: UUID) -> bool:
    status = _lock_status(db, user_id, project_id)
    if status is None:
        return False
    if status in ACTIVE_STATUSES:
        raise InvalidTransition("이미 진행 중인 프로젝트입니다.")

    previous = db.execute(
        """
        select from_status from public.project_status_events
        where user_id = %s and project_id = %s and to_status = %s and action in ('complete', 'archive')
        order by occurred_at desc
        limit 1
        """,
        (user_id, project_id, status),
    ).fetchone()
    # 이력이 없는 경우(이력 도입 전 데이터 등)는 '진행 중'으로 연다
    to_status = previous["from_status"] if previous else "in_progress"
    _change(db, user_id, project_id, "restore", status, to_status)
    return True


def list_history(db: Connection[DictRow], user_id: UUID, project_id: UUID) -> list[DictRow]:
    return db.execute(
        """
        select id, action, from_status, to_status, open_tasks, occurred_at
        from public.project_status_events
        where user_id = %s and project_id = %s
        order by occurred_at desc
        """,
        (user_id, project_id),
    ).fetchall()
