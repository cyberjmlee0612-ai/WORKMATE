"""프로젝트 삭제 흐름 (PRD: A 개인 업무로 이동 / C 함께 삭제).

요청 하나(get_user_db의 트랜잭션) 안에서 확인 → 이동 → 삭제를 모두 수행한다.
중간에 예외가 나면 전체가 롤백되므로 일부만 이동·삭제되는 일이 없다.
tasks FK가 ON DELETE RESTRICT라서, 업무를 먼저 처리하지 않으면 프로젝트 삭제 자체가 실패한다(최후 방어선).
"""

from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow

from app.core.errors import FieldError
from app.repositories import project_tree as tree
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


class SubprojectsChanged(Exception):
    """사용자가 확인한 하위 프로젝트 목록과 현재 목록이 다르다."""

    def __init__(self, subprojects: list[dict]) -> None:
        super().__init__("subprojects changed")
        self.subprojects = subprojects


def _project_tasks(db: Connection[DictRow], user_id: UUID, project_id: UUID) -> list[DictRow]:
    # 제외된 업무까지 모두 (기본 목록 필터를 쓰지 않는다)
    return db.execute(
        TASK_SELECT + " where t.user_id = %s and t.project_id = %s " + TASK_ORDER,
        (user_id, project_id),
    ).fetchall()


def _subprojects(db: Connection[DictRow], user_id: UUID, project_id: UUID) -> list[dict]:
    rows = tree.descendants(db, user_id, project_id)
    counts = {}
    if rows:
        counts = {
            r["project_id"]: r["n"]
            for r in db.execute(
                "select project_id, count(*)::int as n from public.tasks where user_id = %s and project_id = any(%s) group by project_id",
                (user_id, [r["id"] for r in rows]),
            ).fetchall()
        }
    return [{**dict(r), "task_count": counts.get(r["id"], 0)} for r in rows]


def get_preview(db: Connection[DictRow], user_id: UUID, project_id: UUID) -> dict | None:
    project = db.execute(
        """
        select p.id, p.name, pp.name as parent_name from public.projects p
        left join public.projects pp on pp.id = p.parent_id and pp.user_id = p.user_id
        where p.user_id = %s and p.id = %s
        """,
        (user_id, project_id),
    ).fetchone()
    if project is None:
        return None
    return {
        "project_id": project["id"],
        "project_name": project["name"],
        "parent_name": project["parent_name"],
        "tasks": _project_tasks(db, user_id, project_id),
        "subprojects": _subprojects(db, user_id, project_id),
    }


def delete_project(db: Connection[DictRow], user_id: UUID, project_id: UUID, req: ProjectDeleteRequest) -> dict[str, int]:
    # 1) 프로젝트와 소속 업무를 잠근다: 확인~삭제 사이에 다른 요청이 업무를 붙이거나 옮기지 못하게
    project = db.execute(
        "select id, parent_id from public.projects where user_id = %s and id = %s for update",
        (user_id, project_id),
    ).fetchone()
    if project is None:
        raise ProjectNotFound
    tree.lock_tree(db, user_id)
    children = tree.descendants(db, user_id, project_id)
    if {c["id"] for c in children} != set(req.expected_subproject_ids):
        raise SubprojectsChanged(_subprojects(db, user_id, project_id))
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

    # 4) 하위 프로젝트: 한 단계 위로 꺼내거나(바로 아래만 옮기면 그 하위는 따라온다), 깊은 것부터 함께 삭제
    lifted = deleted_children = deleted = 0
    if children and req.subprojects == "lift":
        lifted = db.execute(
            "update public.projects set parent_id = %s where user_id = %s and parent_id = %s",
            (project["parent_id"], user_id, project_id),
        ).rowcount
    elif children:
        for child in sorted(children, key=lambda c: c["depth"], reverse=True):
            deleted += db.execute("delete from public.tasks where user_id = %s and project_id = %s", (user_id, child["id"])).rowcount
            db.execute("delete from public.project_status_events where user_id = %s and project_id = %s", (user_id, child["id"]))
            db.execute("delete from public.projects where user_id = %s and id = %s", (user_id, child["id"]))
            deleted_children += 1

    # 5) 남은 소속 업무 삭제 → 6) 상태 이력 삭제 → 7) 프로젝트 삭제
    deleted += db.execute(
        "delete from public.tasks where user_id = %s and project_id = %s",
        (user_id, project_id),
    ).rowcount
    # 이력 FK는 CASCADE지만 PRD 원칙대로 자동 CASCADE에만 의존하지 않고 명시적으로 지운다
    db.execute("delete from public.project_status_events where user_id = %s and project_id = %s", (user_id, project_id))
    db.execute("delete from public.projects where user_id = %s and id = %s", (user_id, project_id))

    return {"moved_tasks": moved, "deleted_tasks": deleted, "lifted_subprojects": lifted, "deleted_subprojects": deleted_children}


def delete_many(db: Connection[DictRow], user_id: UUID, project_ids: list[UUID], task_mode: str, sub_mode: str) -> dict[str, int]:
    """여러 프로젝트를 한 번에 삭제 (편집 모드, 2026-11-26 사용자 요청). 한 트랜잭션이라 실패하면 아무것도 바뀌지 않는다.

    task_mode: move = 직접 속한 업무를 모두 개인 업무로, delete = 함께 삭제.
    sub_mode: lift = 하위를 한 단계 위로 꺼내기, delete = 하위와 그 업무까지 함께 삭제.
    선택한 것 중 깊은 것부터 처리한다 (상위·하위를 함께 골랐을 때 하위가 먼저 정리되도록).
    """
    tree.lock_tree(db, user_id)
    rows = db.execute(
        "select id from public.projects where user_id = %s and id = any(%s) for update",
        (user_id, project_ids),
    ).fetchall()
    depth = {r["id"]: len(tree.ancestors(db, user_id, r["id"])) for r in rows}
    totals = {"deleted_projects": 0, "moved_tasks": 0, "deleted_tasks": 0, "lifted_subprojects": 0, "deleted_subprojects": 0}
    for project_id in sorted(depth, key=lambda pid: depth[pid], reverse=True):
        still = db.execute("select 1 from public.projects where user_id = %s and id = %s", (user_id, project_id)).fetchone()
        if still is None:  # 앞에서 상위와 함께 지워짐
            continue
        task_ids = [t["id"] for t in _project_tasks(db, user_id, project_id)]
        children = [c["id"] for c in tree.descendants(db, user_id, project_id)]
        result = delete_project(db, user_id, project_id, ProjectDeleteRequest(
            mode="move" if task_mode == "move" and task_ids else "delete",
            expected_task_ids=task_ids,
            keep_task_ids=task_ids if task_mode == "move" else [],
            subprojects=sub_mode,  # type: ignore[arg-type]
            expected_subproject_ids=children,
        ))
        totals["deleted_projects"] += 1
        for key in ("moved_tasks", "deleted_tasks", "lifted_subprojects", "deleted_subprojects"):
            totals[key] += result[key]
    return totals
