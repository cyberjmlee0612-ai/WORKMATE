"""요일별 반복 시간 블록·이벤트·대시보드 브리핑 데이터 테스트.

- 단위: 블록 입력 검증, 요일 비트 변환, 이벤트 입력 검증
- DB(RUN_DB_TESTS=1): 블록 전체 바꾸기·요일별 조회·RLS, 이벤트 CRUD·기간·프로젝트 거르기·프로젝트 삭제 시 개인 이벤트로,
  대시보드의 다가오는 이벤트·오늘 계획 시간·오늘 블록, 계정 삭제 시 함께 삭제
"""

import os
from datetime import date, datetime, time, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

import psycopg
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api import events as events_api
from app.api import schedule as schedule_api
from app.core.auth import CurrentUser, get_current_user
from app.core.errors import FieldError, register_error_handlers
from app.db import get_user_db
from app.repositories import account
from app.repositories import dashboard as dashboard_repo
from app.repositories import projects as project_repo

db_only = pytest.mark.skipif(os.environ.get("RUN_DB_TESTS") != "1", reason="RUN_DB_TESTS=1 일 때만 실행")
SEOUL = ZoneInfo("Asia/Seoul")

def _user(uid: UUID) -> CurrentUser:
    return CurrentUser(id=uid, email=None, claims={})

def _block(**kw):
    return {"title": "학교 수업", "kind": "fixed", "weekdays": [1, 2, 3, 4, 5], "start": "09:00", "end": "15:00", **kw}

@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    register_error_handlers(app)
    app.include_router(schedule_api.router)
    app.include_router(events_api.router)
    app.dependency_overrides[get_current_user] = lambda: _user(UUID(int=1))
    app.dependency_overrides[get_user_db] = lambda: object()
    return TestClient(app)

# ---------------------------------------------------------------- 단위

def test_block_validation(client: TestClient) -> None:
    ok = schedule_api.BlockIn(**_block(title="  수학   학원 ", weekdays=[3, 1, 1], end="24:00"))
    assert (ok.title, ok.weekdays, ok.end) == ("수학 학원", [1, 3], "24:00")
    put = lambda b: client.put("/schedule-blocks", json={"blocks": [b]})  # noqa: E731
    assert put(_block(title="  ")).status_code == 422
    assert put(_block(weekdays=[])).status_code == 422
    assert put(_block(weekdays=[7])).status_code == 422
    assert put(_block(kind="meeting")).status_code == 422
    assert put(_block(start="09:00", end="09:05")).status_code == 422  # 10분 미만
    assert put(_block(start="24:00", end="24:00")).status_code == 422
    assert put(_block(start="9:00")).status_code == 422
    assert client.put("/schedule-blocks", json={"blocks": [_block()] * 51}).status_code == 422

def test_weekday_mask_roundtrip() -> None:
    assert schedule_api.weekdays_to_mask([0, 6]) == 65
    assert schedule_api.mask_to_weekdays(127) == list(range(7))
    assert schedule_api.mask_to_weekdays(schedule_api.weekdays_to_mask([1, 3, 5])) == [1, 3, 5]

def test_event_validation(client: TestClient) -> None:
    ev = events_api.EventCreate(title="  정보처리기사   실기 ", event_date=date(2026, 12, 5), note="  ")
    assert (ev.title, ev.kind, ev.note) == ("정보처리기사 실기", "other", None)
    assert client.post("/events", json={"title": " ", "event_date": "2026-12-05"}).status_code == 422
    assert client.post("/events", json={"title": "a", "event_date": "2026-12-05", "kind": "party"}).status_code == 422
    assert client.post("/events", json={"title": "a" * 101, "event_date": "2026-12-05"}).status_code == 422

# ---------------------------------------------------------------- DB

@db_only
def test_blocks_replace_and_weekday(db) -> None:
    conn, a, b, as_user = db
    body = schedule_api.BlocksReplace(blocks=[
        schedule_api.BlockIn(**_block(title="자습", kind="work", weekdays=[1, 2, 3, 4, 5], start="16:00", end="18:00")),
        schedule_api.BlockIn(**_block()),
        schedule_api.BlockIn(**_block(title="점심", kind="break", weekdays=list(range(7)), start="12:00", end="13:00")),
        schedule_api.BlockIn(**_block(title="야간", kind="work", weekdays=[0], start="22:00", end="24:00")),
    ])
    with as_user(a):
        out = schedule_api.replace_blocks(body, _user(a), conn)
        assert [(x["title"], x["start"], x["end"]) for x in out] == [
            ("학교 수업", "09:00", "15:00"), ("점심", "12:00", "13:00"), ("자습", "16:00", "18:00"), ("야간", "22:00", "24:00"),
        ]
        assert [x["title"] for x in schedule_api.blocks_for_weekday(conn, a, 0)] == ["점심", "야간"]  # 일요일
        assert [x["title"] for x in schedule_api.blocks_for_weekday(conn, a, 3)] == ["학교 수업", "점심", "자습"]
        assert schedule_api.replace_blocks(schedule_api.BlocksReplace(blocks=out[:0]), _user(a), conn) == []
        schedule_api.replace_blocks(body, _user(a), conn)
    with as_user(b):
        assert schedule_api.get_blocks(_user(b), conn) == []  # RLS·user_id 이중 확인
    conn.execute("savepoint s")
    with pytest.raises(psycopg.errors.CheckViolation):
        conn.execute("insert into public.schedule_blocks (user_id, title, kind, weekdays, start_time, end_time) values (%s, 'x', 'work', 0, '09:00', '10:00')", (a,))
    conn.execute("rollback to savepoint s")

@db_only
def test_events_crud_filter_and_project_delete(db) -> None:
    conn, a, b, as_user = db
    ua = _user(a)
    with as_user(a):
        root = project_repo.create_project(conn, a, project_repo_create("졸업 작품"))
        child = project_repo.create_project(conn, a, project_repo_create("전시", parent_id=root["id"]))
        exam = events_api.create_event(events_api.EventCreate(title="정보처리기사", kind="exam", event_date=date(2026, 12, 5), start_time=time(9), end_time=time(11)), ua, conn)
        show = events_api.create_event(events_api.EventCreate(title="출품 마감", kind="exhibition", event_date=date(2026, 12, 1), project_id=child["id"]), ua, conn)
        assert (exam["start_time"], exam["end_time"], exam["project_path"]) == ("09:00", "11:00", None)
        assert show["project_path"] == "졸업 작품 › 전시"

        assert [e["title"] for e in events_api.get_events(ua, conn, start=date(2026, 12, 1), end=date(2026, 12, 4), project_id=None)] == ["출품 마감"]
        assert [e["title"] for e in events_api.get_events(ua, conn, start=None, end=None, project_id=child["id"])] == ["출품 마감"]

        with pytest.raises(FieldError) as err:
            events_api.update_event(exam["id"], events_api.EventUpdate(end_time=time(8)), ua, conn)
        assert err.value.field == "end_time"
        with pytest.raises(FieldError) as err:
            events_api.update_event(exam["id"], events_api.EventUpdate(start_time=None), ua, conn)  # 끝만 남김
        assert err.value.field == "start_time"
        moved = events_api.update_event(exam["id"], events_api.EventUpdate(start_time=None, end_time=None, event_date=date(2026, 12, 6)), ua, conn)
        assert (moved["start_time"], moved["event_date"]) == (None, date(2026, 12, 6))  # 종일로

        # 프로젝트를 지우면 이벤트는 개인 이벤트로 남는다
        conn.execute("delete from public.projects where id = %s", (child["id"],))
        assert events_api.get_events(ua, conn, start=None, end=None, project_id=None)[0]["project_id"] is None

    with as_user(b):
        with pytest.raises(FieldError) as err:  # 남의 프로젝트에 달 수 없다
            events_api.create_event(events_api.EventCreate(title="x", event_date=date(2026, 12, 1), project_id=root["id"]), _user(b), conn)
        assert err.value.field == "project_id"
        with pytest.raises(HTTPException) as http:
            events_api.delete_event(exam["id"], _user(b), conn)
        assert http.value.status_code == 404
    with as_user(a):
        events_api.delete_event(exam["id"], ua, conn)
        assert len(events_api.get_events(ua, conn, start=None, end=None, project_id=None)) == 1

def project_repo_create(name: str, parent_id: UUID | None = None):
    from app.schemas.project import ProjectCreate

    return ProjectCreate(name=name, parent_id=parent_id)

@db_only
def test_dashboard_briefing_data(db) -> None:
    from app.repositories import tasks as task_repo
    from app.schemas.task import TaskCreate

    conn, a, _, as_user = db
    today = date(2026, 12, 2)  # 수요일
    with as_user(a):
        schedule_api.replace_blocks(schedule_api.BlocksReplace(blocks=[
            schedule_api.BlockIn(**_block()),
            schedule_api.BlockIn(**_block(title="주말 알바", kind="fixed", weekdays=[0, 6])),
        ]), _user(a), conn)
        for d, title in [(today - timedelta(days=1), "지난 일"), (today + timedelta(days=3), "발표"), (today + timedelta(days=61), "먼 일")]:
            events_api.create_event(events_api.EventCreate(title=title, kind="presentation", event_date=d), _user(a), conn)
        task = task_repo.create_task(conn, a, TaskCreate(title="자료"))
        start = datetime.combine(today, time(23), tzinfo=SEOUL)
        conn.execute(
            "insert into public.task_time_plans (user_id, task_id, starts_at, ends_at) values (%s, %s, %s, %s)",
            (a, task["id"], start, start + timedelta(hours=2)),  # 오늘 안은 60분
        )
        out = dashboard_repo.get_dashboard(conn, a, today, "Asia/Seoul")
    assert [e["title"] for e in out["upcoming_events"]] == ["발표"]
    assert out["today_planned_minutes"] == 60
    assert [b["title"] for b in out["today_schedule"]] == ["학교 수업"]

@db_only
def test_account_delete_removes_blocks_and_events(db) -> None:
    conn, a, _, as_user = db
    account._failures.clear()
    conn.execute("update auth.users set encrypted_password = extensions.crypt('pw', extensions.gen_salt('bf', 4)) where id = %s", (a,))
    email = conn.execute("select email from auth.users where id = %s", (a,)).fetchone()["email"]
    with as_user(a):
        schedule_api.replace_blocks(schedule_api.BlocksReplace(blocks=[schedule_api.BlockIn(**_block())]), _user(a), conn)
        events_api.create_event(events_api.EventCreate(title="시험", event_date=date(2026, 12, 5)), _user(a), conn)
    account.delete_account(conn, a, email, "pw")
    for table in ("schedule_blocks", "events"):
        assert conn.execute(f"select count(*) as n from public.{table} where user_id = %s", (a,)).fetchone()["n"] == 0
