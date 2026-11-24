from datetime import date
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Query

from app.core.auth import CurrentUserDep
from app.core.errors import FieldError
from app.db import UserDbDep
from app.repositories import dashboard as repo
from app.schemas.dashboard import DashboardOut

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("", response_model=DashboardOut)
def get_dashboard(
    user: CurrentUserDep,
    db: UserDbDep,
    today: date = Query(description="사용자 기기 기준 오늘 날짜 (YYYY-MM-DD)"),
    tz: str = Query("UTC", max_length=64, description="IANA 시간대, 예: Asia/Seoul"),
) -> dict:
    # 서버는 UTC로 동작하므로 '오늘'은 사용자 기준 값을 받는다 (한국 0~9시에 하루 어긋나는 문제 방지)
    try:
        ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise FieldError("tz", "알 수 없는 시간대입니다.") from exc
    return repo.get_dashboard(db, user.id, today, tz)
