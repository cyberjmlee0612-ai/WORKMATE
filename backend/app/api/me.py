from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from app.core.auth import CurrentUserDep
from app.db import UserDbDep, owner_transaction
from app.repositories import account

router = APIRouter(tags=["auth"])


class MeResponse(BaseModel):
    id: UUID
    email: str | None


class MeDbCheckResponse(MeResponse):
    db_uid: UUID | None
    db_role: str


@router.get("/me", response_model=MeResponse)
def read_me(user: CurrentUserDep) -> MeResponse:
    """토큰 검증만 수행. 프론트에서 세션이 유효한지 확인할 때 쓴다."""
    return MeResponse(id=user.id, email=user.email)


@router.get("/me/db-check", response_model=MeDbCheckResponse)
def read_me_db_check(user: CurrentUserDep, db: UserDbDep) -> MeDbCheckResponse:
    """DB 연결과 RLS 컨텍스트 확인용. db_uid가 id와 같고 db_role이 authenticated여야 한다."""
    row = db.execute("select auth.uid() as db_uid, current_user as db_role").fetchone()
    assert row is not None
    return MeDbCheckResponse(id=user.id, email=user.email, db_uid=row["db_uid"], db_role=row["db_role"])


class DeleteAccountRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=1, max_length=320)
    password: str = Field(min_length=1, max_length=200)


@router.post("/me/delete", status_code=status.HTTP_204_NO_CONTENT)
def delete_me(body: DeleteAccountRequest, user: CurrentUserDep) -> None:
    """계정과 모든 데이터를 삭제한다 (되돌릴 수 없음). 이메일·비밀번호를 다시 확인한다."""
    try:
        with owner_transaction() as db:
            account.delete_account(db, user.id, body.email, body.password)
    except account.TooManyAttempts as exc:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "확인에 여러 번 실패했어요. 10분 뒤 다시 시도해 주세요.") from exc
