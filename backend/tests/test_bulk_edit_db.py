"""편집 모드(일괄 이동·삭제)를 실제 DB에서 확인 (트랜잭션 안에서 실행 후 롤백).

실행: RUN_DB_TESTS=1 pytest tests/test_bulk_edit_db.py
"""

import os
from datetime import timedelta
from uuid import uuid4

import pytest

from app.core.errors import FieldError
from app.repositories import project_deletion as deletion_repo
from app.repositories import projects as repo
from app.repositories import tasks as task_repo
from app.repositories import time_entries as time_repo
from app.schemas.project import ProjectCreate
from app.schemas.task import TaskCreate
from app.schemas.time_entry import TimeEntryCreate

pytestmark = pytest.mark.skipif(os.environ.get("RUN_DB_TESTS") != "1", reason="RUN_DB_TESTS=1 일 때만 실행")


def _p(conn, user, name, parent=None):
    return repo.create_project(conn, user, ProjectCreate(name=name, parent_id=parent["id"] if parent else None))


def test_bulk_delete_tasks_with_time_entries(db) -> None:
    conn, a, b, as_user = db
    with as_user(a):
        t1 = task_repo.create_task(conn, a, TaskCreate(title="1"))
        t2 = task_repo.create_task(conn, a, TaskCreate(title="2"))
        keep = task_repo.create_task(conn, a, TaskCreate(title="남김"))
        t0 = time_repo.now(conn) - timedelta(hours=2)
        time_repo.create_entry(conn, a, TimeEntryCreate(task_id=t1["id"], started_at=t0, ended_at=t0 + timedelta(hours=1)))
    with as_user(b):
        assert task_repo.delete_tasks(conn, b, [t1["id"]]) == {"deleted": 0, "missing": 1}  # 남의 업무
    with as_user(a):
        assert task_repo.delete_tasks(conn, a, [t1["id"], t2["id"], uuid4()]) == {"deleted": 2, "missing": 1}
        assert [t["id"] for t in task_repo.list_tasks(conn, a)] == [keep["id"]]
        assert time_repo.list_entries(conn, a) == []


def test_move_projects_up_and_follow_ancestor(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        top = _p(conn, a, "A")
        mid = _p(conn, a, "B", top)
        leaf = _p(conn, a, "C", mid)
        other = _p(conn, a, "X")
        # 하위(C)를 최상위로 꺼내기
        assert repo.move_projects(conn, a, [leaf["id"]], None)["moved"] == 1
        assert repo.get_project(conn, a, leaf["id"])["parent_id"] is None
        # B와 그 하위를 함께 골라 X 아래로 → 하위는 B를 따라간다
        _ = repo.move_projects(conn, a, [leaf["id"]], mid["id"])
        result = repo.move_projects(conn, a, [mid["id"], leaf["id"]], other["id"])
        assert result == {"moved": 1, "unchanged": 0, "skipped": 1, "missing": 0}
        assert repo.get_project(conn, a, leaf["id"])["parent_id"] == mid["id"]
        assert repo.get_project(conn, a, mid["id"])["parent_id"] == other["id"]


def test_move_projects_rule_violation_cancels_all(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        top = _p(conn, a, "A")
        mid = _p(conn, a, "B", top)
        x = _p(conn, a, "X")
        with pytest.raises(FieldError) as exc:  # A를 자기 하위 B 아래로
            repo.move_projects(conn, a, [x["id"], top["id"]], mid["id"])
        assert "‘A’" in exc.value.message


def test_bulk_delete_projects_modes(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        top = _p(conn, a, "A")
        mid = _p(conn, a, "B", top)
        solo = _p(conn, a, "S")
        task_repo.create_task(conn, a, TaskCreate(title="a", project_id=top["id"]))
        task_repo.create_task(conn, a, TaskCreate(title="b", project_id=mid["id"]))
        task_repo.create_task(conn, a, TaskCreate(title="s", project_id=solo["id"]))
        # 업무는 개인 업무로, 하위는 꺼내기 → A와 S만 삭제, B는 최상위로
        result = deletion_repo.delete_many(conn, a, [top["id"], solo["id"]], "move", "lift")
        assert result == {"deleted_projects": 2, "moved_tasks": 2, "deleted_tasks": 0, "lifted_subprojects": 1, "deleted_subprojects": 0}
        assert repo.get_project(conn, a, mid["id"])["parent_id"] is None
        assert sorted(t["title"] for t in task_repo.list_tasks(conn, a, scope="personal")) == ["a", "s"]


def test_bulk_delete_parent_and_child_selected_together(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        top = _p(conn, a, "A")
        mid = _p(conn, a, "B", top)
        leaf = _p(conn, a, "C", mid)
        task_repo.create_task(conn, a, TaskCreate(title="c", project_id=leaf["id"]))
        result = deletion_repo.delete_many(conn, a, [top["id"], mid["id"]], "delete", "delete")
        assert result["deleted_projects"] == 2 and result["deleted_subprojects"] == 1 and result["deleted_tasks"] == 1
        assert repo.list_projects(conn, a) == []
