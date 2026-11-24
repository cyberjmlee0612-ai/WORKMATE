"""실제 Supabase DB에서 업무 소유권·개인 업무·정렬·completed_at을 확인하는 통합 테스트.

db fixture는 tests/conftest.py (트랜잭션 안에서 실행 후 롤백).
실행: RUN_DB_TESTS=1 pytest tests/test_tasks_db.py
"""

import os
from datetime import date

import pytest

from app.core.errors import FieldError
from app.repositories import projects as project_repo
from app.repositories import tasks as repo
from app.schemas.project import ProjectCreate
from app.schemas.task import TaskCreate, TaskUpdate

pytestmark = pytest.mark.skipif(os.environ.get("RUN_DB_TESTS") != "1", reason="RUN_DB_TESTS=1 일 때만 실행")


def test_personal_and_project_tasks(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        project = project_repo.create_project(conn, a, ProjectCreate(name="P"))
        in_project = repo.create_task(conn, a, TaskCreate(title="프로젝트 업무", project_id=project["id"]))
        personal = repo.create_task(conn, a, TaskCreate(title="개인 업무"))

        assert in_project["project_name"] == "P"
        assert personal["project_id"] is None and personal["project_name"] is None

        ids = lambda rows: {r["id"] for r in rows}  # noqa: E731
        assert ids(repo.list_tasks(conn, a)) == {in_project["id"], personal["id"]}
        assert ids(repo.list_tasks(conn, a, scope="personal")) == {personal["id"]}
        assert ids(repo.list_tasks(conn, a, scope="project")) == {in_project["id"]}
        assert ids(repo.list_tasks(conn, a, project_id=project["id"])) == {in_project["id"]}


def test_cannot_attach_to_other_users_project(db) -> None:
    conn, a, b, as_user = db
    with as_user(a):
        a_project = project_repo.create_project(conn, a, ProjectCreate(name="A"))
    with as_user(b):
        with pytest.raises(FieldError) as exc:
            repo.create_task(conn, b, TaskCreate(title="끼워넣기", project_id=a_project["id"]))
        assert exc.value.field == "project_id"

        b_task = repo.create_task(conn, b, TaskCreate(title="B 개인 업무"))
        with pytest.raises(FieldError):
            repo.update_task(conn, b, b_task["id"], TaskUpdate(project_id=a_project["id"]))


def test_other_user_cannot_read_update_delete(db) -> None:
    conn, a, b, as_user = db
    with as_user(a):
        task = repo.create_task(conn, a, TaskCreate(title="A 업무"))
    with as_user(b):
        assert repo.list_tasks(conn, b) == []
        assert repo.get_task(conn, b, task["id"]) is None
        assert repo.update_task(conn, b, task["id"], TaskUpdate(title="탈취")) is None
        assert repo.delete_task(conn, b, task["id"]) is False
    with as_user(a):
        assert repo.get_task(conn, a, task["id"])["title"] == "A 업무"


def test_move_to_personal_and_back(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        project = project_repo.create_project(conn, a, ProjectCreate(name="P"))
        task = repo.create_task(conn, a, TaskCreate(title="t", project_id=project["id"]))
        moved = repo.update_task(conn, a, task["id"], TaskUpdate(project_id=None))
        assert moved["project_id"] is None
        back = repo.update_task(conn, a, task["id"], TaskUpdate(project_id=project["id"]))
        assert back["project_id"] == project["id"] and back["project_name"] == "P"


def test_completed_at_follows_status(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        task = repo.create_task(conn, a, TaskCreate(title="t"))
        assert task["completed_at"] is None
        done = repo.update_task(conn, a, task["id"], TaskUpdate(status="completed"))
        assert done["completed_at"] is not None
        # 완료 상태에서 제목만 바꿔도 완료 시각은 유지
        renamed = repo.update_task(conn, a, task["id"], TaskUpdate(title="t2"))
        assert renamed["completed_at"] == done["completed_at"]
        reopened = repo.update_task(conn, a, task["id"], TaskUpdate(status="in_progress"))
        assert reopened["completed_at"] is None


def test_partial_update_and_clear(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        task = repo.create_task(conn, a, TaskCreate(title="t", description="d", due_date=date(2026, 12, 1), estimated_minutes=30))
        updated = repo.update_task(conn, a, task["id"], TaskUpdate(priority="high", estimated_minutes=None))
    assert updated["priority"] == "high"
    assert updated["estimated_minutes"] is None
    assert updated["description"] == "d" and updated["due_date"] == date(2026, 12, 1)


def test_default_ordering(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        make = lambda **kw: repo.create_task(conn, a, TaskCreate(**kw))["title"]  # noqa: E731
        make(title="완료됨", status="completed", due_date=date(2026, 1, 1))
        make(title="마감 없음", priority="urgent")
        make(title="늦은 마감", due_date=date(2026, 12, 20))
        make(title="이른 마감 보통", due_date=date(2026, 12, 1), priority="medium")
        make(title="이른 마감 긴급", due_date=date(2026, 12, 1), priority="urgent")
        order = [r["title"] for r in repo.list_tasks(conn, a)]
    assert order == ["이른 마감 긴급", "이른 마감 보통", "늦은 마감", "마감 없음", "완료됨"]


def test_delete_and_project_progress(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        project = project_repo.create_project(conn, a, ProjectCreate(name="P"))
        t1 = repo.create_task(conn, a, TaskCreate(title="1", project_id=project["id"], status="completed"))
        repo.create_task(conn, a, TaskCreate(title="2", project_id=project["id"]))
        assert project_repo.get_project(conn, a, project["id"])["progress"] == 50
        assert repo.delete_task(conn, a, t1["id"]) is True
        assert repo.delete_task(conn, a, t1["id"]) is False  # 중복 삭제는 안전하게 False
        assert project_repo.get_project(conn, a, project["id"])["progress"] == 0
