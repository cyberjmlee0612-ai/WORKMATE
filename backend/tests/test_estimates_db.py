"""예상 시간 자동 보정 테스트.

- 단위: 보정값 계산(근거 부족·차이 작음·짧은 일/긴 일·5분 단위), 자동 배치에 보정 적용
- DB(RUN_DB_TESTS=1): 최근 60일·완료·기록 있는 업무만, 구간별 5개 이상, 0.5~3배 제한, 사용자 격리
"""

import itertools
import os
from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest

from app.api import checkins
from app.repositories import estimates as repo
from app.repositories import tasks as task_repo
from app.schemas.task import TaskCreate

db_only = pytest.mark.skipif(os.environ.get("RUN_DB_TESTS") != "1", reason="RUN_DB_TESTS=1 일 때만 실행")


def _cal(short=None, long=None):
    return {"short": {"ratio": short, "samples": 5}, "long": {"ratio": long, "samples": 5}}


def test_adjust_rules() -> None:
    assert repo.adjust(30, _cal()) is None  # 근거 부족
    assert repo.adjust(None, _cal(short=1.5)) is None
    assert repo.adjust(30, _cal(short=1.05)) is None  # 차이 작음
    assert repo.adjust(40, _cal(short=1.5)) == 60
    assert repo.adjust(90, _cal(short=1.5, long=2.0)) == 180  # 60분 이상은 긴 일 비율
    assert repo.adjust(33, _cal(short=1.3)) == 45  # 42.9 → 5분 단위
    assert repo.adjust(10, _cal(short=0.5)) == 5


def test_place_uses_calibration() -> None:
    task = {"title": "A", "estimated_minutes": 60, "tracked_minutes": 0}
    placed, _ = checkins.place([task], [(540, 1080)], [], 0, _cal(long=1.5))
    assert (placed[0][1], placed[0][2]) == (540, 630)  # 60분 → 보정 90분
    placed, _ = checkins.place([task], [(540, 1080)], [], 0, None)
    assert placed[0][2] == 600


_slot = itertools.count()


def _done(conn, user: UUID, est: int, tracked: int | None, days_ago: int = 1) -> None:
    task = task_repo.create_task(conn, user, TaskCreate(title=f"업무 {est}", estimated_minutes=est))
    # 기록끼리 겹치지 않게 업무마다 16시간씩 떨어뜨린다
    done_at = datetime.now(timezone.utc) - timedelta(days=days_ago, hours=16 * next(_slot))
    conn.execute("update public.tasks set status = 'completed', completed_at = %s where id = %s", (done_at, task["id"]))
    if tracked:
        conn.execute(
            "insert into public.task_time_entries (user_id, task_id, started_at, ended_at, source) values (%s, %s, %s, %s, 'manual')",
            (user, task["id"], done_at - timedelta(minutes=tracked), done_at),
        )


@db_only
def test_calibration_from_history(db) -> None:
    conn, a, b, as_user = db
    with as_user(a):
        for _ in range(5):
            _done(conn, a, 30, 45)  # 짧은 일 1.5배
        for _ in range(4):
            _done(conn, a, 120, 240)  # 긴 일은 4개뿐 → 비율 없음
        _done(conn, a, 30, None)  # 기록 없음 → 제외
        _done(conn, a, 30, 300, days_ago=75)  # 60일 넘음 → 제외
        cal = repo.calibration(conn, a)
    assert cal["short"] == {"ratio": 1.5, "samples": 5}
    assert cal["long"] == {"ratio": None, "samples": 4}
    assert cal["overall"]["samples"] == 9 and cal["overall"]["ratio"] == round((5 * 45 + 4 * 240) / (5 * 30 + 4 * 120), 2)

    with as_user(a):
        _done(conn, a, 120, 900)  # 긴 일 5개째, 합계가 크게 늘어 3배로 제한된다
        assert repo.calibration(conn, a)["long"]["ratio"] == 3.0
    with as_user(b):
        assert repo.calibration(conn, b)["overall"] == {"ratio": None, "samples": 0}
