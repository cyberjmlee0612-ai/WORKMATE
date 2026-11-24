"""오류 응답 형식 통일.

모든 오류는 {"detail": "사용자에게 보여줄 문장"} 형태이고,
입력 검증 오류는 필드별 메시지를 {"errors": {"name": "..."}}로 함께 보낸다.
"""

from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from psycopg import errors as pg_errors

GENERIC_VALIDATION_MESSAGE = "입력값을 확인해 주세요."

_TYPE_MESSAGES = {
    "missing": "필수 항목입니다.",
    "literal_error": "허용되지 않는 값입니다.",
    "date_from_datetime_parsing": "올바른 날짜를 입력해 주세요.",
    "date_parsing": "올바른 날짜를 입력해 주세요.",
    "date_type": "올바른 날짜를 입력해 주세요.",
    "string_type": "문자열이어야 합니다.",
    "extra_forbidden": "허용되지 않는 항목입니다.",
    "uuid_parsing": "올바른 ID가 아닙니다.",
}


def _field_name(loc: tuple[Any, ...]) -> str:
    # ("body", "name") → "name", 모델 전체 검증(날짜 순서 등)은 ("body",) → "_form"
    parts = [str(p) for p in loc if p not in ("body", "query", "path")]
    return ".".join(parts) or "_form"


def _message(error: dict[str, Any]) -> str:
    if error.get("type") == "value_error":
        # 우리가 ValueError로 던진 한국어 메시지 ("Value error, " 접두어 제거)
        return str(error.get("ctx", {}).get("error") or error.get("msg"))
    return _TYPE_MESSAGES.get(error.get("type", ""), GENERIC_VALIDATION_MESSAGE)


async def _validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    errors: dict[str, str] = {}
    for error in exc.errors():
        field = _field_name(tuple(error.get("loc", ())))
        # 날짜 순서 오류는 마감일 칸에 표시
        if field == "_form" and "마감일" in _message(error):
            field = "due_date"
        errors.setdefault(field, _message(error))
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content={"detail": GENERIC_VALIDATION_MESSAGE, "errors": errors},
    )


async def _check_violation_handler(_: Request, exc: pg_errors.CheckViolation) -> JSONResponse:
    # 앱 검증을 통과했는데 DB 제약에 걸린 경우 (최후 방어선)
    return JSONResponse(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, content={"detail": GENERIC_VALIDATION_MESSAGE})


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(RequestValidationError, _validation_handler)  # type: ignore[arg-type]
    app.add_exception_handler(pg_errors.CheckViolation, _check_violation_handler)  # type: ignore[arg-type]
