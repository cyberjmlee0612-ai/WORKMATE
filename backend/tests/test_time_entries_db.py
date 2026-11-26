"""실제 Supabase DB에서 타이머·시간 기록 규칙을 확인하는 통합 테스트.

db fixture는 tests/conftest.py (트랜잭션 안에서 실행 후 롤백). 트랜잭션 안에서는 now()가 고정이므로
'오래 켜 둔 타이머'는 started_at을 과거로 직접 넣어 만든다.
실행: RUN_DB_TESTS=1 pytest tests/test_time_entries_db.py
"""

import os
from datetime import timedelta

import pytest

from app.core.errors import ConflictError, FieldError
from app.repositories import project_deletion as deletion_repo
from app.repositories import projects as project_repo
from app.repositories import tasks as task_repo
from app.repositories import time_entries as repo
from app.schemas.project import ProjectCreate
from app.schemas.project_deletion import ProjectDeleteRequest
from app.schemas.task import TaskCreate, TaskUpdate
from app.schemas.time_entry import TimeEntryCreate, TimeEntryUpdate

pytestmark = pytest.mark.skipif(os.environ.get("RUN_DB_TESTS") != "1", reason="RUN_DB_TESTS=1 일 때만 실행")


def _task(conn, user, title="업무", **kw):
    return task_repo.create_task(conn, user, TaskCreate(title=title, **kw))


def _running_since(conn, user, task_id, ago: timedelta):
    """과거에 시작한 타이머를 직접 만든다."""
    conn.execute(
        "insert into public.task_time_entries (user_id, task_id, started_at, source) values (%s, %s, now() - %s, 'timer')",
        (user, task_id, ago),
    )


def test_manual_entry_and_tracked_minutes(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        task = _task(conn, a)
        t0 = repo.now(conn) - timedelta(hours=5)
        repo.create_entry(conn, a, TimeEntryCreate(task_id=task["id"], started_at=t0, ended_at=t0 + timedelta(minutes=90), note=" 메모 "))
        repo.create_entry(conn, a, TimeEntryCreate(task_id=task["id"], started_at=t0 + timedelta(hours=2), ended_at=t0 + timedelta(hours=2, minutes=30)))
        assert task_repo.get_task(conn, a, task["id"])["tracked_minutes"] == 120
        entries = repo.list_entries(conn, a, task_id=task["id"])
        assert [e["source"] for e in entries] == ["manual", "manual"]
        assert entries[1]["note"] == "메모" and entries[0]["task_title"] == "업무"


def test_overlap_rejected_with_conflict_and_adjacent_allowed(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        task = _task(conn, a)
        t0 = repo.now(conn) - timedelta(hours=5)
        first = repo.create_entry(conn, a, TimeEntryCreate(task_id=task["id"], started_at=t0, ended_at=t0 + timedelta(hours=1)))
        with pytest.raises(ConflictError) as exc:
            repo.create_entry(conn, a, TimeEntryCreate(task_id=task["id"], started_at=t0 + timedelta(minutes=30), ended_at=t0 + timedelta(hours=2)))
        assert exc.value.code == "overlap" and exc.value.extra["conflict"]["id"] == first["id"]
        # 10:00에 끝난 기록 뒤 10:00 시작은 허용
        repo.create_entry(conn, a, TimeEntryCreate(task_id=task["id"], started_at=t0 + timedelta(hours=1), ended_at=t0 + timedelta(hours=2)))


def test_range_rules(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        task = _task(conn, a)
        now = repo.now(conn)
        cases = [
            (now - timedelta(minutes=10), now + timedelta(minutes=5), "ended_at"),  # 미래
            (now - timedelta(minutes=10), now - timedelta(minutes=9, seconds=30), "ended_at"),  # 1분 미만
            (now - timedelta(hours=30), now - timedelta(hours=5), "ended_at"),  # 24시간 초과
            (now - timedelta(minutes=10), now - timedelta(minutes=20), "ended_at"),  # 순서
        ]
        for start, end, field in cases:
            with pytest.raises(FieldError) as exc:
                repo.create_entry(conn, a, TimeEntryCreate(task_id=task["id"], started_at=start, ended_at=end))
            assert exc.value.field == field


def test_timer_start_switch_and_stop(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        first, second = _task(conn, a, "첫째"), _task(conn, a, "둘째")
        _running_since(conn, a, first["id"], timedelta(minutes=40))

        # 같은 업무에서 다시 시작하면 그대로
        same = repo.start_timer(conn, a, first["id"])
        assert same["stopped"] is None and same["running"]["task_id"] == first["id"]

        # 다른 업무에서 시작하면 기존 타이머를 지금 멈추고 새로 시작 (한 번에 하나)
        switched = repo.start_timer(conn, a, second["id"])
        assert switched["stopped"]["task_id"] == first["id"] and switched["discarded"] is False
        assert switched["stopped"]["ended_at"] == switched["running"]["started_at"]
        assert repo.get_running(conn, a)["task_id"] == second["id"]
        assert task_repo.get_task(conn, a, first["id"])["tracked_minutes"] == 40

        # 방금 시작한 타이머를 바로 멈추면 1분 미만이라 기록하지 않는다
        stopped = repo.stop_timer(conn, a)
        assert stopped == {"entry": None, "discarded": True}
        assert repo.get_running(conn, a) is None
        with pytest.raises(ConflictError) as exc:
            repo.stop_timer(conn, a)
        assert exc.value.code == "no_running_timer"


def test_long_timer_needs_end_time(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        task, other = _task(conn, a), _task(conn, a, "다른")
        _running_since(conn, a, task["id"], timedelta(hours=13))
        for action in (lambda: repo.stop_timer(conn, a), lambda: repo.start_timer(conn, a, other["id"])):
            with pytest.raises(ConflictError) as exc:
                action()
            assert exc.value.code == "timer_needs_review"
        # 업무 완료도 막는다 (먼저 끝난 시각을 확인해야 함)
        with pytest.raises(ConflictError):
            task_repo.update_task(conn, a, task["id"], TaskUpdate(status="completed"))

        started = repo.get_running(conn, a)["started_at"]
        result = repo.stop_timer(conn, a, ended_at=started + timedelta(hours=3))
        assert result["discarded"] is False and result["entry"]["ended_at"] == started + timedelta(hours=3)


def test_completing_task_stops_its_timer(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        task = _task(conn, a)
        _running_since(conn, a, task["id"], timedelta(minutes=25))
        task_repo.update_task(conn, a, task["id"], TaskUpdate(status="completed"))
        assert repo.get_running(conn, a) is None
        assert task_repo.get_task(conn, a, task["id"])["tracked_minutes"] == 25
        with pytest.raises(ConflictError) as exc:
            repo.start_timer(conn, a, task["id"])
        assert exc.value.code == "task_closed"


def test_running_timer_blocks_overlapping_manual_entry_and_edit_rules(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        task = _task(conn, a)
        _running_since(conn, a, task["id"], timedelta(hours=1))
        running = repo.get_running(conn, a)
        now = repo.now(conn)
        with pytest.raises(ConflictError):
            repo.create_entry(conn, a, TimeEntryCreate(task_id=task["id"], started_at=now - timedelta(minutes=30), ended_at=now - timedelta(minutes=10)))
        with pytest.raises(FieldError) as exc:
            repo.update_entry(conn, a, running["id"], TimeEntryUpdate(ended_at=now))
        assert exc.value.field == "ended_at"
        # 진행 중 타이머의 시작 시각은 고칠 수 있다 ("깜빡하고 늦게 켰을 때")
        fixed = repo.update_entry(conn, a, running["id"], TimeEntryUpdate(started_at=now - timedelta(hours=2), note="늦게 켬"))
        assert fixed["started_at"] == now - timedelta(hours=2) and fixed["note"] == "늦게 켬"


def test_update_checks_overlap_excluding_itself(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        task = _task(conn, a)
        t0 = repo.now(conn) - timedelta(hours=6)
        first = repo.create_entry(conn, a, TimeEntryCreate(task_id=task["id"], started_at=t0, ended_at=t0 + timedelta(hours=1)))
        repo.create_entry(conn, a, TimeEntryCreate(task_id=task["id"], started_at=t0 + timedelta(hours=2), ended_at=t0 + timedelta(hours=3)))
        # 자기 자신과는 겹침으로 보지 않는다
        moved = repo.update_entry(conn, a, first["id"], TimeEntryUpdate(started_at=t0 + timedelta(minutes=10)))
        assert moved["started_at"] == t0 + timedelta(minutes=10)
        with pytest.raises(ConflictError):
            repo.update_entry(conn, a, first["id"], TimeEntryUpdate(ended_at=t0 + timedelta(hours=2, minutes=30)))


def test_range_listing_for_timetable(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        task = _task(conn, a)
        t0 = repo.now(conn) - timedelta(hours=10)
        repo.create_entry(conn, a, TimeEntryCreate(task_id=task["id"], started_at=t0, ended_at=t0 + timedelta(hours=2)))
        repo.create_entry(conn, a, TimeEntryCreate(task_id=task["id"], started_at=t0 + timedelta(hours=5), ended_at=t0 + timedelta(hours=6)))
        # 구간에 걸쳐 있는 기록도 포함
        hits = repo.list_entries(conn, a, start=t0 + timedelta(hours=1), end=t0 + timedelta(hours=3))
        assert len(hits) == 1 and hits[0]["started_at"] == t0


def test_isolation_between_users(db) -> None:
    conn, a, b, as_user = db
    with as_user(a):
        task = _task(conn, a)
        t0 = repo.now(conn) - timedelta(hours=3)
        entry = repo.create_entry(conn, a, TimeEntryCreate(task_id=task["id"], started_at=t0, ended_at=t0 + timedelta(hours=1)))
    with as_user(b):
        assert repo.list_entries(conn, b) == []
        assert repo.update_entry(conn, b, entry["id"], TimeEntryUpdate(note="x")) is None
        assert repo.delete_entry(conn, b, entry["id"]) is False
        assert repo.start_timer(conn, b, task["id"]) is None
        with pytest.raises(FieldError):
            repo.create_entry(conn, b, TimeEntryCreate(task_id=task["id"], started_at=t0, ended_at=t0 + timedelta(hours=1)))
        # 다른 사용자의 같은 시간대 기록은 겹침이 아니다
        own = _task(conn, b)
        repo.create_entry(conn, b, TimeEntryCreate(task_id=own["id"], started_at=t0, ended_at=t0 + timedelta(hours=1)))


def test_project_deletion_moves_or_deletes_entries(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        project = project_repo.create_project(conn, a, ProjectCreate(name="P"))
        keep = _task(conn, a, "남길 업무", project_id=project["id"])
        drop = _task(conn, a, "지울 업무", project_id=project["id"])
        t0 = repo.now(conn) - timedelta(hours=4)
        repo.create_entry(conn, a, TimeEntryCreate(task_id=keep["id"], started_at=t0, ended_at=t0 + timedelta(hours=1)))
        repo.create_entry(conn, a, TimeEntryCreate(task_id=drop["id"], started_at=t0 + timedelta(hours=1), ended_at=t0 + timedelta(hours=2)))
        deletion_repo.delete_project(
            conn, a, project["id"],
            ProjectDeleteRequest(mode="move", expected_task_ids=[keep["id"], drop["id"]], keep_task_ids=[keep["id"]]),
        )
        entries = repo.list_entries(conn, a)
        assert [e["task_id"] for e in entries] == [keep["id"]]
        assert entries[0]["project_id"] is None  # 개인 업무로 옮겨져도 기록은 유지
