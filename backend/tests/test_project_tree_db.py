"""프로젝트 계층(최대 3단계) 규칙을 실제 DB에서 확인 (트랜잭션 안에서 실행 후 롤백).

실행: RUN_DB_TESTS=1 pytest tests/test_project_tree_db.py
"""

import os

import pytest

from app.core.errors import FieldError
from app.repositories import dashboard as dashboard_repo
from app.repositories import project_deletion as deletion_repo
from app.repositories import project_status as status_repo
from app.repositories import projects as repo
from app.repositories import tasks as task_repo
from app.schemas.project import ProjectCreate, ProjectUpdate
from app.schemas.project_deletion import ProjectDeleteRequest
from app.schemas.task import TaskCreate, TaskUpdate

pytestmark = pytest.mark.skipif(os.environ.get("RUN_DB_TESTS") != "1", reason="RUN_DB_TESTS=1 일 때만 실행")


def _p(conn, user, name, parent=None):
    return repo.create_project(conn, user, ProjectCreate(name=name, parent_id=parent["id"] if parent else None))


def _tree(conn, a):
    """A ─ B ─ C (3단계). 업무: A 1개(완료), B 1개, C 2개(1개 완료)"""
    top = _p(conn, a, "A")
    mid = _p(conn, a, "B", top)
    leaf = _p(conn, a, "C", mid)
    task_repo.create_task(conn, a, TaskCreate(title="a1", project_id=top["id"], status="completed"))
    task_repo.create_task(conn, a, TaskCreate(title="b1", project_id=mid["id"]))
    task_repo.create_task(conn, a, TaskCreate(title="c1", project_id=leaf["id"]))
    task_repo.create_task(conn, a, TaskCreate(title="c2", project_id=leaf["id"], status="completed"))
    return top, mid, leaf


def test_progress_rolls_up_subprojects(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        top, mid, leaf = _tree(conn, a)
        A = repo.get_project(conn, a, top["id"])
        assert (A["total_tasks"], A["completed_tasks"], A["progress"]) == (4, 2, 50)  # 하위 포함 합산
        assert (A["own_total_tasks"], A["own_completed_tasks"]) == (1, 1)
        assert A["subproject_count"] == 1 and A["parent_id"] is None
        B = repo.get_project(conn, a, mid["id"])
        assert (B["total_tasks"], B["progress"]) == (3, 33) and B["parent_name"] == "A"
        # 완료 확인용 미완료 수는 직접 속한 업무만
        assert status_repo.count_open_tasks(conn, a, top["id"]) == 0


def test_depth_and_cycle_rules(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        top, mid, leaf = _tree(conn, a)
        for parent, message in ((leaf, "3단계"),):
            with pytest.raises(FieldError) as exc:
                _p(conn, a, "D", parent)
            assert message in exc.value.message and exc.value.field == "parent_id"
        with pytest.raises(FieldError) as exc:  # 순환
            repo.update_project(conn, a, top["id"], ProjectUpdate(parent_id=leaf["id"]))
        assert "하위" in exc.value.message
        x = _p(conn, a, "X")
        _p(conn, a, "Y", x)
        with pytest.raises(FieldError):  # X(+Y) 높이 2 → B 아래면 4단계
            repo.update_project(conn, a, x["id"], ProjectUpdate(parent_id=mid["id"]))
        moved = repo.update_project(conn, a, x["id"], ProjectUpdate(parent_id=top["id"]))
        assert moved["parent_id"] == top["id"]
        out = repo.update_project(conn, a, leaf["id"], ProjectUpdate(parent_id=None))  # 최상위로 꺼내기
        assert out["parent_id"] is None


def test_cannot_nest_under_closed_project(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        done = _p(conn, a, "완료")
        status_repo.complete(conn, a, done["id"], confirmed_open_tasks=0)
        with pytest.raises(FieldError) as exc:
            _p(conn, a, "하위", done)
        assert "다시 열어" in exc.value.message


def test_archive_cascades_and_restore_brings_back_only_cascaded(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        top, mid, leaf = _tree(conn, a)
        other = _p(conn, a, "따로 보관", top)
        status_repo.archive(conn, a, other["id"])  # 먼저 따로 보관
        status_repo.archive(conn, a, top["id"])
        assert all(repo.get_project(conn, a, p["id"])["status"] == "archived" for p in (top, mid, leaf, other))
        # 상위가 보관된 상태에서는 하위만 다시 열 수 없다
        with pytest.raises(status_repo.InvalidTransition):
            status_repo.restore(conn, a, mid["id"])
        history = status_repo.list_history(conn, a, leaf["id"])
        assert history[0]["action"] == "archive" and history[0]["via_project_name"] == "A"

        status_repo.restore(conn, a, top["id"])
        assert repo.get_project(conn, a, top["id"])["status"] == "planning"
        assert repo.get_project(conn, a, mid["id"])["status"] == "planning"
        assert repo.get_project(conn, a, leaf["id"])["status"] == "planning"
        assert repo.get_project(conn, a, other["id"])["status"] == "archived"  # 따로 보관한 것은 그대로


def test_delete_lifts_children_one_level(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        top, mid, leaf = _tree(conn, a)
        preview = deletion_repo.get_preview(conn, a, mid["id"])
        assert [s["name"] for s in preview["subprojects"]] == ["C"] and preview["subprojects"][0]["task_count"] == 2
        b_tasks = [t["id"] for t in preview["tasks"]]
        result = deletion_repo.delete_project(conn, a, mid["id"], ProjectDeleteRequest(
            mode="delete", expected_task_ids=b_tasks, subprojects="lift", expected_subproject_ids=[leaf["id"]],
        ))
        assert result["lifted_subprojects"] == 1 and result["deleted_tasks"] == 1
        assert repo.get_project(conn, a, leaf["id"])["parent_id"] == top["id"]  # 한 단계 위로
        assert repo.get_project(conn, a, top["id"])["total_tasks"] == 3


def test_delete_with_children(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        top, mid, leaf = _tree(conn, a)
        a_tasks = [t["id"] for t in deletion_repo.get_preview(conn, a, top["id"])["tasks"]]
        with pytest.raises(deletion_repo.SubprojectsChanged):  # 확인한 하위 목록이 다르면 거절
            deletion_repo.delete_project(conn, a, top["id"], ProjectDeleteRequest(mode="delete", expected_task_ids=a_tasks, subprojects="delete"))
        result = deletion_repo.delete_project(conn, a, top["id"], ProjectDeleteRequest(
            mode="delete", expected_task_ids=a_tasks, subprojects="delete", expected_subproject_ids=[mid["id"], leaf["id"]],
        ))
        assert result["deleted_subprojects"] == 2 and result["deleted_tasks"] == 4
        assert repo.list_projects(conn, a) == [] and task_repo.list_tasks(conn, a) == []


def test_dashboard_shows_top_most_active_only(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        top, mid, leaf = _tree(conn, a)
        assert [p["name"] for p in dashboard_repo.list_dashboard_projects(conn, a)] == ["A"]
        task_repo.update_task(conn, a, task_repo.list_tasks(conn, a, project_id=top["id"])[0]["id"], TaskUpdate(status="todo"))
        status_repo.complete(conn, a, top["id"], confirmed_open_tasks=1)
        # 상위가 완료되면 진행 중인 하위가 대시보드에 나온다
        assert [p["name"] for p in dashboard_repo.list_dashboard_projects(conn, a)] == ["B"]


def test_task_list_include_subprojects_and_path(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        top, mid, leaf = _tree(conn, a)
        personal = task_repo.create_task(conn, a, TaskCreate(title="개인"))
        own = task_repo.list_tasks(conn, a, project_id=top["id"])
        assert [t["title"] for t in own] == ["a1"]
        everything = task_repo.list_tasks(conn, a, project_id=top["id"], include_subprojects=True)
        assert sorted(t["title"] for t in everything) == ["a1", "b1", "c1", "c2"]
        mid_all = task_repo.list_tasks(conn, a, project_id=mid["id"], include_subprojects=True)
        assert sorted(t["title"] for t in mid_all) == ["b1", "c1", "c2"]
        paths = {t["title"]: t["project_path"] for t in everything}
        assert paths["c1"] == "A › B › C" and paths["a1"] == "A"
        assert task_repo.get_task(conn, a, personal["id"])["project_path"] is None


def test_isolation(db) -> None:
    conn, a, b, as_user = db
    with as_user(a):
        top = _p(conn, a, "A")
    with as_user(b):
        with pytest.raises(FieldError):
            _p(conn, b, "B 하위", top)
