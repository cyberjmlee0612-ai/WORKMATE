"""예상 시간 보정 API.

GET /estimates/calibration   내 보정 비율 (짧은 일·긴 일·전체, 근거 업무 수)
"""

from fastapi import APIRouter
from pydantic import BaseModel

from app.core.auth import CurrentUserDep
from app.db import UserDbDep
from app.repositories import estimates as repo

router = APIRouter(prefix="/estimates", tags=["estimates"])


class Bucket(BaseModel):
    ratio: float | None  # 실제 ÷ 예상 (근거가 모자라면 null)
    samples: int


class CalibrationOut(BaseModel):
    short: Bucket
    long: Bucket
    overall: Bucket
    lookback_days: int
    min_samples: int
    short_limit: int


@router.get("/calibration", response_model=CalibrationOut)
def get_calibration(user: CurrentUserDep, db: UserDbDep) -> dict:
    return repo.calibration(db, user.id)
