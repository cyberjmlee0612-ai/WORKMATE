"""빠른 입력 한 줄 해석 규칙 테스트 (DB 없이)."""

from datetime import date

import pytest

from app.quick.parser import parse

TODAY = date(2026, 11, 27)  # 금요일


def test_full_task_sentence() -> None:
    d = parse("내일 오후 3시 발표 준비 1시간 #졸업작품 !높음", TODAY)
    assert (d.kind, d.title, d.day, d.start_minute, d.end_minute, d.duration) == ("task", "발표 준비", date(2026, 11, 28), 900, 960, 60)
    assert (d.project_query, d.priority) == ("졸업작품", "high")


@pytest.mark.parametrize(
    ("text", "start", "end"),
    [
        ("3시 회의", 900, None),          # 오전·오후 없이 1~7시는 오후
        ("9시 회의", 540, None),
        ("오전 11시 반 회의", 690, None),
        ("저녁 7시 20분 회의", 1160, None),
        ("14:30 회의", 870, None),
        ("3시~5시 회의", 900, 1020),
        ("오후 2시부터 4시 반까지 회의", 840, 990),
        ("10시~12시 회의", 600, 720),
        ("11시-1시 회의", 660, 780),
        ("14:00-15:30 회의", 840, 930),
    ],
)
def test_times(text: str, start: int, end: int | None) -> None:
    d = parse(text, TODAY)
    assert (d.start_minute, d.end_minute, d.title) == (start, end, "회의")


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("오늘 보고서", date(2026, 11, 27)),
        ("모레 보고서", date(2026, 11, 29)),
        ("3일 뒤 보고서", date(2026, 11, 30)),
        ("12/5 보고서", date(2026, 12, 5)),
        ("1월 3일까지 보고서", date(2027, 1, 3)),  # 지난 날짜는 내년
        ("2026-12-24 보고서", date(2026, 12, 24)),
        ("월요일 보고서", date(2026, 11, 30)),
        ("금요일 보고서", date(2026, 11, 27)),  # 오늘이 금요일
        ("다음 주 수요일 보고서", date(2026, 12, 2)),
        ("이번 주 목요일 보고서", date(2026, 11, 26)),
    ],
)
def test_dates(text: str, expected: date) -> None:
    d = parse(text, TODAY)
    assert (d.day, d.title) == (expected, "보고서")


def test_durations_and_priority() -> None:
    assert parse("메일 정리 30분", TODAY).duration == 30
    assert parse("자료 조사 1시간반", TODAY).duration == 90
    assert parse("자료 조사 2시간 15분 동안", TODAY).duration == 135
    assert parse("자료 조사 1시간", TODAY).start_minute is None  # '1시간'은 시각이 아님
    assert parse("버그 수정 !!!", TODAY).priority == "urgent"
    assert parse("버그 수정 !낮음", TODAY).priority == "low"
    d = parse("2시 리뷰 45분", TODAY)
    assert (d.start_minute, d.end_minute) == (840, 885)


def test_events() -> None:
    d = parse("12월 5일 오전 9시 정보처리기사 시험", TODAY)
    assert (d.kind, d.event_kind, d.title, d.day, d.start_minute) == ("event", "exam", "정보처리기사 시험", date(2026, 12, 5), 540)
    assert parse("금요일 졸업작품 출품", TODAY).event_kind == "exhibition"
    assert parse("발표 준비", TODAY).kind == "task"  # 뒤에 말이 더 있으면 업무
    d = parse("이벤트: 엄마 생일", TODAY)
    assert (d.kind, d.event_kind, d.title) == ("event", "other", "엄마 생일")


def test_routines() -> None:
    d = parse("매일 아침 7시 영어 단어 30분", TODAY)
    assert (d.kind, d.freq, d.start_minute, d.end_minute, d.title, d.mode) == ("routine", "daily", 420, 450, "영어 단어", "task")
    d = parse("월수금 헬스", TODAY)
    assert (d.freq, d.weekdays, d.title) == ("weekly", [1, 3, 5], "헬스")
    d = parse("격주 화요일 팀 회고 #팀", TODAY)
    assert (d.freq, d.weekdays, d.every_weeks, d.title, d.project_query) == ("weekly", [2], 2, "팀 회고", "팀")
    assert parse("매월 25일 가계부 정리", TODAY).month_day == 25
    assert parse("매월 말일 정산", TODAY).month_day == 31
    assert parse("3일마다 화분 물주기", TODAY).interval_days == 3
    assert parse("평일 메일 정리", TODAY).weekdays == [1, 2, 3, 4, 5]
    d = parse("매일 스트레칭 습관", TODAY)
    assert (d.mode, d.title) == ("habit", "스트레칭")
    d = parse("습관: 물 2L", TODAY)
    assert (d.kind, d.mode, d.freq, d.title) == ("routine", "habit", "daily", "물 2L")
