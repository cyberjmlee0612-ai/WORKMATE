"""프로젝트 삭제 흐름 (PRD: A 개인 업무로 이동 / C 함께 삭제).

요청 하나(get_user_db의 트랜잭션) 안에서 확인 → 이동 → 삭제를 모두 수행한다.
중간에 예외가 나면 전체가 롤백되므로 일부만 이동·삭제되는 일이 없다.
tasks FK가 ON DELETE RESTRICT라서, 업무를 먼저 처리하지 않으면 프로젝트 삭제 자체가 실패한다(최후 방어선).
"""

from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow

from app.core.errors import FieldError
from app.repositories.tasks import _ORDER as TASK_ORDER
from app.repositories.tasks import _SELECT as TASK_SELECT
from app.schemas.project_deletion import ProjectDeleteRequest


class ProjectNotFound(Exception):
    pass


class TasksChanged(Exception):
    """사용자가 확인한 소속 업무 목록과 서버의 현재 목록이 다르다 (다른 탭에서 변경 등)."""

    def __init__(self, tasks: list[DictRow]) -> None:
        super().__init__("tasks changed")
        self.tasks = tasks


def _project_tasks(db: Connection[DictRow], user_id: UUID, project_id: UUID) -> list[DictRow]:
    # 제외된 업무까지 모두 (기본 목록 필터를 쓰지 않는다)
    return db.execute(
        TASK_SELECT + " where t.user_id = %s and t.project_id = %s " + TASK_ORDER,
        (user_id, project_id),
    ).fetchall()


def get_preview(db: Connection[DictRow], user_id: UUID, project_id: UUID) -> dict | None:
    project = db.execute(
        "select id, name from public.projects where user_id = %s and id = %s",
        (user_id, project_id),
    ).fetchone()
    if project is None:
        return None
    return {"project_id": project["id"], "project_name": project["name"], "tasks": _project_tasks(db, user_id, project_id)}


def delete_project(db: Connection[DictRow], user_id: UUID, project_id: UUID, req: ProjectDeleteRequest) -> dict[str, int]:
    # 1) 프로젝트와 소속 업무를 잠근다: 확인~삭제 사이에 다른 요청이 업무를 붙이거나 옮기지 못하게
    project = db.execute(
        "select id from public.projects where user_id = %s and id = %s for update",
        (user_id, project_id),
    ).fetchone()
    if project is None:
        raise ProjectNotFound
    db.execute(
        "select id from public.tasks where user_id = %s and project_id = %s for update",
        (user_id, project_id),
    )
    current = _project_tasks(db, user_id, project_id)
    current_ids = {row["id"] for row in current}

    # 2) 사용자가 본 목록과 다르면 아무것도 바꾸지 않고 최신 목록으로 다시 확인시킨다
    if current_ids != set(req.expected_task_ids):
        raise TasksChanged(current)

    keep_ids: set[UUID] = set()
    if req.mode == "move" and current_ids:
        keep_ids = set(req.keep_task_ids)
        if not keep_ids:
            raise FieldError("keep_task_ids", "개인 업무로 옮길 업무를 1개 이상 선택해 주세요.")
        if not keep_ids <= current_ids:
            raise FieldError("keep_task_ids", "이 프로젝트의 업무만 옮길 수 있습니다.")
    elif req.mode == "delete" and req.keep_task_ids:
        raise FieldError("keep_task_ids", "모두 삭제할 때는 옮길 업무를 선택할 수 없습니다.")

    # 3) 보존할 업무를 개인 업무로 이동
    moved = 0
    if keep_ids:
        moved = db.execute(
            "update public.tasks set project_id = null where user_id = %s and project_id = %s and id = any(%s)",
            (user_id, project_id, list(keep_ids)),
        ).rowcount

    # 4) 남은 소속 업무 삭제 → 5) 프로젝트 삭제
    deleted = db.execute(
        "delete from public.tasks where user_id = %s and project_id = %s",
        (user_id, project_id),
    ).rowcount
    db.execute("delete from public.projects where user_id = %s and id = %s", (user_id, project_id))

    return {"moved_tasks": moved, "deleted_tasks": deleted}
