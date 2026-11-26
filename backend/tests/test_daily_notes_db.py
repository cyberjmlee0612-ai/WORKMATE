"""날짜별 메모: 실제 DB에서 저장·덮어쓰기·삭제·사용자 격리 확인 (트랜잭션 안에서 실행 후 롤백).

실행: RUN_DB_TESTS=1 pytest tests/test_daily_notes_db.py
"""

import os
from datetime import date

import pytest
from pydantic import ValidationError

from app.api.daily_notes import DailyNoteSave, get_note, save_note
from app.core.auth import CurrentUser

pytestmark = pytest.mark.skipif(os.environ.get("RUN_DB_TESTS") != "1", reason="RUN_DB_TESTS=1 일 때만 실행")

DAY = date(2026, 11, 27)


def _user(uid) -> CurrentUser:
    return CurrentUser(id=uid, email=None, claims={})


def test_save_overwrite_and_clear(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        assert get_note(DAY, _user(a), conn)["content"] == ""
        saved = save_note(DAY, DailyNoteSave(content="회의 준비\n- 자료"), _user(a), conn)
        assert saved["content"] == "회의 준비\n- 자료" and saved["updated_at"] is not None
        assert save_note(DAY, DailyNoteSave(content="수정"), _user(a), conn)["content"] == "수정"
        cleared = save_note(DAY, DailyNoteSave(content="  \n "), _user(a), conn)
        assert cleared == {"note_date": DAY, "content": "", "updated_at": None}


def test_isolation_between_users(db) -> None:
    conn, a, b, as_user = db
    with as_user(a):
        save_note(DAY, DailyNoteSave(content="A의 메모"), _user(a), conn)
    with as_user(b):
        assert get_note(DAY, _user(b), conn)["content"] == ""
        save_note(DAY, DailyNoteSave(content="B의 메모"), _user(b), conn)
    with as_user(a):
        assert get_note(DAY, _user(a), conn)["content"] == "A의 메모"


def test_length_limit() -> None:
    with pytest.raises(ValidationError):
        DailyNoteSave(content="가" * 5001)
