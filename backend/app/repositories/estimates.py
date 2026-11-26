"""예상 시간 자동 보정 (2026-11-26 사용자 확정).

최근 60일 안에 완료했고 예상 시간과 실제 기록(끝난 기록)이 모두 있는 업무로 '실제 합계 ÷ 예상 합계'를 구한다.
짧은 일(예상 1시간 미만)과 긴 일(1시간 이상)을 따로 계산하고, 구간마다 5개 이상일 때만 쓴다.
비율은 0.5~3배로 제한하고, 0.9~1.1배면 보정하지 않는다(차이가 작음). 보정값은 5분 단위.
"""

from typing import Any
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow

LOOKBACK_DAYS = 60
MIN_SAMPLES = 5
SHORT_LIMIT = 60  # 이 분 미만이면 짧은 일
RATIO_MIN, RATIO_MAX = 0.5, 3.0
NEUTRAL = (0.9, 1.1)
ROUND = 5


def calibration(db: Connection[DictRow], user_id: UUID) -> dict[str, Any]:
    rows = db.execute(
        """
        select t.estimated_minutes as est,
          (select floor(sum(extract(epoch from e.ended_at - e.started_at)) / 60)::int
           from public.task_time_entries e
           where e.task_id = t.id and e.user_id = t.user_id and e.ended_at is not null) as tracked
        from public.tasks t
        where t.user_id = %s and t.status = 'completed' and t.estimated_minutes is not null
          and t.completed_at >= now() - make_interval(days => %s)
        """,
        (user_id, LOOKBACK_DAYS),
    ).fetchall()
    samples = [(r["est"], r["tracked"]) for r in rows if r["tracked"]]

    def bucket(items: list[tuple[int, int]]) -> dict[str, Any]:
        est = sum(e for e, _ in items)
        tracked = sum(t for _, t in items)
        ratio = None
        if len(items) >= MIN_SAMPLES and est > 0:
            ratio = round(min(RATIO_MAX, max(RATIO_MIN, tracked / est)), 2)
        return {"ratio": ratio, "samples": len(items)}

    return {
        "short": bucket([s for s in samples if s[0] < SHORT_LIMIT]),
        "long": bucket([s for s in samples if s[0] >= SHORT_LIMIT]),
        "overall": bucket(samples),
        "lookback_days": LOOKBACK_DAYS,
        "min_samples": MIN_SAMPLES,
        "short_limit": SHORT_LIMIT,
    }


def adjust(minutes: int | None, cal: dict[str, Any]) -> int | None:
    """보정한 예상 시간. 보정할 근거가 없거나 차이가 작으면 None."""
    if not minutes:
        return None
    ratio = cal["short" if minutes < SHORT_LIMIT else "long"]["ratio"]
    if ratio is None or NEUTRAL[0] <= ratio <= NEUTRAL[1]:
        return None
    return max(ROUND, int(round(minutes * ratio / ROUND)) * ROUND)
