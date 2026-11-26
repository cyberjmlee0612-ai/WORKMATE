"""리포트 API.

GET /reports?start=YYYY-MM-DD&end=YYYY-MM-DD&tz=Asia/Seoul   (end 포함, 최대 92일)
"""

from datetime import date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Query

from app.core.auth import CurrentUserDep
from app.core.errors import FieldError
from app.db import UserDbDep
from app.repositories import reports as repo
from app.schemas.report import ReportOut

router = APIRouter(prefix="/reports", tags=["reports"])


def validate_period(start: date, end: date, tz: str) -> date:
    """기간·시간대를 검사하고 사용자 기준 오늘 날짜를 돌려준다."""
    try:
        today = datetime.now(ZoneInfo(tz)).date()
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise FieldError("tz", "알 수 없는 시간대입니다.") from exc
    if end < start:
        raise FieldError("end", "끝 날짜는 시작 날짜와 같거나 뒤여야 해요.")
    if (end - start).days + 1 > repo.MAX_DAYS:
        raise FieldError("end", f"기간은 최대 {repo.MAX_DAYS}일까지 볼 수 있어요.")
    return today


@router.get("", response_model=ReportOut)
def get_report(
    user: CurrentUserDep,
    db: UserDbDep,
    start: date = Query(description="시작 날짜 (사용자 시간대)"),
    end: date = Query(description="끝 날짜 (포함)"),
    tz: str = Query("UTC", max_length=64, description="IANA 시간대"),
) -> dict:
    today = validate_period(start, end, tz)
    return repo.get_report(db, user.id, start, end, tz, today)
