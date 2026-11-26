"""오류 응답 형식 통일.

모든 오류는 {"detail": "사용자에게 보여줄 문장"} 형태이고,
입력 검증 오류는 필드별 메시지를 {"errors": {"name": "..."}}로 함께 보낸다.
"""

from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from psycopg import errors as pg_errors

GENERIC_VALIDATION_MESSAGE = "입력값을 확인해 주세요."


class FieldError(Exception):
    """저장소·서비스에서 특정 입력칸 오류를 알릴 때 사용. 예외로 던지므로 트랜잭션은 롤백된다."""

    def __init__(self, field: str, message: str) -> None:
        super().__init__(message)
        self.field = field
        self.message = message


class ConflictError(Exception):
    """현재 데이터 상태 때문에 처리할 수 없을 때(409). {"detail", "code", ...extra} 형식으로 응답한다.

    엔드포인트에서 JSONResponse를 직접 돌려주면 요청 트랜잭션이 커밋되지만,
    예외로 던지면 트랜잭션이 롤백되므로 중간에 쓴 내용이 남지 않는다.
    """

    def __init__(self, message: str, code: str, **extra: Any) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.extra = extra


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


async def _field_error_handler(_: Request, exc: FieldError) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content={"detail": GENERIC_VALIDATION_MESSAGE, "errors": {exc.field: exc.message}},
    )


async def _foreign_key_handler(_: Request, exc: pg_errors.ForeignKeyViolation) -> JSONResponse:
    # 소유권 확인 직후 다른 탭에서 프로젝트가 삭제되는 등 연결 대상이 바뀐 경우
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={"detail": "연결된 데이터가 변경되었습니다. 새로고침한 뒤 다시 시도해 주세요."},
    )


async def _conflict_handler(_: Request, exc: ConflictError) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content=jsonable_encoder({"detail": exc.message, "code": exc.code, **exc.extra}),
    )


async def _concurrent_change_handler(_: Request, exc: pg_errors.Error) -> JSONResponse:
    # 앱 검사 직후 다른 탭·기기에서 기록이 생겨 유일성·겹침 제약에 걸린 경우 (최후 방어선)
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={"detail": "다른 곳에서 기록이 바뀌었습니다. 새로고침한 뒤 다시 시도해 주세요.", "code": "concurrent_change"},
    )


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(RequestValidationError, _validation_handler)  # type: ignore[arg-type]
    app.add_exception_handler(ConflictError, _conflict_handler)  # type: ignore[arg-type]
    app.add_exception_handler(pg_errors.UniqueViolation, _concurrent_change_handler)  # type: ignore[arg-type]
    app.add_exception_handler(pg_errors.ExclusionViolation, _concurrent_change_handler)  # type: ignore[arg-type]
    app.add_exception_handler(pg_errors.CheckViolation, _check_violation_handler)  # type: ignore[arg-type]
    app.add_exception_handler(FieldError, _field_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(pg_errors.ForeignKeyViolation, _foreign_key_handler)  # type: ignore[arg-type]
