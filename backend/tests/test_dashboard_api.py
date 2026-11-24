"""대시보드 API 파라미터 검증 (DB 없이 실행)."""

from typing import Any
from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import dashboard
from app.core.auth import CurrentUser, get_current_user
from app.core.errors import register_error_handlers
from app.db import get_user_db

USER = CurrentUser(id=UUID("11111111-1111-1111-1111-111111111111"), email="a@example.com", claims={})


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    app = FastAPI()
    register_error_handlers(app)
    app.include_router(dashboard.router)
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[get_user_db] = lambda: object()

    def fake(db: Any, user_id: UUID, today: Any, tz: str) -> dict[str, Any]:
        return {
            "today": today, "projects": [], "today_tasks": [], "today_has_more": False,
            "kpi": {"total_projects": 0, "active_projects": 0, "total_tasks": 0, "completed_tasks": 0, "progress": 0},
        }

    monkeypatch.setattr(dashboard.repo, "get_dashboard", fake)
    return TestClient(app)


def test_ok_with_timezone(client: TestClient) -> None:
    res = client.get("/dashboard", params={"today": "2026-11-24", "tz": "Asia/Seoul"})
    assert res.status_code == 200
    assert res.json()["today"] == "2026-11-24"


def test_today_is_required(client: TestClient) -> None:
    res = client.get("/dashboard")
    assert res.status_code == 422
    assert "today" in res.json()["errors"]


def test_invalid_date(client: TestClient) -> None:
    assert client.get("/dashboard", params={"today": "2026-02-30"}).status_code == 422


@pytest.mark.parametrize("tz", ["Mars/Olympus", "../../etc/passwd", ""])
def test_unknown_timezone(client: TestClient, tz: str) -> None:
    res = client.get("/dashboard", params={"today": "2026-11-24", "tz": tz})
    assert res.status_code == 422
    assert "tz" in res.json()["errors"]
