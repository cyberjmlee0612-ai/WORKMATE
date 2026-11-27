"""빠른 입력·검색 API 테스트 (RUN_DB_TESTS=1).

- 해석: #프로젝트 맞추기(공백 무시·진행 중 먼저), 못 찾은 태그, 지난 시각은 내일로
- 만들기: 업무+계획 / 이벤트 / 반복(오늘 업무 바로)
- AI 해석: 가짜 제공자, 사용량 1 증가, 값 정리
- 검색: 제목 부분 일치, %·_ 이스케이프, 사용자 격리
"""

import os
from datetime import datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

import pytest

from app.api import ai as ai_api
from app.api import quick as api
from app.core.auth import CurrentUser
from app.repositories import projects as project_repo
from app.repositories import tasks as task_repo
from app.schemas.project import ProjectCreate
from app.schemas.task import TaskCreate

pytestmark = pytest.mark.skipif(os.environ.get("RUN_DB_TESTS") != "1", reason="RUN_DB_TESTS=1 일 때만 실행")
TZ = "Asia/Seoul"


def _user(uid: UUID) -> CurrentUser:
    return CurrentUser(id=uid, email=None, claims={})


def test_parse_matches_projects(db) -> None:
    conn, a, _, as_user = db
    ua = _user(a)
    today = datetime.now(ZoneInfo(TZ)).date()
    with as_user(a):
        old = project_repo.create_project(conn, a, ProjectCreate(name="졸업 작품 2025"))
        conn.execute("update public.projects set status = 'archived' where id = %s", (old["id"],))
        current = project_repo.create_project(conn, a, ProjectCreate(name="졸업 작품"))
        out = api.post_parse(api.ParseIn(text="내일 3시 포스터 만들기 #졸업작품 !높음", tz=TZ), ua, conn)
        assert (out["kind"], out["title"], out["date"], out["start"], out["end"]) == ("task", "포스터 만들기", today + timedelta(days=1), "15:00", None)
        assert (out["project_id"], out["project_name"], out["project_query"], out["priority"]) == (current["id"], "졸업 작품", None, "high")
        missing = api.post_parse(api.ParseIn(text="보고서 #없는프로젝트", tz=TZ), ua, conn)
        assert (missing["project_id"], missing["project_query"]) == (None, "없는프로젝트")
        # 날짜 없이 이미 지난 시각(자정)만 쓰면 내일로
        past = api.post_parse(api.ParseIn(text="새벽 12시 정리", tz=TZ), ua, conn)
        if datetime.now(ZoneInfo(TZ)).hour * 60 + datetime.now(ZoneInfo(TZ)).minute > 0:
            assert past["date"] == today + timedelta(days=1)


def test_create_each_kind(db) -> None:
    conn, a, _, as_user = db
    ua = _user(a)
    today = datetime.now(ZoneInfo(TZ)).date()
    tomorrow = today + timedelta(days=1)
    with as_user(a):
        out = api.post_create(api.CreateIn(kind="task", title="발표 준비", date=tomorrow, start="15:00", duration=90, priority="high", tz=TZ), ua, conn)
        task = task_repo.get_task(conn, a, out["id"])
        assert (task["due_date"], task["estimated_minutes"], task["planned_minutes"], task["priority"]) == (tomorrow, 90, 90, "high")
        plan = conn.execute("select starts_at, ends_at from public.task_time_plans where task_id = %s", (out["id"],)).fetchone()
        assert plan["starts_at"].astimezone(ZoneInfo(TZ)).strftime("%H:%M") == "15:00" and plan["ends_at"] - plan["starts_at"] == timedelta(minutes=90)

        out = api.post_create(api.CreateIn(kind="event", title="정보처리기사 시험", event_kind="exam", date=tomorrow, start="09:00", end="11:00", tz=TZ), ua, conn)
        ev = conn.execute("select kind, event_date, start_time from public.events where id = %s", (out["id"],)).fetchone()
        assert (ev["kind"], ev["event_date"], ev["start_time"].hour) == ("exam", tomorrow, 9)

        out = api.post_create(api.CreateIn(kind="routine", title="영어 단어", freq="daily", start="07:00", duration=30, tz=TZ), ua, conn)
        assert out["kind"] == "routine"
        made = conn.execute("select title, due_date from public.tasks where routine_id = %s", (out["id"],)).fetchall()
        assert [(r["title"], r["due_date"]) for r in made] == [("영어 단어", today)]  # 오늘 업무가 바로 생긴다

        with pytest.raises(Exception):  # 끝이 시작보다 빠름
            api.post_create(api.CreateIn(kind="task", title="x", start="10:00", end="10:05", tz=TZ), ua, conn)


class FakeProvider:
    name = "fake"
    model = "fake"

    def __init__(self, result) -> None:
        self.result = result
        self.prompts: list[str] = []

    def generate(self, system, prompt, schema):
        self.prompts.append(prompt)
        return self.result


def test_ai_parse(db, monkeypatch) -> None:
    conn, a, _, as_user = db
    ua = _user(a)
    fake = FakeProvider(api.AiQuick(kind="routine", title="  팀   회고 ", start="17:00", minutes=60, freq="weekly", weekdays=[5, 9, 5], project="팀 운영", habit=False))
    monkeypatch.setattr(ai_api, "get_provider", lambda: fake)
    with as_user(a):
        team = project_repo.create_project(conn, a, ProjectCreate(name="팀 운영"))
        out = api.post_ai_parse(api.ParseIn(text="금요일마다 다섯시 팀 회고 한 시간", tz=TZ), ua, conn)
        assert (out["kind"], out["title"], out["start"], out["end"], out["weekdays"], out["project_id"]) == ("routine", "팀 회고", "17:00", "18:00", [5], team["id"])
        assert "팀 운영" in fake.prompts[0]
        assert conn.execute("select count from public.ai_usage where user_id = %s", (a,)).fetchone()["count"] == 1


def test_search(db) -> None:
    conn, a, b, as_user = db
    with as_user(a):
        task_repo.create_task(conn, a, TaskCreate(title="100% 완료 보고서"))
        task_repo.create_task(conn, a, TaskCreate(title="주간 보고서"))
        project_repo.create_project(conn, a, ProjectCreate(name="보고서 개선"))
        out = api.search(_user(a), conn, q="보고서")
        assert sorted(t["title"] for t in out["tasks"]) == ["100% 완료 보고서", "주간 보고서"]
        assert [p["name"] for p in out["projects"]] == ["보고서 개선"]
        assert [t["title"] for t in api.search(_user(a), conn, q="100%")["tasks"]] == ["100% 완료 보고서"]
        assert api.search(_user(a), conn, q="%")["tasks"][0]["title"] == "100% 완료 보고서"  # %는 글자 그대로
        assert api.search(_user(a), conn, q="_")["tasks"] == []
    with as_user(b):
        assert api.search(_user(b), conn, q="보고서") == {"tasks": [], "projects": [], "events": []}
