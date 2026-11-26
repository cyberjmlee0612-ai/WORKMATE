"""계정 삭제 (2026-11-26 사용자 확정: 설정 화면에서 탈퇴).

이메일과 현재 비밀번호를 다시 입력받아 서버에서 확인한 뒤 auth.users 행을 지운다.
모든 사용자 테이블이 auth.users를 on delete cascade로 참조하므로 프로젝트·업무·기록·계획·메모·설정이 함께 지워진다.
auth 스키마를 다뤄야 하므로 RLS 역할이 아닌 소유자 연결(owner_transaction)에서, 반드시 토큰의 user_id로만 실행한다.

비밀번호를 무작정 맞혀 보는 것을 막기 위해 사용자별로 실패 횟수를 제한한다 (서버 프로세스 메모리 기준).
"""

import threading
import time
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow

from app.core.errors import FieldError

MAX_FAILURES = 5
LOCK_SECONDS = 10 * 60

_failures: dict[UUID, list[float]] = {}
_lock = threading.Lock()


class TooManyAttempts(Exception):
    pass


def _recent(user_id: UUID, now: float) -> list[float]:
    return [t for t in _failures.get(user_id, []) if now - t < LOCK_SECONDS]


def _record_failure(user_id: UUID) -> None:
    now = time.monotonic()
    with _lock:
        _failures[user_id] = [*_recent(user_id, now), now]


def delete_account(db: Connection[DictRow], user_id: UUID, email: str, password: str) -> None:
    with _lock:
        if len(_recent(user_id, time.monotonic())) >= MAX_FAILURES:
            raise TooManyAttempts

    row = db.execute(
        """
        select email,
               encrypted_password is not null
                 and encrypted_password = extensions.crypt(%(pw)s, encrypted_password) as password_ok
        from auth.users where id = %(u)s
        """,
        {"u": user_id, "pw": password},
    ).fetchone()
    if row is None:
        raise FieldError("email", "계정을 찾을 수 없어요. 다시 로그인해 주세요.")
    if (row["email"] or "").strip().lower() != email.strip().lower():
        _record_failure(user_id)
        raise FieldError("email", "로그인한 계정의 이메일과 달라요.")
    if not row["password_ok"]:
        _record_failure(user_id)
        raise FieldError("password", "비밀번호가 맞지 않아요.")

    db.execute("delete from auth.users where id = %s", (user_id,))
    with _lock:
        _failures.pop(user_id, None)
