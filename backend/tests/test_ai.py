"""AI 업무 도우미 테스트. 실제 AI 대신 가짜 제공자를 쓴다 (요금·네트워크 없이 실행).

- 단위: 답 정리 규칙, 프롬프트 구성, 입력 검증
- DB(RUN_DB_TESTS=1): 하루 사용량 증가·한도·실패 시 롤백, 프로젝트 문맥, 여러 업무 저장
"""

import os
from datetime import date, timedelta
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.ai import breakdown
from google.genai import errors as genai_errors

from app.ai.provider import AiBreakdown, AiProviderError, AiTaskDraft, GeminiProvider
from app.api import ai as ai_api
from app.api import tasks as tasks_api
from app.core.auth import CurrentUser, get_current_user
from app.core.config import get_settings
from app.core.errors import FieldError, register_error_handlers
from app.db import get_user_db
from app.repositories import projects as project_repo
from app.repositories import tasks as task_repo
from app.schemas.project import ProjectCreate
from app.schemas.task import TaskBulkCreate, TaskCreate

TODAY = date(2026, 11, 26)
USER = CurrentUser(id=UUID("11111111-1111-1111-1111-111111111111"), email="a@example.com", claims={})


class FakeProvider:
    name = "fake"
    model = "fake-model"

    def __init__(self, result: AiBreakdown | Exception) -> None:
        self.result = result
        self.prompts: list[str] = []

    def breakdown(self, system: str, prompt: str) -> AiBreakdown:
        self.prompts.append(prompt)
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def _draft(**kw) -> AiTaskDraft:
    return AiTaskDraft(**{"title": "자료 조사하기", "priority": "medium", **kw})


# ---------------------------------------------------------------- 단위


def test_clean_drops_blank_and_fixes_ranges() -> None:
    result = AiBreakdown(
        summary=" 요약 ",
        tasks=[
            _draft(title="   "),
            _draft(title="  목차   정하기 ", estimated_minutes=-5, due_date="2026-11-20"),
            _draft(title="가" * 400, estimated_minutes=999_999, due_date="내일"),
            _draft(title="발표하기", estimated_minutes=30, due_date="2026-12-04", description="  "),
        ],
    )
    cleaned = breakdown._clean(result, TODAY)
    assert cleaned["summary"] == "요약"
    titles = [t["title"] for t in cleaned["tasks"]]
    assert titles[0] == "목차 정하기" and len(titles) == 3 and len(titles[1]) == 300
    first, second, third = cleaned["tasks"]
    assert first["estimated_minutes"] is None and first["due_date"] is None  # 음수, 지난 날짜 제거
    assert second["estimated_minutes"] == 10_000 and second["due_date"] is None  # 상한, 잘못된 날짜
    assert third == {"title": "발표하기", "description": None, "priority": "medium", "estimated_minutes": 30, "due_date": date(2026, 12, 4)}


def test_clean_limits_count() -> None:
    result = AiBreakdown(summary="", tasks=[_draft(title=f"업무 {i}") for i in range(40)])
    assert len(breakdown._clean(result, TODAY)["tasks"]) == breakdown.MAX_SUGGESTIONS


def test_prompt_includes_context() -> None:
    project = {"name": "신제품 발표", "description": "12월 행사", "due_date": date(2026, 12, 10)}
    prompt = breakdown.build_prompt("발표 준비", TODAY, project, ["장소 예약하기"])
    assert "오늘: 2026-11-26 (목요일)" in prompt
    assert "프로젝트 마감일: 2026-12-10" in prompt and "- 장소 예약하기" in prompt
    assert prompt.rstrip().endswith("발표 준비")
    assert "개인 업무" in breakdown.build_prompt("x", TODAY, None, [])


class _FakeResponse:
    def __init__(self, text: str) -> None:
        self.text = text


def _gemini(script: dict[str, list]) -> tuple[GeminiProvider, list[str]]:
    """모델별로 차례대로 돌려줄 결과(오류 코드 또는 성공)를 정한 가짜 Gemini."""
    calls: list[str] = []
    provider = object.__new__(GeminiProvider)
    provider.model = "a"
    provider._models = ["a", "b"]
    provider._budget = 90

    def generate(model: str, system: str, prompt: str):
        calls.append(model)
        outcome = script[model].pop(0)
        if isinstance(outcome, int):
            raise genai_errors.APIError(outcome, {"error": {"code": outcome, "message": "x", "status": "X"}})
        return _FakeResponse(_ok().model_dump_json())

    provider._generate = generate  # type: ignore[method-assign]
    return provider, calls


def test_gemini_retries_transient_then_succeeds(monkeypatch) -> None:
    monkeypatch.setattr("time.sleep", lambda s: None)
    provider, calls = _gemini({"a": [503, "ok"], "b": []})
    assert len(provider.breakdown("s", "p").tasks) == 2
    assert calls == ["a", "a"]


def test_gemini_falls_back_to_next_model(monkeypatch) -> None:
    monkeypatch.setattr("time.sleep", lambda s: None)
    provider, calls = _gemini({"a": [429], "b": ["ok"]})
    provider.breakdown("s", "p")
    assert calls == ["a", "b"]  # 한도(429)는 같은 모델로 다시 시도하지 않는다


def test_gemini_all_busy_gives_friendly_error(monkeypatch) -> None:
    monkeypatch.setattr("time.sleep", lambda s: None)
    provider, calls = _gemini({"a": [503, 503], "b": [503, 504]})
    with pytest.raises(AiProviderError) as exc:
        provider.breakdown("s", "p")
    assert calls == ["a", "a", "b", "b"] and exc.value.rate_limited and "몰려" in exc.value.message


def test_gemini_bad_key_stops_immediately() -> None:
    provider, calls = _gemini({"a": [403], "b": ["ok"]})
    with pytest.raises(AiProviderError) as exc:
        provider.breakdown("s", "p")
    assert calls == ["a"] and "키" in exc.value.message


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    register_error_handlers(app)
    app.include_router(ai_api.router)
    app.include_router(tasks_api.router)
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[get_user_db] = lambda: object()
    return TestClient(app)


def test_breakdown_input_validation(client: TestClient) -> None:
    assert client.post("/ai/breakdown", json={"text": "   "}).json()["errors"]["text"] == "하고 싶은 일을 입력해 주세요."
    assert "text" in client.post("/ai/breakdown", json={"text": "가" * 2001}).json()["errors"]
    assert "model" in client.post("/ai/breakdown", json={"text": "x", "model": "other"}).json()["errors"]


def test_bulk_validation(client: TestClient) -> None:
    assert client.post("/tasks/bulk", json={"tasks": []}).status_code == 422
    res = client.post("/tasks/bulk", json={"tasks": [{"title": "ok"}, {"title": " "}]})
    assert res.status_code == 422 and res.json()["errors"]["tasks.1.title"] == "업무 제목을 입력해 주세요."
    assert client.post("/tasks/bulk", json={"tasks": [{"title": "x"}] * 31}).status_code == 422


# ---------------------------------------------------------------- DB

db_only = pytest.mark.skipif(os.environ.get("RUN_DB_TESTS") != "1", reason="RUN_DB_TESTS=1 일 때만 실행")


def _user(uid) -> CurrentUser:
    return CurrentUser(id=uid, email=None, claims={})


def _ok() -> AiBreakdown:
    return AiBreakdown(summary="두 단계로 나눴어요", tasks=[_draft(title="목차 정하기"), _draft(title="자료 만들기", priority="high")])


@db_only
def test_breakdown_counts_usage_and_enforces_limit(db, monkeypatch) -> None:
    conn, a, _, as_user = db
    monkeypatch.setattr(ai_api, "get_provider", lambda: FakeProvider(_ok()))
    monkeypatch.setattr(get_settings(), "ai_daily_limit", 2)
    body = ai_api.BreakdownRequest(text="발표 준비", tz="Asia/Seoul")
    with as_user(a):
        first = ai_api.post_breakdown(body, _user(a), conn)
        assert [t["title"] for t in first["tasks"]] == ["목차 정하기", "자료 만들기"]
        assert first["usage"]["used"] == 1 and first["usage"]["remaining"] == 1
        assert ai_api.post_breakdown(body, _user(a), conn)["usage"]["remaining"] == 0
        with pytest.raises(HTTPException) as exc, conn.transaction():  # 실제 요청처럼 실패하면 롤백
            ai_api.post_breakdown(body, _user(a), conn)
        assert exc.value.status_code == 429
        today = ai_api._user_today("Asia/Seoul")
        assert ai_api._used_today(conn, a, today) == 2


@db_only
def test_provider_failure_is_not_counted(db, monkeypatch) -> None:
    conn, a, _, as_user = db
    monkeypatch.setattr(ai_api, "get_provider", lambda: FakeProvider(AiProviderError("AI 무료 사용량 한도", rate_limited=True)))
    with as_user(a):
        with pytest.raises(HTTPException) as exc, conn.transaction():
            ai_api.post_breakdown(ai_api.BreakdownRequest(text="x", tz="Asia/Seoul"), _user(a), conn)
        assert exc.value.status_code == 503
        assert ai_api._used_today(conn, a, ai_api._user_today("Asia/Seoul")) == 0


@db_only
def test_project_context_and_isolation(db, monkeypatch) -> None:
    conn, a, b, as_user = db
    fake = FakeProvider(_ok())
    monkeypatch.setattr(ai_api, "get_provider", lambda: fake)
    with as_user(a):
        project = project_repo.create_project(conn, a, ProjectCreate(name="신제품 발표", due_date=date.today() + timedelta(days=10)))
        task_repo.create_task(conn, a, TaskCreate(title="장소 예약하기", project_id=project["id"]))
        ai_api.post_breakdown(ai_api.BreakdownRequest(text="준비", project_id=project["id"]), _user(a), conn)
        assert "신제품 발표" in fake.prompts[0] and "- 장소 예약하기" in fake.prompts[0]
    with as_user(b):
        with pytest.raises(FieldError):  # 남의 프로젝트 문맥은 쓸 수 없다
            ai_api.post_breakdown(ai_api.BreakdownRequest(text="준비", project_id=project["id"]), _user(b), conn)


@db_only
def test_bulk_create_is_all_or_nothing(db) -> None:
    conn, a, _, as_user = db
    with as_user(a):
        created = tasks_api.create_tasks_bulk(TaskBulkCreate(tasks=[TaskCreate(title="하나"), TaskCreate(title="둘")]), _user(a), conn)
        assert [t["title"] for t in created] == ["하나", "둘"]
        with pytest.raises(FieldError), conn.transaction():
            tasks_api.create_tasks_bulk(TaskBulkCreate(tasks=[TaskCreate(title="셋"), TaskCreate(title="넷", project_id=uuid4())]), _user(a), conn)
        assert sorted(t["title"] for t in task_repo.list_tasks(conn, a)) == ["둘", "하나"]
