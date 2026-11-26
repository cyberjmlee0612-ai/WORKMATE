"""아침 체크인 / 저녁 마무리 테스트.

- 단위: 빈칸 계산, 자동 배치(예상 시간·여유·못 넣는 경우·지금 이후)
- DB(RUN_DB_TESTS=1): 꼭 할 일 저장·검증, 추천 순서, 마무리(내일 다시/마감일 미루기/완료 자동 기록), 시간표 빈칸 배치, 격리
"""

import os
from datetime import date, datetime, time, timedelta
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import checkins as api
from app.api import schedule as schedule_api
from app.core.auth import CurrentUser, get_current_user
from app.core.errors import FieldError, register_error_handlers
from app.db import get_user_db
from app.repositories import tasks as task_repo
from app.schemas.task import TaskCreate, TaskUpdate

db_only = pytest.mark.skipif(os.environ.get("RUN_DB_TESTS") != "1", reason="RUN_DB_TESTS=1 일 때만 실행")
SEOUL = ZoneInfo("Asia/Seoul")
DAY = date(2030, 3, 6)  # 미래 수요일 (지금 시각 제한 없음)


def _user(uid: UUID) -> CurrentUser:
    return CurrentUser(id=uid, email=None, claims={})


def _task(**kw):
    return {"title": "업무", "estimated_minutes": None, "tracked_minutes": 0, **kw}


# ---------------------------------------------------------------- 단위


def test_free_gaps() -> None:
    windows = [(540, 1080)]
    taken = [(720, 780), (600, 630)]
    assert api._free_gaps(windows, taken, 0) == [(540, 600), (630, 720), (780, 1080)]
    assert api._free_gaps(windows, taken, 700) == [(700, 720), (780, 1080)]
    assert api._free_gaps([(540, 600), (1140, 1260)], [], 0) == [(540, 600), (1140, 1260)]


def test_place_rules() -> None:
    tasks = [
        _task(title="A", estimated_minutes=90),                       # 90분 → 09:00–10:30
        _task(title="B"),                                              # 예상 없음 → 60분, 여유 10분 뒤 → 10:40–11:40
        _task(title="C", estimated_minutes=120, tracked_minutes=110),  # 남은 10분 → 최소 30분, 11:50 빈칸(10분)엔 안 들어가 13:00
        _task(title="D", estimated_minutes=500),                       # 최대 180분 → 남은 빈칸 13:40–18:00에
        _task(title="E", estimated_minutes=200),                       # 180분 들어갈 빈칸 없음
    ]
    placed, unplaced = api.place(tasks, [(540, 1080)], [(720, 780)], 0)
    assert [(t["title"], a, b) for t, a, b in placed] == [("A", 540, 630), ("B", 640, 700), ("C", 780, 810), ("D", 820, 1000)]
    assert [t["title"] for t in unplaced] == ["E"]
    placed, _ = api.place([_task(title="A")], [(540, 1080)], [], 905)  # 지금 15:05 → 15:05부터
    assert placed[0][1] == 905


def test_request_validation() -> None:
    app = FastAPI()
    register_error_handlers(app)
    app.include_router(api.router)
    app.dependency_overrides[get_current_user] = lambda: _user(UUID(int=1))
    app.dependency_overrides[get_user_db] = lambda: object()
    client = TestClient(app)
    ids = [str(uuid4()) for _ in range(4)]
    assert client.put("/checkins/2030-03-06/focus", json={"task_ids": ids}).status_code == 422  # 4개
    assert client.put("/checkins/2030-03-06/focus", json={"task_ids": [ids[0], ids[0]]}).status_code == 422  # 중복
    assert client.post("/checkins/2030-03-06/review", json={"mood": 6}).status_code == 422
    assert client.post("/checkins/2030-03-06/review", json={"note": "가" * 501}).status_code == 422
    assert client.post("/checkins/2030-03-06/review", json={"outcomes": [{"task_id": ids[0], "outcome": "done"}]}).status_code == 422


# ---------------------------------------------------------------- DB


@db_only
def test_focus_suggestions_and_review(db) -> None:
    conn, a, b, as_user = db
    ua = _user(a)
    with as_user(a):
        mk = lambda **kw: task_repo.create_task(conn, a, TaskCreate(**kw))  # noqa: E731
        retry = mk(title="어제 못 한 일")
        overdue = mk(title="지난 마감", due_date=DAY - timedelta(days=2))
        today = mk(title="오늘 마감", due_date=DAY)
        soon = mk(title="곧 마감", due_date=DAY + timedelta(days=2))
        high = mk(title="중요", priority="high")
        doing = mk(title="하는 중", status="in_progress")
        mk(title="끝난 일", status="completed", due_date=DAY)
        cancelled = mk(title="뺀 일", due_date=DAY)
        task_repo.update_task(conn, a, cancelled["id"], TaskUpdate(status="cancelled"))

        # 어제 '다시 하기'로 한 일
        yesterday = DAY - timedelta(days=1)
        api.put_focus(yesterday, api.FocusIn(task_ids=[retry["id"]]), ua, conn)
        api.post_review(yesterday, api.ReviewIn(outcomes=[api.OutcomeIn(task_id=retry["id"], outcome="retry")]), ua, conn)

        out = api.get_checkin(DAY, ua, conn)
        assert [(s["task"]["title"], s["reason"]) for s in out["suggestions"][:6]] == [
            ("어제 못 한 일", "지난번에 '다시 하기'로 한 일"), ("지난 마감", "마감이 지났어요"), ("오늘 마감", "오늘 마감"),
            ("곧 마감", "마감 D-2"), ("중요", "우선순위 높음"), ("하는 중", "진행 중"),
        ]
        assert all(s["task"]["title"] not in ("끝난 일", "뺀 일") for s in out["suggestions"])

        with pytest.raises(FieldError):
            api.put_focus(DAY, api.FocusIn(task_ids=[cancelled["id"]]), ua, conn)
        out = api.put_focus(DAY, api.FocusIn(task_ids=[today["id"], overdue["id"], soon["id"]]), ua, conn)
        assert [f["task"]["title"] for f in out["focus"]] == ["오늘 마감", "지난 마감", "곧 마감"]
        assert today["id"] not in {s["task"]["id"] for s in out["suggestions"]}

        # 저녁: 하나는 완료, 하나는 마감일 미루기, 하나는 내일 다시
        task_repo.update_task(conn, a, today["id"], TaskUpdate(status="completed"))
        with pytest.raises(FieldError):  # 오늘 이전으로는 미룰 수 없다
            api.post_review(DAY, api.ReviewIn(outcomes=[api.OutcomeIn(task_id=overdue["id"], outcome="postponed", due_date=DAY)]), ua, conn)
        with pytest.raises(FieldError):  # 고르지 않은 업무
            api.post_review(DAY, api.ReviewIn(outcomes=[api.OutcomeIn(task_id=high["id"], outcome="kept")]), ua, conn)
        out = api.post_review(DAY, api.ReviewIn(mood=4, note="  집중 잘 됨 ", outcomes=[
            api.OutcomeIn(task_id=overdue["id"], outcome="postponed", due_date=DAY + timedelta(days=3)),
            api.OutcomeIn(task_id=soon["id"], outcome="retry"),
        ]), ua, conn)
        assert [(f["task"]["title"], f["outcome"]) for f in out["focus"]] == [("오늘 마감", "done"), ("지난 마감", "postponed"), ("곧 마감", "retry")]
        assert out["review"] == {"mood": 4, "note": "집중 잘 됨"}
        assert task_repo.get_task(conn, a, overdue["id"])["due_date"] == DAY + timedelta(days=3)

        # 다시 고르면 저녁 결과는 남는다
        out = api.put_focus(DAY, api.FocusIn(task_ids=[soon["id"], doing["id"]]), ua, conn)
        assert [(f["task"]["title"], f["outcome"]) for f in out["focus"]] == [("곧 마감", "retry"), ("하는 중", None)]
        # 다음 날 추천 맨 위에 '다시 하기'
        assert api.get_checkin(DAY + timedelta(days=1), ua, conn)["suggestions"][0]["task"]["title"] == "곧 마감"

        task_repo.delete_task(conn, a, doing["id"])  # 업무를 지우면 꼭 할 일에서도 빠진다
        assert [f["task"]["title"] for f in api.get_checkin(DAY, ua, conn)["focus"]] == ["곧 마감"]

    with as_user(b):
        other = api.get_checkin(DAY, _user(b), conn)
        assert other["focus"] == [] and other["review"] is None and other["suggestions"] == []
        with pytest.raises(FieldError):  # 남의 업무는 고를 수 없다
            api.put_focus(DAY, api.FocusIn(task_ids=[soon["id"]]), _user(b), conn)


@db_only
def test_placement_uses_schedule_and_avoids_busy(db) -> None:
    conn, a, _, as_user = db
    ua = _user(a)
    with as_user(a):
        schedule_api.replace_blocks(schedule_api.BlocksReplace(blocks=[
            schedule_api.BlockIn(title="자습", kind="work", weekdays=[3], start="16:00", end="20:00"),
            schedule_api.BlockIn(title="저녁", kind="break", weekdays=[3], start="18:00", end="19:00"),
        ]), ua, conn)
        first = task_repo.create_task(conn, a, TaskCreate(title="과제", estimated_minutes=60))
        second = task_repo.create_task(conn, a, TaskCreate(title="복습", estimated_minutes=50))
        planned = task_repo.create_task(conn, a, TaskCreate(title="이미 계획"))
        done = task_repo.create_task(conn, a, TaskCreate(title="끝남"))
        task_repo.update_task(conn, a, done["id"], TaskUpdate(status="completed"))
        start = datetime.combine(DAY, time(16), tzinfo=SEOUL)
        conn.execute(
            "insert into public.task_time_plans (user_id, task_id, starts_at, ends_at) values (%s, %s, %s, %s)",
            (a, planned["id"], start, start + timedelta(minutes=30)),
        )
        api.put_focus(DAY, api.FocusIn(task_ids=[first["id"], planned["id"], second["id"]]), ua, conn)
        out = api.get_placement(DAY, ua, conn, tz="Asia/Seoul")
    to_local = lambda d: d.astimezone(SEOUL).strftime("%H:%M")  # noqa: E731
    # 16:00–16:30 기존 계획 → 과제 16:30–17:30, 여유 10분, 복습 50분은 17:40–18:30이 저녁과 겹쳐 19:00–19:50
    assert [(x["task_title"], to_local(x["starts_at"]), to_local(x["ends_at"])) for x in out["blocks"]] == [
        ("과제", "16:30", "17:30"), ("복습", "19:00", "19:50"),
    ]
    assert out["unplaced"] == []
