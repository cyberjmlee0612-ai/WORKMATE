"""아침 체크인 / 저녁 마무리 API (2026-11-26 사용자 확정).

GET  /checkins/{day}?tz=           그날 꼭 할 일·회고·추천 후보
PUT  /checkins/{day}/focus         꼭 할 일 정하기 (최대 3개, 순서대로)
POST /checkins/{day}/review        저녁 마무리: 못 한 일 처리(내일 다시/마감일 미루기/그대로) + 기분·한 줄 회고
GET  /checkins/{day}/placement     꼭 할 일을 시간표 빈칸에 넣는 제안 (AI 없음, 저장하지 않음 → /time-plans/bulk로 저장)

day는 사용자 시간대의 달력 날짜. 완료 체크는 기존 업무 API로 한다.
"""

from datetime import date, datetime, timedelta
from typing import Any, Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Query
from psycopg import Connection
from psycopg.rows import DictRow
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.auth import CurrentUserDep
from app.core.errors import FieldError
from app.db import UserDbDep
from app.repositories import estimates as estimate_repo
from app.repositories import slots
from app.repositories import tasks as task_repo
from app.schemas.task import TaskOut

router = APIRouter(prefix="/checkins", tags=["checkins"])

MAX_FOCUS = 3
SUGGESTION_LIMIT = 8
RETRY_LOOKBACK_DAYS = 7
NOTE_MAX = 500
SNAP = slots.SNAP
BUFFER = slots.BUFFER
DEFAULT_MINUTES = 60
MAX_BLOCK_MINUTES = 180


# ---------------------------------------------------------------- 스키마


class FocusItem(BaseModel):
    position: int
    outcome: Literal["done", "retry", "postponed", "kept"] | None
    task: TaskOut


class Suggestion(BaseModel):
    reason: str
    task: TaskOut


class ReviewOut(BaseModel):
    mood: int | None
    note: str | None


class CheckinOut(BaseModel):
    date: date
    focus: list[FocusItem]
    review: ReviewOut | None
    suggestions: list[Suggestion]


class FocusIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_ids: list[UUID] = Field(max_length=MAX_FOCUS)

    @field_validator("task_ids", mode="after")
    @classmethod
    def _unique(cls, value: list[UUID]) -> list[UUID]:
        if len(set(value)) != len(value):
            raise ValueError("같은 업무를 두 번 고를 수 없어요.")
        return value


class OutcomeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: UUID
    outcome: Literal["retry", "postponed", "kept"]
    due_date: date | None = None  # postponed일 때 새 마감일


class ReviewIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mood: int | None = Field(None, ge=1, le=5)
    note: str | None = None
    outcomes: list[OutcomeIn] = Field(default_factory=list, max_length=MAX_FOCUS)

    @field_validator("note", mode="after")
    @classmethod
    def _note(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if len(value) > NOTE_MAX:
            raise ValueError(f"회고는 {NOTE_MAX}자 이하로 입력해 주세요.")
        return value or None


class PlacementBlock(BaseModel):
    task_id: UUID
    task_title: str
    starts_at: datetime
    ends_at: datetime


class PlacementOut(BaseModel):
    blocks: list[PlacementBlock]
    unplaced: list[str]  # 빈칸이 모자라 넣지 못한 업무 제목


# ---------------------------------------------------------------- 조회


def _focus_rows(db: Connection[DictRow], user_id: UUID, day: date) -> list[dict[str, Any]]:
    rows = db.execute(
        "select task_id, position, outcome from public.daily_focus where user_id = %s and focus_date = %s order by position",
        (user_id, day),
    ).fetchall()
    out = []
    for r in rows:
        task = task_repo.get_task(db, user_id, r["task_id"])
        if task is not None:
            out.append({"position": r["position"], "outcome": r["outcome"], "task": task})
    return out


def _suggestions(db: Connection[DictRow], user_id: UUID, day: date, exclude: set[UUID]) -> list[dict[str, Any]]:
    """추천 순서: 지난 마무리에서 '내일 다시'로 정한 일 → 마감 지남 → 오늘 마감 → 3일 안 마감 → 우선순위 높음 → 진행 중."""
    open_tasks = [t for t in task_repo.list_tasks(db, user_id) if t["status"] != "completed" and t["id"] not in exclude]
    retry_ids = {
        r["task_id"]
        for r in db.execute(
            """
            select distinct task_id from public.daily_focus
            where user_id = %s and outcome = 'retry' and focus_date < %s and focus_date >= %s
            """,
            (user_id, day, day - timedelta(days=RETRY_LOOKBACK_DAYS)),
        ).fetchall()
    }

    def reason(t: DictRow) -> tuple[int, str] | None:
        due = t["due_date"]
        if t["id"] in retry_ids:
            return 0, "지난번에 '다시 하기'로 한 일"
        if due is not None and due < day:
            return 1, "마감이 지났어요"
        if due == day:
            return 2, "오늘 마감"
        if due is not None and (due - day).days <= 3:
            return 3, f"마감 D-{(due - day).days}"
        if t["priority"] in ("urgent", "high"):
            return 4, "우선순위 높음"
        if t["status"] == "in_progress":
            return 5, "진행 중"
        return None

    ranked = [(r, i, t) for i, t in enumerate(open_tasks) if (r := reason(t)) is not None]
    ranked.sort(key=lambda x: (x[0][0], x[1]))  # 같은 순위면 기존 목록 순서(마감·우선순위)
    picked = [{"reason": r[1], "task": t} for r, _, t in ranked[:SUGGESTION_LIMIT]]
    if len(picked) < SUGGESTION_LIMIT:  # 부족하면 나머지 업무로 채운다
        chosen = {p["task"]["id"] for p in picked}
        picked += [{"reason": "남은 업무", "task": t} for t in open_tasks if t["id"] not in chosen][: SUGGESTION_LIMIT - len(picked)]
    return picked


def read_checkin(db: Connection[DictRow], user_id: UUID, day: date) -> dict[str, Any]:
    focus = _focus_rows(db, user_id, day)
    review = db.execute("select mood, note from public.daily_reviews where user_id = %s and review_date = %s", (user_id, day)).fetchone()
    return {
        "date": day,
        "focus": focus,
        "review": review,
        "suggestions": _suggestions(db, user_id, day, {f["task"]["id"] for f in focus}),
    }


@router.get("/{day}", response_model=CheckinOut)
def get_checkin(day: date, user: CurrentUserDep, db: UserDbDep) -> dict:
    return read_checkin(db, user.id, day)


# ---------------------------------------------------------------- 아침: 꼭 할 일


@router.put("/{day}/focus", response_model=CheckinOut)
def put_focus(day: date, body: FocusIn, user: CurrentUserDep, db: UserDbDep) -> dict:
    for task_id in body.task_ids:
        task = task_repo.get_task(db, user.id, task_id)
        if task is None:
            raise FieldError("task_ids", "업무를 찾을 수 없어요. 새로고침해 주세요.")
        if task["status"] == "cancelled":
            raise FieldError("task_ids", f"제외한 업무는 고를 수 없어요: {task['title']}")
    # 다시 고른 업무는 저녁에 정한 결과를 그대로 둔다
    kept = {
        r["task_id"]: r["outcome"]
        for r in db.execute("select task_id, outcome from public.daily_focus where user_id = %s and focus_date = %s", (user.id, day)).fetchall()
    }
    db.execute("delete from public.daily_focus where user_id = %s and focus_date = %s", (user.id, day))
    for position, task_id in enumerate(body.task_ids, start=1):
        db.execute(
            "insert into public.daily_focus (user_id, focus_date, task_id, position, outcome) values (%s, %s, %s, %s, %s)",
            (user.id, day, task_id, position, kept.get(task_id)),
        )
    return read_checkin(db, user.id, day)


# ---------------------------------------------------------------- 저녁: 마무리


@router.post("/{day}/review", response_model=CheckinOut)
def post_review(day: date, body: ReviewIn, user: CurrentUserDep, db: UserDbDep) -> dict:
    focus_ids = {
        r["task_id"] for r in db.execute("select task_id from public.daily_focus where user_id = %s and focus_date = %s", (user.id, day)).fetchall()
    }
    for item in body.outcomes:
        if item.task_id not in focus_ids:
            raise FieldError("outcomes", "그날 고른 업무만 정할 수 있어요. 새로고침해 주세요.")
        if item.outcome == "postponed":
            if item.due_date is None or item.due_date <= day:
                raise FieldError("outcomes", "미룰 마감일은 오늘 이후로 골라 주세요.")
            db.execute("update public.tasks set due_date = %s where user_id = %s and id = %s", (item.due_date, user.id, item.task_id))
        db.execute(
            "update public.daily_focus set outcome = %s where user_id = %s and focus_date = %s and task_id = %s",
            (item.outcome, user.id, day, item.task_id),
        )
    # 완료한 업무는 '완료'로 기록 (완료 체크는 업무 API로 이미 저장됨)
    db.execute(
        """
        update public.daily_focus f set outcome = 'done'
        from public.tasks t
        where f.user_id = %s and f.focus_date = %s and t.id = f.task_id and t.user_id = f.user_id and t.status = 'completed'
        """,
        (user.id, day),
    )
    db.execute(
        """
        insert into public.daily_reviews (user_id, review_date, mood, note) values (%s, %s, %s, %s)
        on conflict (user_id, review_date) do update set mood = excluded.mood, note = excluded.note
        """,
        (user.id, day, body.mood, body.note),
    )
    return read_checkin(db, user.id, day)


# ---------------------------------------------------------------- 시간표 빈칸 배치 (선택)


_free_gaps = slots.free_gaps


def place(
    tasks: list[dict[str, Any]],
    windows: list[tuple[int, int]],
    taken: list[tuple[int, int]],
    not_before: int,
    calibration: dict[str, Any] | None = None,
) -> tuple[list[tuple[dict, int, int]], list[dict]]:
    """업무마다 (예상 시간 - 기록한 시간, 없으면 60분)을 10분 단위로 맞춰 가장 이른 빈칸에 넣는다. 맞는 빈칸이 없으면 넣지 않는다.
    calibration이 있으면 예상 시간 대신 보정한 예상 시간을 쓴다 (2026-11-26 사용자 확정)."""
    taken = list(taken)
    placed: list[tuple[dict, int, int]] = []
    unplaced: list[dict] = []
    for task in tasks:
        estimate = task["estimated_minutes"]
        if estimate and calibration:
            estimate = estimate_repo.adjust(estimate, calibration) or estimate
        remaining = (estimate or 0) - (task["tracked_minutes"] or 0)
        minutes = remaining if task["estimated_minutes"] and remaining >= 30 else (30 if task["estimated_minutes"] else DEFAULT_MINUTES)
        minutes = min(MAX_BLOCK_MINUTES, -(-minutes // SNAP) * SNAP)
        gap = next(((a, b) for a, b in _free_gaps(windows, taken, not_before) if b - a >= minutes), None)
        if gap is None:
            unplaced.append(task)
            continue
        start = gap[0]
        placed.append((task, start, start + minutes))
        taken.append((start, start + minutes + BUFFER))
    return placed, unplaced


@router.get("/{day}/placement", response_model=PlacementOut)
def get_placement(day: date, user: CurrentUserDep, db: UserDbDep, tz: str = Query("UTC", max_length=64)) -> dict:
    try:
        ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise FieldError("tz", "알 수 없는 시간대입니다.") from exc
    day_start, day_end = slots.day_bounds(day, tz)
    windows, _ = slots.day_ranges(db, user.id, day)
    taken = slots.taken_ranges(db, user.id, day, tz)
    not_before = slots.not_before_minute(day, tz)

    # 그날 이미 계획이 있는 업무는 빼고, 완료한 업무도 뺀다
    planned_ids = {
        r["task_id"]
        for r in db.execute(
            """select distinct task_id from public.task_time_plans
               where user_id = %s and starts_at < %s and ends_at > %s and (resolution is null or resolution = 'done')""",
            (user.id, day_end, day_start),
        ).fetchall()
    }
    tasks = [f["task"] for f in _focus_rows(db, user.id, day) if f["task"]["status"] != "completed" and f["task"]["id"] not in planned_ids]
    placed, unplaced = place(tasks, windows, taken, not_before, estimate_repo.calibration(db, user.id))
    return {
        "blocks": [
            {"task_id": t["id"], "task_title": t["title"], "starts_at": day_start + timedelta(minutes=a), "ends_at": day_start + timedelta(minutes=b)}
            for t, a, b in placed
        ],
        "unplaced": [t["title"] for t in unplaced],
    }
