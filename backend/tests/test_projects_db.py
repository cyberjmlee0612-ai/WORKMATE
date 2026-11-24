"""실제 Supabase DB에서 RLS·진행률·부분 수정을 확인하는 통합 테스트.

테스트마다 하나의 트랜잭션 안에서 가짜 사용자 2명을 만들고 끝나면 롤백하므로 데이터가 남지 않는다.
실행: RUN_DB_TESTS=1 pytest tests/test_projects_db.py
"""

import json
import os
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import date
from uuid import UUID, uuid4

import psycopg
import pytest
from psycopg.rows import dict_row

from app.core.config import get_settings
from app.repositories import projects as repo
from app.schemas.project import ProjectCreate, ProjectUpdate

pytestmark = pytest.mark.skipif(os.environ.get("RUN_DB_TESTS") != "1", reason="RUN_DB_TESTS=1 일 때만 실행")

@pytest.fixture
def db() -> Iterator[tuple[psycopg.Connection, UUID, UUID, Callable]]:
    conn = psycopg.connect(get_settings().database_url, row_factory=dict_row, prepare_threshold=None)
    try:
        user_a, user_b = uuid4(), uuid4()
        for uid in (user_a, user_b):
            conn.execute(
                "insert into auth.users (id, email, aud, role) values (%s, %s, 'authenticated', 'authenticated')",
                (uid, f"test-{uid}@example.com"),
            )

        @contextmanager
        def as_user(uid: UUID) -> Iterator[psycopg.Connection]:
            # 앱의 get_user_db와 같은 방식으로 RLS 컨텍스트를 건다
            conn.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({"sub": str(uid), "role": "authenticated"}),))
            conn.execute("set local role authenticated")
            try:
                yield conn
            finally:
                conn.execute("reset role")

        yield conn, user_a, user_b, as_user
    finally:
        conn.rollback()  # 모든 테스트 데이터 폐기
        conn.close()


def test_create_and_owner_isolation(db) -> None:
    conn, a, b, as_user = db
    with as_user(a):
        created = repo.create_project(conn, a, ProjectCreate(name="A 프로젝트"))
        assert created["progress"] == 0 and created["total_tasks"] == 0
        assert [p["id"] for p in repo.list_projects(conn, a)] == [created["id"]]

    with as_user(b):
        assert repo.list_projects(conn, b) == []
        assert repo.get_project(conn, b, created["id"]) is None
        assert repo.update_project(conn, b, created["id"], ProjectUpdate(name="탈취")) is None
        # B 세션에서 user_id 조건에 A의 id를 넣어도(서버 버그 가정) RLS가 막는다
        assert repo.get_project(conn, a, created["id"]) is None

    with as_user(a):
        assert repo.get_project(conn, a, created["id"])["name"] == "A 프로젝트"


def test_progress_is_floored(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        project = repo.create_project(conn, a, ProjectCreate(name="진행률"))
        for status in ("completed", "completed", "todo"):
            conn.execute(
                "insert into public.tasks (user_id, project_id, title, status) values (%s, %s, 't', %s)",
                (a, project["id"], status),
            )
        conn.execute("insert into public.tasks (user_id, title, status) values (%s, '개인 업무', 'completed')", (a,))
        result = repo.get_project(conn, a, project["id"])
    assert result["total_tasks"] == 3  # 개인 업무는 포함하지 않는다
    assert result["completed_tasks"] == 2
    assert result["progress"] == 66  # 66.67 → 66 (내림)


def test_partial_update_keeps_other_fields(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        project = repo.create_project(
            conn, a, ProjectCreate(name="원래 이름", description="설명", start_date=date(2026, 12, 1), due_date=date(2026, 12, 31))
        )
        updated = repo.update_project(conn, a, project["id"], ProjectUpdate(status="in_progress"))
    assert updated["status"] == "in_progress"
    assert updated["name"] == "원래 이름" and updated["description"] == "설명"
    assert updated["due_date"] == date(2026, 12, 31)


def test_update_can_clear_dates(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        project = repo.create_project(conn, a, ProjectCreate(name="p", due_date=date(2026, 12, 31)))
        updated = repo.update_project(conn, a, project["id"], ProjectUpdate(due_date=None))
    assert updated["due_date"] is None


def test_update_date_order_checked_against_existing(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        project = repo.create_project(conn, a, ProjectCreate(name="p", start_date=date(2026, 12, 10)))
        with pytest.raises(ValueError, match="마감일"):
            repo.update_project(conn, a, project["id"], ProjectUpdate(due_date=date(2026, 12, 1)))
