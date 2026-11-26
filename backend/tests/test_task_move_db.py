"""업무 이동(개인 ↔ 프로젝트)과 '새 프로젝트로 한 번에 저장'을 실제 DB에서 확인 (트랜잭션 안에서 실행 후 롤백).

실행: RUN_DB_TESTS=1 pytest tests/test_task_move_db.py
"""

import os
from datetime import timedelta
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.api import tasks as tasks_api
from app.core.auth import CurrentUser
from app.core.errors import FieldError
from app.repositories import project_status as status_repo
from app.repositories import projects as project_repo
from app.repositories import tasks as repo
from app.repositories import time_entries as time_repo
from app.repositories import time_plans as plan_repo
from app.schemas.project import ProjectCreate
from app.schemas.task import TaskBulkCreate, TaskCreate, TaskMove
from app.schemas.time_entry import TimeEntryCreate
from app.schemas.time_plan import TimePlanCreate

pytestmark = pytest.mark.skipif(os.environ.get("RUN_DB_TESTS") != "1", reason="RUN_DB_TESTS=1 일 때만 실행")


def _user(uid) -> CurrentUser:
    return CurrentUser(id=uid, email=None, claims={})


def test_move_personal_to_project_and_back_keeps_time_data(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        project = project_repo.create_project(conn, a, ProjectCreate(name="P"))
        task = repo.create_task(conn, a, TaskCreate(title="개인 업무"))
        other = repo.create_task(conn, a, TaskCreate(title="이미 프로젝트", project_id=project["id"]))
        t0 = time_repo.now(conn) - timedelta(hours=3)
        time_repo.create_entry(conn, a, TimeEntryCreate(task_id=task["id"], started_at=t0, ended_at=t0 + timedelta(hours=1)))
        plan_repo.create_plan(conn, a, TimePlanCreate(task_id=task["id"], starts_at=t0, ends_at=t0 + timedelta(hours=1)))

        result = repo.move_tasks(conn, a, [task["id"], other["id"], uuid4()], project["id"])
        assert result == {"moved": 1, "unchanged": 1, "missing": 1}
        moved = repo.get_task(conn, a, task["id"])
        assert moved["project_id"] == project["id"] and moved["tracked_minutes"] == 60 and moved["planned_minutes"] == 60
        assert project_repo.get_project(conn, a, project["id"])["total_tasks"] == 2  # 진행률에 반영

        back = repo.move_tasks(conn, a, [task["id"]], None)
        assert back["moved"] == 1 and repo.get_task(conn, a, task["id"])["project_id"] is None


def test_cannot_move_into_closed_or_foreign_project(db) -> None:
    conn, a, b, as_user = db
    with as_user(a):
        task = repo.create_task(conn, a, TaskCreate(title="업무"))
        closed = project_repo.create_project(conn, a, ProjectCreate(name="완료"))
        status_repo.complete(conn, a, closed["id"], confirmed_open_tasks=0)
        with pytest.raises(FieldError) as exc:
            repo.move_tasks(conn, a, [task["id"]], closed["id"])
        assert exc.value.field == "project_id" and "다시 열어" in exc.value.message
    with as_user(b):
        foreign = project_repo.create_project(conn, b, ProjectCreate(name="B 프로젝트"))
        # B는 A의 업무를 옮길 수 없다 (없는 것으로 센다)
        assert repo.move_tasks(conn, b, [task["id"]], foreign["id"]) == {"moved": 0, "unchanged": 0, "missing": 1}
    with as_user(a):
        with pytest.raises(FieldError):
            repo.move_tasks(conn, a, [task["id"]], foreign["id"])
        assert repo.get_task(conn, a, task["id"])["project_id"] is None


def test_bulk_create_into_new_project(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        body = TaskBulkCreate(tasks=[TaskCreate(title="하나"), TaskCreate(title="둘")], new_project=ProjectCreate(name="  AI 제안 프로젝트 "))
        created = tasks_api.create_tasks_bulk(body, _user(a), conn)
        project_id = created[0]["project_id"]
        assert project_id is not None and all(t["project_id"] == project_id for t in created)
        project = project_repo.get_project(conn, a, project_id)
        assert project["name"] == "AI 제안 프로젝트" and project["total_tasks"] == 2


def test_bulk_new_project_rolls_back_with_tasks(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        before = len(project_repo.list_projects(conn, a))
        # 저장 도중 실패하면(DB 제약 위반) 새로 만든 프로젝트도 남지 않는다
        bad = TaskBulkCreate.model_construct(tasks=[TaskCreate(title="ok"), TaskCreate.model_construct(title=" ", project_id=None, description=None, status="todo", priority="medium", due_date=None, estimated_minutes=None)], new_project=ProjectCreate(name="롤백"))
        with pytest.raises(Exception), conn.transaction():
            tasks_api.create_tasks_bulk(bad, _user(a), conn)
        assert len(project_repo.list_projects(conn, a)) == before


def test_bulk_rejects_mixed_destination() -> None:
    with pytest.raises(ValidationError):
        TaskBulkCreate(tasks=[TaskCreate(title="x", project_id=uuid4())], new_project=ProjectCreate(name="P"))


def test_move_dedupes_ids() -> None:
    same = uuid4()
    assert TaskMove(task_ids=[same, same], project_id=None).task_ids == [same]
