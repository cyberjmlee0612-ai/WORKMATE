"""리포트 집계와 AI 회고 테스트.

- 단위: 기간 검증, 회고 프롬프트·답 정리
- DB(RUN_DB_TESTS=1): 기간 경계 자르기, 이전 기간, 마감 지킴, 프로젝트 하위 합산, 예상 vs 실제, 다른 사용자 격리
"""

import os
from datetime import date, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

import pytest
from fastapi import HTTPException

from app.ai import report_review
from app.ai.report_review import AiReview
from app.api import ai as ai_api
from app.api.reports import validate_period
from app.core.auth import CurrentUser
from app.core.errors import FieldError
from app.repositories import projects as project_repo
from app.repositories import reports as repo
from app.repositories import tasks as task_repo
from app.schemas.project import ProjectCreate
from app.schemas.task import TaskCreate

db_only = pytest.mark.skipif(os.environ.get("RUN_DB_TESTS") != "1", reason="RUN_DB_TESTS=1 일 때만 실행")

SEOUL = ZoneInfo("Asia/Seoul")
START, END = date(2026, 11, 1), date(2026, 11, 7)
TODAY = date(2026, 11, 26)


def _at(day: date, hour: int, minute: int = 0) -> datetime:
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=SEOUL)


def _entry(conn, user: UUID, task_id: UUID, start: datetime, end: datetime) -> None:
    conn.execute(
        "insert into public.task_time_entries (user_id, task_id, started_at, ended_at, source) values (%s, %s, %s, %s, 'manual')",
        (user, task_id, start, end),
    )


def _plan(conn, user: UUID, task_id: UUID, start: datetime, end: datetime) -> None:
    conn.execute("insert into public.task_time_plans (user_id, task_id, starts_at, ends_at) values (%s, %s, %s, %s)", (user, task_id, start, end))


def _complete(conn, task_id: UUID, at: datetime) -> None:
    conn.execute("update public.tasks set status = 'completed', completed_at = %s where id = %s", (at, task_id))


class FakeProvider:
    name = "fake"
    model = "fake-model"

    def __init__(self, result) -> None:
        self.result = result
        self.prompts: list[str] = []

    def generate(self, system, prompt, schema):
        self.prompts.append(prompt)
        return self.result

    def breakdown(self, system, prompt):
        raise NotImplementedError


# ---------------------------------------------------------------- 단위


def test_validate_period() -> None:
    assert isinstance(validate_period(START, END, "Asia/Seoul"), date)
    with pytest.raises(FieldError) as err:
        validate_period(END, START, "Asia/Seoul")
    assert err.value.field == "end"
    validate_period(START, START + timedelta(days=91), "UTC")  # 92일은 허용
    with pytest.raises(FieldError):
        validate_period(START, START + timedelta(days=92), "UTC")
    with pytest.raises(FieldError) as err:
        validate_period(START, END, "Mars/Base")
    assert err.value.field == "tz"


def _empty_report() -> dict:
    zero = {"tracked_minutes": 0, "planned_minutes": 0, "completed_tasks": 0, "active_days": 0, "due_settled": 0, "due_on_time": 0, "due_overdue": 0}
    return {
        "start": START,
        "end": END,
        "summary": dict(zero),
        "previous": {**zero, "start": START - timedelta(days=7), "end": START - timedelta(days=1)},
        "daily": [],
        "projects": [],
        "personal": {"tracked_minutes": 0, "planned_minutes": 0},
        "top_tasks": [],
        "estimates": {"items": [], "measured_count": 0, "unmeasured_count": 0, "estimated_total": 0, "tracked_total": 0},
    }


def test_review_prompt_and_cleanup() -> None:
    report = _empty_report()
    assert not report_review.has_data(report)
    report["summary"].update(tracked_minutes=150, planned_minutes=240, due_settled=4, due_on_time=3)
    report["projects"] = [{"id": "x", "name": "웹사이트", "parent_id": None, "tracked_minutes": 90, "planned_minutes": 120}]
    assert report_review.has_data(report)
    prompt = report_review.build_prompt(report)
    assert "실제 기록 시간: 2시간 30분 / 0분" in prompt
    assert "마감 지킴: 3/4 (75%) / 해당 없음" in prompt
    assert "- 웹사이트: 1시간 30분 / 2시간 0분" in prompt

    fake = FakeProvider(AiReview(headline=" 좋은 한 주 ", good=["a", " ", "b", "c", "d"], improve=["x" * 300], suggestions=[]))
    out = report_review.review(fake, report)
    assert out == {"headline": "좋은 한 주", "good": ["a", "b", "c"], "improve": ["x" * 200], "suggestions": []}


# ---------------------------------------------------------------- DB


@db_only
def test_report_aggregates(db) -> None:
    conn, a, b, as_user = db
    with as_user(a):
        root = project_repo.create_project(conn, a, ProjectCreate(name="루트"))
        child = project_repo.create_project(conn, a, ProjectCreate(name="하위", parent_id=root["id"]))
        task_a = task_repo.create_task(conn, a, TaskCreate(title="A", project_id=child["id"], estimated_minutes=60, due_date=date(2026, 11, 3)))
        task_b = task_repo.create_task(conn, a, TaskCreate(title="B"))
        task_c = task_repo.create_task(conn, a, TaskCreate(title="C", project_id=root["id"]))
        task_d = task_repo.create_task(conn, a, TaskCreate(title="D", due_date=date(2026, 11, 4)))  # 마감 지남, 미완료
        task_e = task_repo.create_task(conn, a, TaskCreate(title="E", due_date=date(2026, 11, 5)))  # 늦게 완료
        cancelled = task_repo.create_task(conn, a, TaskCreate(title="취소", due_date=date(2026, 11, 5)))
        conn.execute("update public.tasks set status = 'cancelled', cancelled_at = now() where id = %s", (cancelled["id"],))

        _entry(conn, a, task_a["id"], _at(date(2026, 11, 2), 9), _at(date(2026, 11, 2), 10, 30))  # 90분
        _entry(conn, a, task_b["id"], _at(date(2026, 11, 7), 23), _at(date(2026, 11, 8), 1))  # 기간 안 60분
        _entry(conn, a, task_c["id"], _at(date(2026, 10, 31), 23, 30), _at(date(2026, 11, 1), 0, 30))  # 30분씩 나뉨
        _entry(conn, a, task_c["id"], _at(date(2026, 10, 28), 10), _at(date(2026, 10, 28), 11))  # 이전 기간
        _plan(conn, a, task_a["id"], _at(date(2026, 11, 2), 9), _at(date(2026, 11, 2), 11))  # 120분
        _complete(conn, task_a["id"], _at(date(2026, 11, 2), 12))
        _complete(conn, task_e["id"], _at(date(2026, 11, 6), 9))

        report = repo.get_report(conn, a, START, END, "Asia/Seoul", TODAY)

    s = report["summary"]
    assert (s["tracked_minutes"], s["planned_minutes"], s["completed_tasks"], s["active_days"]) == (180, 120, 2, 3)
    assert (s["due_settled"], s["due_on_time"], s["due_overdue"]) == (3, 1, 1)
    assert task_d["title"] == "D"

    by_day = {d["day"]: d for d in report["daily"]}
    assert len(report["daily"]) == 7
    assert by_day[date(2026, 11, 1)]["tracked_minutes"] == 30
    assert (by_day[date(2026, 11, 2)]["tracked_minutes"], by_day[date(2026, 11, 2)]["planned_minutes"]) == (90, 120)
    assert by_day[date(2026, 11, 6)]["completed_tasks"] == 1
    assert by_day[date(2026, 11, 7)]["tracked_minutes"] == 60

    p = report["previous"]
    assert (p["start"], p["end"], p["tracked_minutes"]) == (date(2026, 10, 25), date(2026, 10, 31), 90)

    projects = {r["name"]: r for r in report["projects"]}
    assert (projects["루트"]["tracked_minutes"], projects["루트"]["own_tracked_minutes"], projects["루트"]["parent_id"]) == (120, 30, None)
    assert (projects["하위"]["tracked_minutes"], projects["하위"]["planned_minutes"], projects["하위"]["parent_id"]) == (90, 120, root["id"])
    assert report["personal"] == {"tracked_minutes": 60, "planned_minutes": 0}

    assert [(t["title"], t["tracked_minutes"], t["project_path"]) for t in report["top_tasks"]] == [("A", 90, "루트 › 하위"), ("B", 60, None), ("C", 30, "루트")]

    est = report["estimates"]
    assert [(i["title"], i["estimated_minutes"], i["tracked_minutes"]) for i in est["items"]] == [("A", 60, 90)]
    assert (est["measured_count"], est["unmeasured_count"]) == (1, 0)

    with as_user(b):
        other = repo.get_report(conn, b, START, END, "Asia/Seoul", TODAY)
    assert other["summary"]["tracked_minutes"] == 0 and other["projects"] == [] and other["top_tasks"] == []


@db_only
def test_report_review_endpoint(db, monkeypatch) -> None:
    conn, a, _, as_user = db
    user = CurrentUser(id=a, email=None, claims={})
    fake = FakeProvider(AiReview(headline="꾸준한 한 주", good=["매일 기록"], improve=[], suggestions=["오전 집중"]))
    monkeypatch.setattr(ai_api, "get_provider", lambda: fake)
    body = ai_api.ReportReviewRequest(start=START, end=END, tz="Asia/Seoul")
    with as_user(a):
        with pytest.raises(HTTPException) as err:  # 기록이 없으면 AI를 부르지 않는다
            ai_api.post_report_review(body, user, conn)
        assert err.value.status_code == 422 and fake.prompts == []

        task = task_repo.create_task(conn, a, TaskCreate(title="보고서"))
        _entry(conn, a, task["id"], _at(date(2026, 11, 3), 9), _at(date(2026, 11, 3), 11))
        out = ai_api.post_report_review(body, user, conn)
    assert out["headline"] == "꾸준한 한 주" and out["usage"]["used"] == 1
    assert "실제 기록 시간: 2시간 0분" in fake.prompts[0] and "보고서 (개인 업무): 2시간 0분" in fake.prompts[0]
