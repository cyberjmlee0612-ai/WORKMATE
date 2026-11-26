"""시간 기록·타이머 API 입력 검증·오류 형식 테스트 (DB 없이 실행)."""

from typing import Any
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import time_entries as api
from app.core.auth import CurrentUser, get_current_user
from app.core.errors import ConflictError, register_error_handlers
from app.db import get_user_db

USER = CurrentUser(id=UUID("11111111-1111-1111-1111-111111111111"), email="a@example.com", claims={})
TASK = uuid4()


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    app = FastAPI()
    register_error_handlers(app)
    app.include_router(api.timer_router)
    app.include_router(api.entries_router)
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[get_user_db] = lambda: object()

    def fake_create(db: Any, user_id: UUID, data: Any) -> dict[str, Any]:
        raise ConflictError("다른 기록과 시간이 겹쳐요.", "overlap", conflict={"id": uuid4(), "task_title": "겹친 업무"})

    monkeypatch.setattr(api.repo, "create_entry", fake_create)
    monkeypatch.setattr(api.repo, "start_timer", lambda db, user_id, task_id: None)
    monkeypatch.setattr(api.repo, "update_entry", lambda db, user_id, entry_id, data: None)
    monkeypatch.setattr(api.repo, "delete_entry", lambda db, user_id, entry_id: False)
    monkeypatch.setattr(api.repo, "list_entries", lambda db, user_id, **kw: [])
    return TestClient(app)


def _entry(**overrides: Any) -> dict[str, Any]:
    return {"task_id": str(TASK), "started_at": "2026-11-25T10:00:00+09:00", "ended_at": "2026-11-25T11:00:00+09:00", **overrides}


def test_overlap_conflict_format(client: TestClient) -> None:
    res = client.post("/time-entries", json=_entry())
    assert res.status_code == 409
    body = res.json()
    assert body["code"] == "overlap" and body["conflict"]["task_title"] == "겹친 업무"


def test_naive_datetime_rejected(client: TestClient) -> None:
    res = client.post("/time-entries", json=_entry(started_at="2026-11-25T10:00:00"))
    assert res.status_code == 422
    assert res.json()["errors"]["started_at"] == "시간대가 포함된 시각이어야 합니다."


def test_manual_entry_requires_end(client: TestClient) -> None:
    body = _entry()
    del body["ended_at"]
    res = client.post("/time-entries", json=body)
    assert res.status_code == 422 and "ended_at" in res.json()["errors"]


def test_server_owned_fields_rejected(client: TestClient) -> None:
    res = client.post("/time-entries", json=_entry(source="timer"))
    assert res.status_code == 422 and "source" in res.json()["errors"]


def test_note_length(client: TestClient) -> None:
    res = client.post("/time-entries", json=_entry(note="가" * 501))
    assert res.status_code == 422 and "note" in res.json()["errors"]


def test_update_cannot_null_times(client: TestClient) -> None:
    res = client.patch(f"/time-entries/{uuid4()}", json={"ended_at": None})
    assert res.status_code == 422 and res.json()["errors"]["ended_at"] == "시각을 입력해 주세요."


def test_update_missing_entry_404(client: TestClient) -> None:
    assert client.patch(f"/time-entries/{uuid4()}", json={"note": "x"}).status_code == 404
    assert client.delete(f"/time-entries/{uuid4()}").status_code == 404


def test_start_timer_unknown_task_404(client: TestClient) -> None:
    assert client.post("/timer/start", json={"task_id": str(uuid4())}).status_code == 404


def test_list_range_validation(client: TestClient) -> None:
    res = client.get("/time-entries", params={"start": "2026-11-25T10:00:00+09:00", "end": "2026-11-25T09:00:00+09:00"})
    assert res.status_code == 422 and "end" in res.json()["errors"]
    res = client.get("/time-entries", params={"start": "2026-11-25T10:00:00"})
    assert res.status_code == 422 and "start" in res.json()["errors"]
    assert client.get("/time-entries", params={"start": "2026-11-25T10:00:00Z"}).status_code == 200
