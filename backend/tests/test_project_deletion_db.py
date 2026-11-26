"""실제 Supabase DB에서 프로젝트 삭제 흐름(A 이동 / C 함께 삭제)을 확인하는 통합 테스트.

db fixture는 tests/conftest.py (트랜잭션 안에서 실행 후 롤백).
실행: RUN_DB_TESTS=1 pytest tests/test_project_deletion_db.py
"""

import os

import pytest

from app.core.errors import FieldError
from app.repositories import project_deletion as repo
from app.repositories import projects as project_repo
from app.repositories import tasks as task_repo
from app.schemas.project import ProjectCreate
from app.schemas.project_deletion import ProjectDeleteRequest
from app.schemas.task import TaskCreate, TaskUpdate

pytestmark = pytest.mark.skipif(os.environ.get("RUN_DB_TESTS") != "1", reason="RUN_DB_TESTS=1 일 때만 실행")


def _setup(conn, user):
    project = project_repo.create_project(conn, user, ProjectCreate(name="P"))
    t1 = task_repo.create_task(conn, user, TaskCreate(title="보존", project_id=project["id"]))
    t2 = task_repo.create_task(conn, user, TaskCreate(title="삭제", project_id=project["id"]))
    t3 = task_repo.create_task(conn, user, TaskCreate(title="제외됨", project_id=project["id"]))
    task_repo.update_task(conn, user, t3["id"], TaskUpdate(status="cancelled", cancel_reason="r"))
    other = task_repo.create_task(conn, user, TaskCreate(title="개인 업무"))
    return project, t1, t2, t3, other


def test_preview_includes_cancelled(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        project, t1, t2, t3, _ = _setup(conn, a)
        preview = repo.get_preview(conn, a, project["id"])
    assert {t["id"] for t in preview["tasks"]} == {t1["id"], t2["id"], t3["id"]}


def test_move_keeps_selected_and_deletes_rest(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        project, t1, t2, t3, other = _setup(conn, a)
        result = repo.delete_project(conn, a, project["id"], ProjectDeleteRequest(
            mode="move", expected_task_ids=[t1["id"], t2["id"], t3["id"]], keep_task_ids=[t1["id"], t3["id"]],
        ))
        assert result == {"moved_tasks": 2, "deleted_tasks": 1, "lifted_subprojects": 0, "deleted_subprojects": 0}
        assert project_repo.get_project(conn, a, project["id"]) is None
        kept = task_repo.get_task(conn, a, t1["id"])
        assert kept["project_id"] is None  # 개인 업무로 전환
        # 제외 상태·사유는 그대로 유지한 채 이동
        kept_cancelled = task_repo.get_task(conn, a, t3["id"])
        assert kept_cancelled["project_id"] is None and kept_cancelled["status"] == "cancelled" and kept_cancelled["cancel_reason"] == "r"
        assert task_repo.get_task(conn, a, t2["id"]) is None
        assert task_repo.get_task(conn, a, other["id"]) is not None  # 관계없는 업무는 그대로


def test_delete_all(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        project, t1, t2, t3, other = _setup(conn, a)
        result = repo.delete_project(conn, a, project["id"], ProjectDeleteRequest(mode="delete", expected_task_ids=[t1["id"], t2["id"], t3["id"]]))
        assert result == {"moved_tasks": 0, "deleted_tasks": 3, "lifted_subprojects": 0, "deleted_subprojects": 0}
        assert project_repo.get_project(conn, a, project["id"]) is None
        assert all(task_repo.get_task(conn, a, t["id"]) is None for t in (t1, t2, t3))
        assert task_repo.get_task(conn, a, other["id"]) is not None


def test_empty_project(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        project = project_repo.create_project(conn, a, ProjectCreate(name="빈 프로젝트"))
        result = repo.delete_project(conn, a, project["id"], ProjectDeleteRequest(mode="move", expected_task_ids=[]))
        assert result == {"moved_tasks": 0, "deleted_tasks": 0, "lifted_subprojects": 0, "deleted_subprojects": 0}
        assert project_repo.get_project(conn, a, project["id"]) is None


def test_changed_tasks_conflict_changes_nothing(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        project, t1, t2, t3, _ = _setup(conn, a)
        # 사용자는 t1, t2만 봤는데 그사이 t3가 생긴 상황
        with pytest.raises(repo.TasksChanged) as exc:
            repo.delete_project(conn, a, project["id"], ProjectDeleteRequest(mode="delete", expected_task_ids=[t1["id"], t2["id"]]))
        assert {t["id"] for t in exc.value.tasks} == {t1["id"], t2["id"], t3["id"]}
        assert project_repo.get_project(conn, a, project["id"]) is not None
        assert task_repo.get_task(conn, a, t1["id"])["project_id"] == project["id"]


@pytest.mark.parametrize(
    ("mode", "keep"),
    [("move", "none"), ("move", "foreign"), ("delete", "some")],
)
def test_invalid_selection(db, mode: str, keep: str) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        project, t1, t2, t3, other = _setup(conn, a)
        keep_ids = {"none": [], "foreign": [other["id"]], "some": [t1["id"]]}[keep]
        with pytest.raises(FieldError) as exc:
            repo.delete_project(conn, a, project["id"], ProjectDeleteRequest(
                mode=mode, expected_task_ids=[t1["id"], t2["id"], t3["id"]], keep_task_ids=keep_ids,
            ))
        assert exc.value.field == "keep_task_ids"


def test_other_user_cannot_delete(db) -> None:
    conn, a, b, as_user = db
    with as_user(a):
        project, t1, t2, t3, _ = _setup(conn, a)
    with as_user(b):
        with pytest.raises(repo.ProjectNotFound):
            repo.delete_project(conn, b, project["id"], ProjectDeleteRequest(mode="delete", expected_task_ids=[]))
        assert repo.get_preview(conn, b, project["id"]) is None
    with as_user(a):
        assert project_repo.get_project(conn, a, project["id"]) is not None


def test_repeated_delete_is_not_found(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        project = project_repo.create_project(conn, a, ProjectCreate(name="P"))
        req = ProjectDeleteRequest(mode="delete", expected_task_ids=[])
        repo.delete_project(conn, a, project["id"], req)
        with pytest.raises(repo.ProjectNotFound):
            repo.delete_project(conn, a, project["id"], req)
