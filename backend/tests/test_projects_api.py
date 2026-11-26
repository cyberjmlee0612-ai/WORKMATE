"""프로젝트 API 입력 검증·오류 형식 테스트 (DB 없이 실행)."""

from typing import Any
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import projects
from app.core.auth import CurrentUser, get_current_user
from app.core.errors import register_error_handlers
from app.db import get_user_db

USER = CurrentUser(id=UUID("11111111-1111-1111-1111-111111111111"), email="a@example.com", claims={})


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    app = FastAPI()
    register_error_handlers(app)
    app.include_router(projects.router)
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[get_user_db] = lambda: object()  # 저장소를 바꿔치기하므로 실제 연결 불필요

    def fake_create(db: Any, user_id: UUID, data: Any) -> dict[str, Any]:
        return {
            "id": uuid4(), **data.model_dump(), "created_at": "2026-11-24T00:00:00Z", "updated_at": "2026-11-24T00:00:00Z",
            "total_tasks": 0, "completed_tasks": 0, "cancelled_tasks": 0, "progress": 0,
            "completed_at": None, "open_tasks_at_completion": None, "archived_at": None,
        }

    monkeypatch.setattr(projects.repo, "create_project", fake_create)
    monkeypatch.setattr(projects.repo, "get_project", lambda db, user_id, project_id: None)
    monkeypatch.setattr(projects.repo, "update_project", lambda db, user_id, project_id, data: None)
    return TestClient(app)


def test_create_trims_and_defaults(client: TestClient) -> None:
    res = client.post("/projects", json={"name": "  새 프로젝트  ", "description": "   "})
    assert res.status_code == 201
    body = res.json()
    assert body["name"] == "새 프로젝트"
    assert body["description"] is None
    assert body["status"] == "planning"


@pytest.mark.parametrize(
    ("payload", "field"),
    [
        ({"name": "   "}, "name"),
        ({}, "name"),
        ({"name": "x" * 201}, "name"),
        ({"name": "a", "start_date": "2026-12-10", "due_date": "2026-12-01"}, "due_date"),
        ({"name": "a", "due_date": "2026-13-40"}, "due_date"),
        ({"name": "a", "status": "completed"}, "status"),  # 완료는 폼에서 직접 지정 불가
        ({"name": "a", "user_id": str(uuid4())}, "user_id"),  # 소유자 지정 불가
    ],
)
def test_create_validation_errors(client: TestClient, payload: dict[str, Any], field: str) -> None:
    res = client.post("/projects", json=payload)
    assert res.status_code == 422
    body = res.json()
    assert body["detail"] == "입력값을 확인해 주세요."
    assert field in body["errors"], body


def test_blank_name_message_is_korean(client: TestClient) -> None:
    res = client.post("/projects", json={"name": " "})
    assert res.json()["errors"]["name"] == "프로젝트 이름을 입력해 주세요."


def test_date_order_message(client: TestClient) -> None:
    res = client.post("/projects", json={"name": "a", "start_date": "2026-12-10", "due_date": "2026-12-01"})
    assert res.json()["errors"]["due_date"] == "마감일은 시작일과 같거나 이후여야 합니다."


def test_patch_rejects_null_name(client: TestClient) -> None:
    res = client.patch(f"/projects/{uuid4()}", json={"name": None})
    assert res.status_code == 422
    assert "name" in res.json()["errors"]


def test_get_missing_returns_404(client: TestClient) -> None:
    res = client.get(f"/projects/{uuid4()}")
    assert res.status_code == 404
    assert res.json()["detail"] == "프로젝트를 찾을 수 없습니다."


def test_patch_missing_returns_404(client: TestClient) -> None:
    assert client.patch(f"/projects/{uuid4()}", json={"name": "새 이름"}).status_code == 404


@pytest.mark.parametrize(
    "payload",
    [
        {"mode": "archive", "expected_task_ids": []},  # 알 수 없는 방식
        {"mode": "move"},  # 확인한 목록 누락
        {"mode": "move", "expected_task_ids": ["not-a-uuid"]},
        {"mode": "move", "expected_task_ids": [], "keep_task_ids": ["11111111-1111-1111-1111-111111111111"] * 2},  # 중복
        {"mode": "delete", "expected_task_ids": [], "user_id": "x"},  # 정의되지 않은 필드
    ],
)
def test_delete_request_validation(client: TestClient, payload: dict[str, Any]) -> None:
    assert client.post(f"/projects/{uuid4()}/delete", json=payload).status_code == 422


def test_delete_missing_project_404(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    def raise_not_found(*args: Any, **kwargs: Any) -> None:
        raise projects.deletion_repo.ProjectNotFound

    monkeypatch.setattr(projects.deletion_repo, "delete_project", raise_not_found)
    res = client.post(f"/projects/{uuid4()}/delete", json={"mode": "delete", "expected_task_ids": []})
    assert res.status_code == 404


def test_delete_tasks_changed_409(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    def raise_changed(*args: Any, **kwargs: Any) -> None:
        raise projects.deletion_repo.TasksChanged([])

    monkeypatch.setattr(projects.deletion_repo, "delete_project", raise_changed)
    res = client.post(f"/projects/{uuid4()}/delete", json={"mode": "delete", "expected_task_ids": []})
    assert res.status_code == 409
    assert res.json()["code"] == "tasks_changed" and res.json()["tasks"] == []


@pytest.mark.parametrize("payload", [{}, {"confirmed_open_tasks": -1}, {"confirmed_open_tasks": "a"}, {"confirmed_open_tasks": 0, "x": 1}])
def test_complete_request_validation(client: TestClient, payload: dict[str, Any]) -> None:
    assert client.post(f"/projects/{uuid4()}/complete", json=payload).status_code == 422


def test_complete_open_tasks_changed_409(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    def raise_changed(*args: Any, **kwargs: Any) -> None:
        raise projects.status_repo.OpenTasksChanged(3)

    monkeypatch.setattr(projects.status_repo, "complete", raise_changed)
    res = client.post(f"/projects/{uuid4()}/complete", json={"confirmed_open_tasks": 1})
    assert res.status_code == 409
    assert res.json()["code"] == "open_tasks_changed" and res.json()["open_tasks"] == 3


def test_invalid_transition_409(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    def raise_invalid(*args: Any, **kwargs: Any) -> None:
        raise projects.status_repo.InvalidTransition("이미 진행 중인 프로젝트입니다.")

    monkeypatch.setattr(projects.status_repo, "restore", raise_invalid)
    res = client.post(f"/projects/{uuid4()}/restore")
    assert res.status_code == 409
    assert res.json() == {"detail": "이미 진행 중인 프로젝트입니다.", "code": "invalid_transition"}


def test_transition_missing_project_404(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(projects.status_repo, "archive", lambda *a, **k: False)
    assert client.post(f"/projects/{uuid4()}/archive").status_code == 404


def test_invalid_uuid_returns_422(client: TestClient) -> None:
    assert client.get("/projects/not-a-uuid").status_code == 422
