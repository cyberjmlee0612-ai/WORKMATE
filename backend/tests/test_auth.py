"""토큰 검증 테스트. DB나 실제 Supabase 없이 실행된다."""

import time
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import me
from app.core import auth
from app.core.config import Settings, get_settings

SUPABASE_URL = "https://example.supabase.co"
ISSUER = f"{SUPABASE_URL}/auth/v1"
HS_SECRET = "test-secret-that-is-long-enough-for-hs256"
USER_ID = "11111111-1111-1111-1111-111111111111"
EC_KEY = ec.generate_private_key(ec.SECP256R1())


def make_settings(jwt_secret: str | None = HS_SECRET) -> Settings:
    return Settings(supabase_url=SUPABASE_URL, database_url="postgresql://unused", supabase_jwt_secret=jwt_secret)


def make_claims(**overrides: Any) -> dict[str, Any]:
    now = int(time.time())
    claims = {
        "sub": USER_ID,
        "email": "user@example.com",
        "role": "authenticated",
        "aud": "authenticated",
        "iss": ISSUER,
        "iat": now,
        "exp": now + 3600,
    }
    claims.update(overrides)
    return claims


def build_client(settings: Settings) -> TestClient:
    app = FastAPI()
    app.include_router(me.router)  # /me 는 DB를 사용하지 않는다
    app.dependency_overrides[get_settings] = lambda: settings
    return TestClient(app)


@pytest.fixture
def client() -> TestClient:
    return build_client(make_settings())


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_missing_token_returns_401(client: TestClient) -> None:
    res = client.get("/me")
    assert res.status_code == 401
    assert res.headers["www-authenticate"] == "Bearer"


def test_valid_hs256_token(client: TestClient) -> None:
    token = jwt.encode(make_claims(), HS_SECRET, algorithm="HS256")
    res = client.get("/me", headers=bearer(token))
    assert res.status_code == 200
    assert res.json() == {"id": USER_ID, "email": "user@example.com"}


@pytest.mark.parametrize(
    ("claims", "secret"),
    [
        (make_claims(exp=int(time.time()) - 10), HS_SECRET),  # 만료
        (make_claims(), "wrong-secret-wrong-secret-wrong-secret"),  # 위조 서명
        (make_claims(aud="other"), HS_SECRET),  # 다른 audience
        (make_claims(iss="https://evil.example/auth/v1"), HS_SECRET),  # 다른 발급자
        (make_claims(role="anon"), HS_SECRET),  # 비로그인(anon) 토큰
        (make_claims(sub="not-a-uuid"), HS_SECRET),  # 잘못된 사용자 ID
    ],
)
def test_invalid_tokens_return_401(client: TestClient, claims: dict[str, Any], secret: str) -> None:
    token = jwt.encode(claims, secret, algorithm="HS256")
    assert client.get("/me", headers=bearer(token)).status_code == 401


def test_hs256_rejected_when_secret_not_configured() -> None:
    client = build_client(make_settings(jwt_secret=None))
    token = jwt.encode(make_claims(), HS_SECRET, algorithm="HS256")
    assert client.get("/me", headers=bearer(token)).status_code == 401


def test_alg_none_rejected(client: TestClient) -> None:
    token = jwt.encode(make_claims(), key=None, algorithm="none")
    assert client.get("/me", headers=bearer(token)).status_code == 401


class _FakeJwksClient:
    def get_signing_key_from_jwt(self, token: str) -> Any:
        return type("Key", (), {"key": EC_KEY.public_key()})()


def test_valid_es256_token_via_jwks(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(auth, "_jwks_client", lambda url: _FakeJwksClient())
    client = build_client(make_settings(jwt_secret=None))
    token = jwt.encode(make_claims(), EC_KEY, algorithm="ES256", headers={"kid": "test"})
    res = client.get("/me", headers=bearer(token))
    assert res.status_code == 200
    assert res.json()["id"] == USER_ID


def test_es256_signed_by_other_key_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(auth, "_jwks_client", lambda url: _FakeJwksClient())
    client = build_client(make_settings(jwt_secret=None))
    other_key = ec.generate_private_key(ec.SECP256R1())
    token = jwt.encode(make_claims(), other_key, algorithm="ES256", headers={"kid": "test"})
    assert client.get("/me", headers=bearer(token)).status_code == 401
