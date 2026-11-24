from uuid import UUID

from fastapi import APIRouter
from pydantic import BaseModel

from app.core.auth import CurrentUserDep
from app.db import UserDbDep

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
