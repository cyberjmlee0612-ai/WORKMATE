"""사용자 설정과 계정 삭제 테스트.

- 단위: 입력 검증 (이름 정리·길이)
- DB(RUN_DB_TESTS=1): 기본값·저장·RLS 격리, 계정 삭제(이메일·비밀번호 확인, 연쇄 삭제, 실패 횟수 제한)
"""

import os
from datetime import date, datetime, timezone
from uuid import UUID

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import settings as settings_api
from app.core.auth import CurrentUser, get_current_user
from app.core.errors import FieldError, register_error_handlers
from app.db import get_user_db
from app.repositories import account
from app.repositories import projects as project_repo
from app.repositories import tasks as task_repo
from app.schemas.project import ProjectCreate
from app.schemas.task import TaskCreate

db_only = pytest.mark.skipif(os.environ.get("RUN_DB_TESTS") != "1", reason="RUN_DB_TESTS=1 일 때만 실행")

VALID = {"display_name": "  이  정민 "}


def _user(uid: UUID, email: str | None = None) -> CurrentUser:
    return CurrentUser(id=uid, email=email, claims={})


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    register_error_handlers(app)
    app.include_router(settings_api.router)
    app.dependency_overrides[get_current_user] = lambda: _user(UUID(int=1))
    app.dependency_overrides[get_user_db] = lambda: object()
    return TestClient(app)


def test_settings_validation(client: TestClient) -> None:
    assert settings_api.SettingsIn(**VALID).display_name == "이 정민"
    assert settings_api.SettingsIn(display_name="   ").display_name is None
    assert "display_name" in client.put("/settings", json={"display_name": "가" * 31}).json()["errors"]
    assert client.put("/settings", json={**VALID, "work_start": "09:00"}).status_code == 422  # 옮긴 칸은 거부


@db_only
def test_settings_defaults_save_and_isolation(db) -> None:
    conn, a, b, as_user = db
    with as_user(a):
        out = settings_api.get_settings_route(_user(a, "a@example.com"), conn)
        assert out == {"email": "a@example.com", "display_name": None}
        assert settings_api.put_settings(settings_api.SettingsIn(**VALID), _user(a), conn)["display_name"] == "이 정민"
        assert settings_api.put_settings(settings_api.SettingsIn(display_name=None), _user(a), conn)["display_name"] is None
    with as_user(b):
        assert settings_api.get_settings_route(_user(b), conn)["display_name"] is None
        assert conn.execute("select count(*) as n from public.user_settings").fetchone()["n"] == 0  # RLS


def _set_password(conn, uid: UUID, password: str) -> None:
    conn.execute("update auth.users set encrypted_password = extensions.crypt(%s, extensions.gen_salt('bf', 4)) where id = %s", (password, uid))


@db_only
def test_delete_account_checks_and_cascades(db) -> None:
    conn, a, b, as_user = db
    account._failures.clear()
    _set_password(conn, a, "correct-horse")
    email = conn.execute("select email from auth.users where id = %s", (a,)).fetchone()["email"]
    with as_user(a):
        root = project_repo.create_project(conn, a, ProjectCreate(name="루트"))
        child = project_repo.create_project(conn, a, ProjectCreate(name="하위", parent_id=root["id"]))
        task = task_repo.create_task(conn, a, TaskCreate(title="업무", project_id=child["id"]))
        conn.execute(
            "insert into public.task_time_entries (user_id, task_id, started_at, ended_at, source) values (%s, %s, %s, %s, 'manual')",
            (a, task["id"], datetime(2026, 11, 1, 1, tzinfo=timezone.utc), datetime(2026, 11, 1, 2, tzinfo=timezone.utc)),
        )
        conn.execute("insert into public.daily_notes (user_id, note_date, content) values (%s, %s, '메모')", (a, date(2026, 11, 1)))
        conn.execute("insert into public.user_settings (user_id, display_name) values (%s, '나')", (a,))
    with as_user(b):
        task_repo.create_task(conn, b, TaskCreate(title="남의 업무"))

    with pytest.raises(FieldError) as err:
        account.delete_account(conn, a, "other@example.com", "correct-horse")
    assert err.value.field == "email"
    with pytest.raises(FieldError) as err:
        account.delete_account(conn, a, email.upper(), "wrong")
    assert err.value.field == "password"

    account.delete_account(conn, a, f"  {email.upper()} ", "correct-horse")
    assert conn.execute("select count(*) as n from auth.users where id = %s", (a,)).fetchone()["n"] == 0
    for table in ("projects", "tasks", "task_time_entries", "daily_notes", "user_settings"):
        assert conn.execute(f"select count(*) as n from public.{table} where user_id = %s", (a,)).fetchone()["n"] == 0, table
    assert conn.execute("select count(*) as n from public.tasks where user_id = %s", (b,)).fetchone()["n"] == 1
    assert a not in account._failures  # 성공하면 실패 기록을 지운다


@db_only
def test_delete_account_locks_after_failures(db) -> None:
    conn, a, _, _ = db
    account._failures.clear()
    _set_password(conn, a, "pw-1234")
    email = conn.execute("select email from auth.users where id = %s", (a,)).fetchone()["email"]
    for _ in range(account.MAX_FAILURES):
        with pytest.raises(FieldError):
            account.delete_account(conn, a, email, "nope")
    with pytest.raises(account.TooManyAttempts):
        account.delete_account(conn, a, email, "pw-1234")  # 맞는 비밀번호도 잠시 막힌다
    assert conn.execute("select count(*) as n from auth.users where id = %s", (a,)).fetchone()["n"] == 1
    account._failures.clear()
