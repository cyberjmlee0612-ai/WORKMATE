"""반복 업무 · 습관 테스트.

- 단위: 반복 규칙(매일·요일·격주·매월 말일·n일마다·시작일 전), 연속 기록, 입력 검증
- DB(RUN_DB_TESTS=1): 오늘 반복 업무 만들기(중복 없음·계획 블록), 지난 것 건너뜀, 습관 체크 규칙, 지우기, 격리
"""

import os
from datetime import date, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api import routines as api
from app.core.auth import CurrentUser, get_current_user
from app.core.errors import FieldError, register_error_handlers
from app.db import get_user_db
from app.repositories import projects as project_repo
from app.repositories import routines as repo
from app.repositories import tasks as task_repo
from app.schemas.project import ProjectCreate

db_only = pytest.mark.skipif(os.environ.get("RUN_DB_TESTS") != "1", reason="RUN_DB_TESTS=1 일 때만 실행")
TZ = "Asia/Seoul"
START = date(2026, 11, 1)  # 일요일


def _r(**kw):
    return {"freq": "daily", "weekdays": None, "every_weeks": 1, "month_day": None, "interval_days": None, "start_date": START, **kw}


def _user(uid: UUID) -> CurrentUser:
    return CurrentUser(id=uid, email=None, claims={})


# ---------------------------------------------------------------- 단위


def test_occurs_rules() -> None:
    assert repo.occurs(_r(), date(2026, 11, 5)) and not repo.occurs(_r(), date(2026, 10, 31))  # 시작일 전
    mon_wed = _r(freq="weekly", weekdays=(1 << 1) | (1 << 3))
    assert [d.day for d in (date(2026, 11, 2) + timedelta(days=i) for i in range(7)) if repo.occurs(mon_wed, d)] == [2, 4]
    biweekly = _r(freq="weekly", weekdays=1 << 1, every_weeks=2)  # 격주 월요일 (11/1이 속한 주부터)
    assert [d.day for d in (START + timedelta(days=i) for i in range(30)) if repo.occurs(biweekly, d)] == [2, 16, 30]
    monthly = _r(freq="monthly", month_day=31)
    assert repo.occurs(monthly, date(2027, 2, 28)) and repo.occurs(monthly, date(2026, 11, 30)) and not repo.occurs(monthly, date(2026, 11, 29))
    every3 = _r(freq="interval", interval_days=3)
    assert [d.day for d in (START + timedelta(days=i) for i in range(10)) if repo.occurs(every3, d)] == [1, 4, 7, 10]


def test_streak() -> None:
    daily = _r()
    today = date(2026, 11, 20)
    last3 = {today - timedelta(days=i) for i in (1, 2, 3)}
    assert repo.streak(daily, last3, today) == 3  # 오늘은 아직 → 어제까지
    assert repo.streak(daily, last3 | {today}, today) == 4
    assert repo.streak(daily, {today - timedelta(days=1), today - timedelta(days=3)}, today) == 1  # 끊김
    weekly = _r(freq="weekly", weekdays=1 << 1)  # 월요일만: 11/16, 11/9 체크 → 2 (11/20 금요일은 반복 날 아님)
    assert repo.streak(weekly, {date(2026, 11, 16), date(2026, 11, 9)}, today) == 2


def test_validation() -> None:
    app = FastAPI()
    register_error_handlers(app)
    app.include_router(api.router)
    app.dependency_overrides[get_current_user] = lambda: _user(UUID(int=1))
    app.dependency_overrides[get_user_db] = lambda: object()
    client = TestClient(app)
    base = {"title": "영어 단어", "freq": "daily", "start_date": "2026-11-27"}
    assert client.post("/routines", json={**base, "title": "  "}).status_code == 422
    assert client.post("/routines", json={**base, "freq": "weekly"}).status_code == 422  # 요일 없음
    assert client.post("/routines", json={**base, "freq": "weekly", "weekdays": [7]}).status_code == 422
    assert client.post("/routines", json={**base, "freq": "monthly"}).status_code == 422
    assert client.post("/routines", json={**base, "freq": "interval", "interval_days": 1}).status_code == 422
    assert client.post("/routines", json={**base, "start_time": "07:00"}).status_code == 422  # 끝 시각 없음
    assert client.post("/routines", json={**base, "start_time": "07:00", "end_time": "07:05"}).status_code == 422
    assert client.post("/routines", json={**base, "every_weeks": 9}).status_code == 422


# ---------------------------------------------------------------- DB


@db_only
def test_materialize_and_skip(db) -> None:
    conn, a, b, as_user = db
    ua = _user(a)
    today = datetime.now(ZoneInfo(TZ)).date()
    with as_user(a):
        proj = project_repo.create_project(conn, a, ProjectCreate(name="영어"))
        daily = api.create_routine(api.RoutineIn(title="단어 30개", project_id=proj["id"], estimated_minutes=30, freq="daily",
                                                 start_date=today - timedelta(days=3), start_time="07:00", end_time="07:30"), ua, conn, tz=TZ)
        not_today = (today.weekday() + 2) % 7  # 오늘(일=0 기준)이 아닌 요일
        api.create_routine(api.RoutineIn(title="다른 요일", freq="weekly", weekdays=[not_today], start_date=today), ua, conn, tz=TZ)
        api.create_routine(api.RoutineIn(title="물 2L", mode="habit", freq="daily", start_date=today), ua, conn, tz=TZ)
        # 어제 하지 않은 반복 업무
        conn.execute(
            "insert into public.tasks (user_id, title, due_date, routine_id, routine_date) values (%s, '어제 단어', %s, %s, %s)",
            (a, today - timedelta(days=1), daily["id"], today - timedelta(days=1)),
        )

        out = api.post_materialize(api.MaterializeIn(tz=TZ), ua, conn)
        assert out == {"created": 1, "skipped": 1}
        assert api.post_materialize(api.MaterializeIn(tz=TZ), ua, conn) == {"created": 0, "skipped": 0}  # 다시 불러도 같음

        tasks = {t["title"]: t for t in task_repo.list_tasks(conn, a, status=None)}
        made = tasks["단어 30개"]
        assert (made["due_date"], made["estimated_minutes"], made["project_id"], made["routine_id"]) == (today, 30, proj["id"], daily["id"])
        assert made["planned_minutes"] == 30
        plan = conn.execute("select starts_at from public.task_time_plans where task_id = %s", (made["id"],)).fetchone()
        assert plan["starts_at"].astimezone(ZoneInfo(TZ)).strftime("%H:%M") == "07:00"
        skipped = task_repo.list_tasks(conn, a, status="cancelled")
        assert [(t["title"], t["cancel_reason"]) for t in skipped] == [("어제 단어", repo.SKIP_REASON)]
        assert "다른 요일" not in tasks and "물 2L" not in tasks  # 오늘 아닌 반복·습관은 업무를 만들지 않는다

        # 반복을 지워도 만든 업무는 남는다
        api.delete_routine(daily["id"], ua, conn)
        assert task_repo.get_task(conn, a, made["id"])["routine_id"] is None

    with as_user(b):
        assert api.post_materialize(api.MaterializeIn(tz=TZ), _user(b), conn) == {"created": 0, "skipped": 0}
        assert api.get_routines(_user(b), conn, tz=TZ) == []
        with pytest.raises(FieldError):  # 남의 프로젝트
            api.create_routine(api.RoutineIn(title="x", freq="daily", start_date=today, project_id=proj["id"]), _user(b), conn, tz=TZ)


@db_only
def test_habit_checks(db) -> None:
    conn, a, b, as_user = db
    ua = _user(a)
    today = datetime.now(ZoneInfo(TZ)).date()
    with as_user(a):
        habit = api.create_routine(api.RoutineIn(title="스트레칭", mode="habit", freq="daily", start_date=today - timedelta(days=10)), ua, conn, tz=TZ)
        for i in (1, 2):
            api.check_habit(habit["id"], api.CheckIn(date=today - timedelta(days=i), checked=True, tz=TZ), ua, conn)
        out = api.check_habit(habit["id"], api.CheckIn(date=today, checked=True, tz=TZ), ua, conn)
        assert (out["checked_today"], out["streak"]) == (True, 3)
        assert [d["checked"] for d in out["recent"]][-3:] == [True, True, True] and len(out["recent"]) == 7
        out = api.check_habit(habit["id"], api.CheckIn(date=today, checked=False, tz=TZ), ua, conn)
        assert (out["checked_today"], out["streak"]) == (False, 2)

        with pytest.raises(FieldError):  # 미래
            api.check_habit(habit["id"], api.CheckIn(date=today + timedelta(days=1), checked=True, tz=TZ), ua, conn)
        with pytest.raises(FieldError):  # 7일 넘게 지난 날
            api.check_habit(habit["id"], api.CheckIn(date=today - timedelta(days=8), checked=True, tz=TZ), ua, conn)
        task_mode = api.create_routine(api.RoutineIn(title="보고서", freq="daily", start_date=today), ua, conn, tz=TZ)
        with pytest.raises(FieldError):  # 반복 업무는 업무에서 체크
            api.check_habit(task_mode["id"], api.CheckIn(date=today, checked=True, tz=TZ), ua, conn)
        mondays = api.create_routine(api.RoutineIn(title="월요 운동", mode="habit", freq="weekly", weekdays=[1], start_date=today - timedelta(days=14)), ua, conn, tz=TZ)
        not_monday = today if today.weekday() != 0 else today - timedelta(days=1)
        with pytest.raises(FieldError):  # 반복 날이 아님
            api.check_habit(mondays["id"], api.CheckIn(date=not_monday, checked=True, tz=TZ), ua, conn)

        api.delete_routine(habit["id"], ua, conn)
        assert conn.execute("select count(*) as n from public.habit_checks where routine_id = %s", (habit["id"],)).fetchone()["n"] == 0
    with as_user(b):
        with pytest.raises(HTTPException):
            api.check_habit(task_mode["id"], api.CheckIn(date=today, checked=True, tz=TZ), _user(b), conn)
