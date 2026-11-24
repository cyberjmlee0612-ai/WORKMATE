"""Supabase Auth가 발급한 access token(JWT)을 검증해 현재 사용자를 정한다.

- 새 Supabase 프로젝트는 비대칭 서명 키(ES256/RS256)를 쓰므로 JWKS 공개키로 검증한다.
- 레거시 HS256 secret을 쓰는 프로젝트는 SUPABASE_JWT_SECRET이 설정된 경우에만 허용한다.
- user_id는 항상 이 토큰의 `sub`에서 정하며 클라이언트 입력을 신뢰하지 않는다.
"""

from dataclasses import dataclass
from functools import lru_cache
from typing import Annotated, Any
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import Settings, get_settings

ASYMMETRIC_ALGORITHMS = ["ES256", "RS256"]
AUDIENCE = "authenticated"

_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class CurrentUser:
    id: UUID
    email: str | None
    claims: dict[str, Any]


def _unauthorized(detail: str = "인증이 필요합니다.") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


@lru_cache
def _jwks_client(jwks_url: str) -> jwt.PyJWKClient:
    # 공개키를 메모리에 캐시하고, 모르는 kid가 오면 다시 가져온다
    return jwt.PyJWKClient(jwks_url, cache_keys=True, lifespan=600)


def verify_token(token: str, settings: Settings) -> dict[str, Any]:
    try:
        header = jwt.get_unverified_header(token)
        algorithm = header.get("alg")

        if algorithm == "HS256":
            if not settings.supabase_jwt_secret:
                raise _unauthorized("지원하지 않는 토큰입니다.")
            key: Any = settings.supabase_jwt_secret
            algorithms = ["HS256"]
        elif algorithm in ASYMMETRIC_ALGORITHMS:
            key = _jwks_client(settings.jwks_url).get_signing_key_from_jwt(token).key
            algorithms = ASYMMETRIC_ALGORITHMS
        else:
            raise _unauthorized("지원하지 않는 토큰입니다.")

        claims = jwt.decode(
            token,
            key,
            algorithms=algorithms,
            audience=AUDIENCE,
            issuer=settings.supabase_issuer,
            options={"require": ["exp", "sub", "aud", "iss"]},
        )
    except jwt.PyJWKClientConnectionError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "인증 서버에 연결할 수 없습니다.") from exc
    except jwt.ExpiredSignatureError as exc:
        raise _unauthorized("세션이 만료되었습니다. 다시 로그인해 주세요.") from exc
    except (jwt.InvalidTokenError, jwt.PyJWKClientError) as exc:
        raise _unauthorized("유효하지 않은 인증 정보입니다.") from exc

    # anon key 등 로그인 사용자가 아닌 토큰은 거절
    if claims.get("role") != "authenticated":
        raise _unauthorized("로그인한 사용자만 접근할 수 있습니다.")
    return claims


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> CurrentUser:
    if credentials is None:
        raise _unauthorized()

    claims = verify_token(credentials.credentials, settings)
    try:
        user_id = UUID(claims["sub"])
    except (KeyError, ValueError) as exc:
        raise _unauthorized("유효하지 않은 인증 정보입니다.") from exc

    return CurrentUser(id=user_id, email=claims.get("email"), claims=claims)


CurrentUserDep = Annotated[CurrentUser, Depends(get_current_user)]
