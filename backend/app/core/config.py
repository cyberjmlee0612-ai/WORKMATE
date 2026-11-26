from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """환경변수 설정. 필수 값이 없으면 서버 시작 시점에 바로 실패한다."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    supabase_url: str
    database_url: str
    supabase_jwt_secret: str | None = None
    cors_origins: str = "http://localhost:3000"

    # AI 업무 도우미 (2026-11-26 사용자 확정: 우선 Google Gemini API 무료 등급).
    # 키가 없으면 AI 기능만 꺼지고 나머지는 정상 동작한다.
    ai_provider: str = "gemini"
    gemini_api_key: str | None = None
    # 2026-11-26 실제 호출로 비교: 3.5 Flash-Lite 6초, 3.8 Flash 59초(품질 비슷). 별칭 gemini-flash-latest는 404.
    gemini_model: str = "gemini-3.5-flash-lite"
    # 기본 모델이 붐비거나(503) 무료 한도(429)면 차례로 시도할 예비 모델 (쉼표 구분)
    gemini_fallback_models: str = "gemini-3.1-flash-lite,gemini-3.5-flash"
    ai_timeout_seconds: int = 90
    ai_daily_limit: int = 30  # 사용자당 하루 요청 수 (사용자 시간대 기준)

    @property
    def supabase_issuer(self) -> str:
        return f"{self.supabase_url.rstrip('/')}/auth/v1"

    @property
    def jwks_url(self) -> str:
        return f"{self.supabase_issuer}/.well-known/jwks.json"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
