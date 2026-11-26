"""AI 제공자 연결부. 업무 분해 요청을 보내고 정해진 JSON 형식의 답을 받는다.

제공자를 바꿔 끼울 수 있게 BreakdownProvider 하나만 바깥에 드러낸다.
지금은 Google Gemini(무료 등급, 2026-11-26 사용자 확정)만 구현했고, 다른 제공자(예: Claude)는
같은 메서드를 가진 클래스를 추가하고 AI_PROVIDER 설정만 바꾸면 된다.
"""

from functools import lru_cache
from typing import Literal, Protocol

from pydantic import BaseModel, Field, ValidationError

from app.core.config import get_settings


class AiTaskDraft(BaseModel):
    """AI가 제안한 업무 하나 (검증 전 원본). 저장 전에 service에서 다시 정리한다."""

    title: str = Field(description="동사로 시작하는 짧은 업무 제목 (60자 이내)")
    description: str | None = Field(default=None, description="필요할 때만 한두 문장")
    priority: Literal["low", "medium", "high", "urgent"]
    estimated_minutes: int | None = Field(default=None, description="예상 소요 시간(분)")
    due_date: str | None = Field(default=None, description="YYYY-MM-DD. 기한을 알 수 있을 때만")


class AiBreakdown(BaseModel):
    summary: str = Field(description="어떻게 나눴는지 한두 문장 요약")
    project_name: str = Field(default="", description="이 업무 묶음을 프로젝트로 만든다면 붙일 짧은 이름 (20자 이내)")
    tasks: list[AiTaskDraft]


class AiNotConfigured(Exception):
    pass


class AiProviderError(Exception):
    """제공자 호출 실패. message는 사용자에게 보여줄 문장."""

    def __init__(self, message: str, *, rate_limited: bool = False) -> None:
        super().__init__(message)
        self.message = message
        self.rate_limited = rate_limited


class BreakdownProvider(Protocol):
    name: str
    model: str

    def breakdown(self, system: str, prompt: str) -> AiBreakdown: ...


_TRANSIENT = {500, 502, 503, 504}  # Google 쪽 일시 과부하·시간 초과 → 잠시 뒤 다시 시도
RETRY_DELAY_SECONDS = 1.5


class GeminiProvider:
    """무료 등급은 '요청이 몰렸다'(503)가 자주 나온다 (2026-11-26 실측: 3번 중 1번).
    그래서 같은 모델로 한 번 더 시도하고, 그래도 안 되거나 그 모델의 무료 한도(429)·제공 종료(404)면
    예비 모델로 넘어간다. 전체 대기 시간은 timeout_seconds 안으로 제한한다.
    """

    name = "gemini"

    def __init__(self, api_key: str, model: str, timeout_seconds: int, fallback_models: list[str] | None = None) -> None:
        from google import genai  # 키가 없을 때는 불러오지 않는다
        from google.genai import types

        self._types = types
        self.model = model
        self._models = [model, *[m for m in (fallback_models or []) if m and m != model]]
        self._budget = timeout_seconds
        self._client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=timeout_seconds * 1000))

    def _generate(self, model: str, system: str, prompt: str):
        return self._client.models.generate_content(
            model=model,
            contents=prompt,
            config=self._types.GenerateContentConfig(
                system_instruction=system,
                response_mime_type="application/json",
                response_json_schema=AiBreakdown.model_json_schema(),
            ),
        )

    def breakdown(self, system: str, prompt: str) -> AiBreakdown:
        import time

        from google.genai import errors

        started = time.monotonic()
        last: Exception | None = None
        response = None
        for model in self._models:
            for attempt in range(2):
                if time.monotonic() - started > self._budget:
                    break
                try:
                    response = self._generate(model, system, prompt)
                    break
                except errors.APIError as exc:
                    last = exc
                    if exc.code in (401, 403):
                        raise AiProviderError("AI 키가 올바르지 않아요. 관리자에게 키 설정을 확인해 달라고 해 주세요.") from exc
                    if exc.code in _TRANSIENT and attempt == 0:
                        time.sleep(RETRY_DELAY_SECONDS)
                        continue
                    break  # 429(이 모델 한도)·404(제공 종료)·반복 실패 → 다음 모델
                except Exception as exc:  # 네트워크 끊김·시간 초과 → 다음 모델
                    last = exc
                    break
            if response is not None:
                break

        if response is None:
            code = getattr(last, "code", None)
            if code == 429:
                raise AiProviderError("AI 무료 사용량 한도에 도달했어요. 잠시 후 다시 시도해 주세요.", rate_limited=True) from last
            if code == 404:
                raise AiProviderError("설정된 AI 모델을 찾을 수 없어요. 모델 이름을 확인해 주세요.") from last
            if code in _TRANSIENT:
                raise AiProviderError("AI 서비스에 요청이 몰려 있어요. 잠시 후 다시 시도해 주세요.", rate_limited=True) from last
            raise AiProviderError("AI 서비스에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.") from last

        text = response.text
        if not text:
            raise AiProviderError("AI가 답을 만들지 못했어요. 표현을 바꿔 다시 시도해 주세요.")
        try:
            return AiBreakdown.model_validate_json(text)
        except ValidationError as exc:
            raise AiProviderError("AI 답변 형식이 올바르지 않아요. 다시 시도해 주세요.") from exc


@lru_cache
def get_provider() -> BreakdownProvider:
    settings = get_settings()
    if settings.ai_provider == "gemini":
        if not settings.gemini_api_key:
            raise AiNotConfigured
        fallbacks = [m.strip() for m in settings.gemini_fallback_models.split(",")]
        return GeminiProvider(settings.gemini_api_key, settings.gemini_model, settings.ai_timeout_seconds, fallbacks)
    raise AiNotConfigured


def is_configured() -> bool:
    settings = get_settings()
    return settings.ai_provider == "gemini" and bool(settings.gemini_api_key)
