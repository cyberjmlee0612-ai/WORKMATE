"""DB 통합 테스트 공통 fixture.

테스트마다 하나의 트랜잭션 안에서 가짜 사용자 2명을 만들고 끝나면 롤백하므로 데이터가 남지 않는다.
실행: RUN_DB_TESTS=1 pytest
"""

import json
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from uuid import UUID, uuid4

import psycopg
import pytest
from psycopg.rows import dict_row

from app.core.config import get_settings


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
