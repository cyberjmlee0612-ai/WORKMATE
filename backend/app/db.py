"""Postgres 연결과 요청 단위 트랜잭션.

FastAPI는 DB에 직접 연결하지만, 요청마다 트랜잭션 안에서
`authenticated` 역할과 JWT claims를 지정해 Supabase RLS가 그대로 적용되게 한다.
쿼리에서도 user_id 조건을 함께 써서 소유권을 이중으로 확인한다.

동기 psycopg를 쓰는 이유: Windows 기본 이벤트 루프(Proactor)에서는 psycopg 비동기 모드가
동작하지 않는다. FastAPI는 동기 의존성/엔드포인트를 스레드풀에서 실행하므로 충분하다.
"""

import json
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Annotated

from fastapi import Depends
from psycopg import Connection
from psycopg.rows import DictRow, dict_row
from psycopg_pool import ConnectionPool

from app.core.auth import CurrentUserDep

_pool: ConnectionPool[Connection[DictRow]] | None = None


def open_pool(database_url: str) -> None:
    global _pool
    _pool = ConnectionPool(
        database_url,
        min_size=1,
        max_size=10,
        open=False,
        connection_class=Connection[DictRow],
        # Supabase pooler(트랜잭션 모드)와 충돌하지 않도록 prepared statement 비활성화
        kwargs={"row_factory": dict_row, "prepare_threshold": None},
    )
    _pool.open(wait=True, timeout=10)


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


def get_user_db(user: CurrentUserDep) -> Iterator[Connection[DictRow]]:
    """인증된 사용자 권한으로 실행되는 트랜잭션. 예외가 나면 전체 롤백된다."""
    if _pool is None:
        raise RuntimeError("DB pool is not open")

    with _pool.connection() as conn, conn.transaction():
        # set_config(..., true) / SET LOCAL: 트랜잭션이 끝나면 자동 해제되어 커넥션 재사용 시 섞이지 않는다
        conn.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps(user.claims),))
        conn.execute("set local role authenticated")
        yield conn


UserDbDep = Annotated[Connection[DictRow], Depends(get_user_db)]


@contextmanager
def owner_transaction() -> Iterator[Connection[DictRow]]:
    """RLS 역할을 쓰지 않는 트랜잭션. auth 스키마를 다뤄야 하는 계정 삭제에만 쓴다.
    호출하는 쪽이 반드시 토큰의 user_id로만 범위를 제한해야 한다."""
    if _pool is None:
        raise RuntimeError("DB pool is not open")
    with _pool.connection() as conn, conn.transaction():
        yield conn
