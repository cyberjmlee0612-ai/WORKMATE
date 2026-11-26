"""실제 Supabase DB에서 프로젝트 완료·보관·복원과 이력을 확인하는 통합 테스트.

db fixture는 tests/conftest.py (트랜잭션 안에서 실행 후 롤백).
실행: RUN_DB_TESTS=1 pytest tests/test_project_status_db.py
"""

import os

import pytest

from app.core.errors import FieldError
from app.repositories import project_deletion as deletion_repo
from app.repositories import project_status as repo
from app.repositories import projects as project_repo
from app.repositories import tasks as task_repo
from app.schemas.project import ProjectCreate, ProjectUpdate
from app.schemas.project_deletion import ProjectDeleteRequest
from app.schemas.task import TaskCreate, TaskUpdate

pytestmark = pytest.mark.skipif(os.environ.get("RUN_DB_TESTS") != "1", reason="RUN_DB_TESTS=1 일 때만 실행")


def _project_with_tasks(conn, user, status="in_progress"):
    project = project_repo.create_project(conn, user, ProjectCreate(name="P", status=status))
    task_repo.create_task(conn, user, TaskCreate(title="완료", project_id=project["id"], status="completed"))
    task_repo.create_task(conn, user, TaskCreate(title="미완료1", project_id=project["id"]))
    task_repo.create_task(conn, user, TaskCreate(title="미완료2", project_id=project["id"], status="review"))
    dropped = task_repo.create_task(conn, user, TaskCreate(title="제외", project_id=project["id"]))
    task_repo.update_task(conn, user, dropped["id"], TaskUpdate(status="cancelled"))
    return project


def test_complete_with_open_tasks_records_count(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        project = _project_with_tasks(conn, a)
        assert repo.count_open_tasks(conn, a, project["id"]) == 2  # 완료·제외는 미완료가 아니다
        assert repo.complete(conn, a, project["id"], confirmed_open_tasks=2) is True
        p = project_repo.get_project(conn, a, project["id"])
        assert p["status"] == "completed"
        assert p["open_tasks_at_completion"] == 2 and p["completed_at"] is not None
        # 업무 데이터는 그대로
        assert len(task_repo.list_tasks(conn, a, project_id=project["id"])) == 3
        history = repo.list_history(conn, a, project["id"])
        assert [(h["action"], h["from_status"], h["to_status"], h["open_tasks"]) for h in history] == [("complete", "in_progress", "completed", 2)]


def test_complete_rejects_stale_count(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        project = _project_with_tasks(conn, a)
        with pytest.raises(repo.OpenTasksChanged) as exc:
            repo.complete(conn, a, project["id"], confirmed_open_tasks=1)
        assert exc.value.open_tasks == 2
        assert project_repo.get_project(conn, a, project["id"])["status"] == "in_progress"
        assert repo.list_history(conn, a, project["id"]) == []


def test_restore_steps_back_through_history(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        project = project_repo.create_project(conn, a, ProjectCreate(name="P", status="review"))
        pid = project["id"]
        repo.complete(conn, a, pid, 0)
        repo.archive(conn, a, pid)
        p = project_repo.get_project(conn, a, pid)
        assert p["status"] == "archived" and p["archived_at"] is not None and p["completed_at"] is None

        repo.restore(conn, a, pid)
        assert project_repo.get_project(conn, a, pid)["status"] == "completed"
        repo.restore(conn, a, pid)
        assert project_repo.get_project(conn, a, pid)["status"] == "review"  # 완료 직전 상태
        with pytest.raises(repo.InvalidTransition):
            repo.restore(conn, a, pid)

        actions = [(h["action"], h["from_status"], h["to_status"]) for h in reversed(repo.list_history(conn, a, pid))]
        assert actions == [
            ("complete", "review", "completed"),
            ("archive", "completed", "archived"),
            ("restore", "archived", "completed"),
            ("restore", "completed", "review"),
        ]


def test_archive_from_active_and_restore(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        project = project_repo.create_project(conn, a, ProjectCreate(name="P", status="planning"))
        repo.archive(conn, a, project["id"])
        with pytest.raises(repo.InvalidTransition):
            repo.archive(conn, a, project["id"])
        with pytest.raises(repo.InvalidTransition):
            repo.complete(conn, a, project["id"], 0)  # 보관 상태에서는 먼저 복원
        repo.restore(conn, a, project["id"])
        assert project_repo.get_project(conn, a, project["id"])["status"] == "planning"


def test_complete_twice_rejected_and_patch_status_blocked(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        project = project_repo.create_project(conn, a, ProjectCreate(name="P"))
        repo.complete(conn, a, project["id"], 0)
        with pytest.raises(repo.InvalidTransition):
            repo.complete(conn, a, project["id"], 0)
        with pytest.raises(FieldError) as exc:
            project_repo.update_project(conn, a, project["id"], ProjectUpdate(status="in_progress"))
        assert exc.value.field == "status"
        # 상태 외 수정은 가능
        assert project_repo.update_project(conn, a, project["id"], ProjectUpdate(name="새 이름"))["name"] == "새 이름"


def test_other_user_cannot_transition_or_read_history(db) -> None:
    conn, a, b, as_user = db
    with as_user(a):
        project = project_repo.create_project(conn, a, ProjectCreate(name="P"))
        repo.complete(conn, a, project["id"], 0)
    with as_user(b):
        assert repo.restore(conn, b, project["id"]) is False
        assert repo.archive(conn, b, project["id"]) is False
        assert repo.list_history(conn, b, project["id"]) == []
    with as_user(a):
        assert project_repo.get_project(conn, a, project["id"])["status"] == "completed"


def test_project_deletion_removes_history(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        project = project_repo.create_project(conn, a, ProjectCreate(name="P"))
        repo.archive(conn, a, project["id"])
        deletion_repo.delete_project(conn, a, project["id"], ProjectDeleteRequest(mode="delete", expected_task_ids=[]))
        assert repo.list_history(conn, a, project["id"]) == []
