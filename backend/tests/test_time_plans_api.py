"""계획 블록 API 입력 검증 테스트 (DB 없이 실행)."""

from typing import Any
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import time_plans as api
from app.core.auth import CurrentUser, get_current_user
from app.core.errors import register_error_handlers
from app.db import get_user_db

USER = CurrentUser(id=UUID("11111111-1111-1111-1111-111111111111"), email="a@example.com", claims={})


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    app = FastAPI()
    register_error_handlers(app)
    app.include_router(api.router)
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[get_user_db] = lambda: object()
    monkeypatch.setattr(api.repo, "list_plans", lambda db, user_id, **kw: [])
    monkeypatch.setattr(api.repo, "update_plan", lambda db, user_id, plan_id, data: None)
    monkeypatch.setattr(api.repo, "delete_plan", lambda db, user_id, plan_id: False)
    return TestClient(app)


def _params(**overrides: Any) -> dict[str, str]:
    return {"start": "2026-11-29T00:00:00+09:00", "end": "2026-12-06T00:00:00+09:00", **overrides}


def test_list_requires_range(client: TestClient) -> None:
    assert client.get("/time-plans").status_code == 422
    assert client.get("/time-plans", params=_params()).status_code == 200


def test_list_range_limits(client: TestClient) -> None:
    res = client.get("/time-plans", params=_params(end="2027-03-01T00:00:00+09:00"))
    assert res.status_code == 422 and "end" in res.json()["errors"]
    res = client.get("/time-plans", params=_params(start="2026-11-29T00:00:00"))
    assert res.status_code == 422 and "start" in res.json()["errors"]


def test_create_rejects_extra_and_naive(client: TestClient) -> None:
    body = {"task_id": str(uuid4()), "starts_at": "2026-11-30T10:00:00+09:00", "ends_at": "2026-11-30T11:00:00", "user_id": "x"}
    errors = client.post("/time-plans", json=body).json()["errors"]
    assert "ends_at" in errors and "user_id" in errors


def test_update_null_and_missing(client: TestClient) -> None:
    res = client.patch(f"/time-plans/{uuid4()}", json={"starts_at": None})
    assert res.status_code == 422
    assert client.patch(f"/time-plans/{uuid4()}", json={"starts_at": "2026-11-30T10:00:00+09:00"}).status_code == 404
    assert client.delete(f"/time-plans/{uuid4()}").status_code == 404
