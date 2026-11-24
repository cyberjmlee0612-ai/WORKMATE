"""업무 API 입력 검증·오류 형식 테스트 (DB 없이 실행)."""

from typing import Any
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import tasks
from app.core.auth import CurrentUser, get_current_user
from app.core.errors import FieldError, register_error_handlers
from app.db import get_user_db

USER = CurrentUser(id=UUID("11111111-1111-1111-1111-111111111111"), email="a@example.com", claims={})
OTHER_PROJECT = uuid4()


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    app = FastAPI()
    register_error_handlers(app)
    app.include_router(tasks.router)
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[get_user_db] = lambda: object()

    def fake_create(db: Any, user_id: UUID, data: Any) -> dict[str, Any]:
        if data.project_id == OTHER_PROJECT:
            raise FieldError("project_id", "프로젝트를 찾을 수 없습니다.")
        return {
            "id": uuid4(), **data.model_dump(), "project_name": None, "completed_at": None,
            "cancelled_at": None, "cancel_reason": None,
            "created_at": "2026-11-24T00:00:00Z", "updated_at": "2026-11-24T00:00:00Z",
        }

    monkeypatch.setattr(tasks.repo, "create_task", fake_create)
    monkeypatch.setattr(tasks.repo, "get_task", lambda db, user_id, task_id: None)
    monkeypatch.setattr(tasks.repo, "update_task", lambda db, user_id, task_id, data: None)
    monkeypatch.setattr(tasks.repo, "delete_task", lambda db, user_id, task_id: False)
    monkeypatch.setattr(tasks.repo, "list_tasks", lambda db, user_id, **kw: [])
    return TestClient(app)


def test_create_personal_task_defaults(client: TestClient) -> None:
    res = client.post("/tasks", json={"title": "  파이썬 복습  "})
    assert res.status_code == 201
    body = res.json()
    assert body["title"] == "파이썬 복습"
    assert body["project_id"] is None
    assert body["status"] == "todo" and body["priority"] == "medium"


@pytest.mark.parametrize(
    ("payload", "field"),
    [
        ({"title": "  "}, "title"),
        ({}, "title"),
        ({"title": "x" * 301}, "title"),
        ({"title": "a", "estimated_minutes": 0}, "estimated_minutes"),
        ({"title": "a", "estimated_minutes": -10}, "estimated_minutes"),
        ({"title": "a", "estimated_minutes": 10_001}, "estimated_minutes"),
        ({"title": "a", "estimated_minutes": 1.5}, "estimated_minutes"),
        ({"title": "a", "estimated_minutes": "30"}, "estimated_minutes"),
        ({"title": "a", "estimated_minutes": True}, "estimated_minutes"),
        ({"title": "a", "status": "cancelled"}, "status"),  # 새 업무를 제외 상태로 만들 수는 없음
        ({"title": "a", "cancel_reason": "x"}, "cancel_reason"),  # 생성 시 사유 없음
        ({"title": "a", "priority": "asap"}, "priority"),
        ({"title": "a", "project_id": "not-a-uuid"}, "project_id"),
        ({"title": "a", "completed_at": "2026-11-24T00:00:00Z"}, "completed_at"),  # 서버(DB 트리거)가 정한다
        ({"title": "a", "user_id": str(uuid4())}, "user_id"),
    ],
)
def test_create_validation_errors(client: TestClient, payload: dict[str, Any], field: str) -> None:
    res = client.post("/tasks", json=payload)
    assert res.status_code == 422
    assert field in res.json()["errors"], res.json()


def test_other_users_project_is_field_error(client: TestClient) -> None:
    res = client.post("/tasks", json={"title": "a", "project_id": str(OTHER_PROJECT)})
    assert res.status_code == 422
    assert res.json()["errors"] == {"project_id": "프로젝트를 찾을 수 없습니다."}


def test_minutes_message_is_korean(client: TestClient) -> None:
    res = client.post("/tasks", json={"title": "a", "estimated_minutes": 0})
    assert res.json()["errors"]["estimated_minutes"] == "예상 시간은 1분 이상이어야 합니다."


def test_patch_null_title_rejected(client: TestClient) -> None:
    assert client.patch(f"/tasks/{uuid4()}", json={"title": None}).status_code == 422


def test_patch_null_status_rejected(client: TestClient) -> None:
    assert client.patch(f"/tasks/{uuid4()}", json={"status": None}).status_code == 422


def test_patch_null_project_is_allowed_shape(client: TestClient) -> None:
    # 검증은 통과하고(개인 업무 전환), 저장소가 None을 돌려주므로 404
    assert client.patch(f"/tasks/{uuid4()}", json={"project_id": None}).status_code == 404


def test_patch_cancel_with_reason_passes_validation(client: TestClient) -> None:
    # 검증 통과 → 저장소가 None(없음)을 돌려주므로 404
    res = client.patch(f"/tasks/{uuid4()}", json={"status": "cancelled", "cancel_reason": "필요 없어짐"})
    assert res.status_code == 404


def test_patch_reason_with_other_status_rejected(client: TestClient) -> None:
    res = client.patch(f"/tasks/{uuid4()}", json={"status": "todo", "cancel_reason": "x"})
    assert res.status_code == 422
    assert res.json()["errors"]["cancel_reason"] == "제외 사유는 업무를 제외할 때만 입력할 수 있습니다."


def test_patch_reason_too_long(client: TestClient) -> None:
    res = client.patch(f"/tasks/{uuid4()}", json={"status": "cancelled", "cancel_reason": "x" * 501})
    assert res.status_code == 422
    assert "cancel_reason" in res.json()["errors"]


def test_missing_task_404(client: TestClient) -> None:
    assert client.get(f"/tasks/{uuid4()}").status_code == 404
    assert client.delete(f"/tasks/{uuid4()}").status_code == 404


def test_list_rejects_unknown_scope(client: TestClient) -> None:
    assert client.get("/tasks?scope=everything").status_code == 422
    assert client.get("/tasks?scope=personal").status_code == 200
