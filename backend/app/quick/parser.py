"""빠른 입력 한 줄 해석 (2026-11-27 사용자 확정: 규칙 해석 + 필요하면 AI).

예) "내일 오후 3시 발표 준비 1시간 #졸업작품 !높음"
    → 업무 '발표 준비', 마감 내일, 15:00–16:00 계획, 예상 60분, 프로젝트 졸업작품, 우선순위 높음

해석 규칙
- 종류: '이벤트:'로 시작하거나 제목이 시험·발표·출품·전시·마감으로 끝나면 이벤트 ('발표 준비'처럼 뒤에 말이 더 있으면 업무)
        매일·평일·주말·매주 X·격주 X·월수금·매월 N일·N일마다 → 반복 (제목에 '습관'이 있으면 습관)
- 날짜: 오늘·내일·모레·글피, N일 뒤/후, (이번 주·다음 주) X요일, M/D, M월 D일, YYYY-MM-DD
- 시각: 오전/오후/아침/저녁/밤 H시(반|M분), H:MM. '3시'처럼 오전·오후가 없으면 1~7시는 오후로 본다
- 범위: 3시~5시, 3시부터 5시까지, 14:00-15:30 / 길이: 1시간, 1시간 30분, 1시간반, 90분
- #프로젝트 (공백을 빼고 비교, 진행 중 프로젝트 우선) / !긴급 !높음 !보통 !낮음 (!!!·!!도)
해석에 쓴 말은 제목에서 뺀다. 저장 전에 화면에서 확인·수정한다.
"""

import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

WEEKDAYS = "월화수목금토일"  # Python weekday 0=월
EVENT_WORDS = {"시험": "exam", "발표": "presentation", "출품": "exhibition", "전시": "exhibition", "마감": "deadline"}
PRIORITY_WORDS = {"긴급": "urgent", "높음": "high", "중요": "high", "보통": "medium", "낮음": "low"}
PARTICLES = r"(?:에|에는|까지|부터|에서|의)?"


@dataclass
class Draft:
    kind: str = "task"  # task | event | routine
    title: str = ""
    day: date | None = None  # 업무: 마감일(+계획 날짜), 이벤트: 날짜, 반복: 시작일
    start_minute: int | None = None
    end_minute: int | None = None
    duration: int | None = None  # 분
    priority: str | None = None
    project_query: str | None = None
    event_kind: str | None = None
    mode: str = "task"  # 반복: task | habit
    freq: str | None = None
    weekdays: list[int] = field(default_factory=list)  # 0=일 … 6=토
    every_weeks: int = 1
    month_day: int | None = None
    interval_days: int | None = None
    matched: list[str] = field(default_factory=list)  # 해석한 말 (화면 표시용)


def _sun0(py_weekday: int) -> int:
    """Python 월=0 → 일=0 기준"""
    return (py_weekday + 1) % 7


def _cut(text: str, span: tuple[int, int]) -> str:
    return (text[: span[0]] + " " + text[span[1] :]).strip()


def _hour(meridiem: str | None, hour: int) -> int:
    if meridiem in ("오후", "저녁", "밤") and hour < 12:
        return hour + 12
    if meridiem in ("오전", "아침", "새벽") and hour == 12:
        return 0
    if meridiem is None and 1 <= hour <= 7:
        return hour + 12  # '3시' → 오후 3시
    return hour


_MERIDIEM = r"(오전|오후|아침|저녁|밤|새벽)?\s*"
_KTIME = _MERIDIEM + r"(\d{1,2})\s*시(?!간)\s*(반|(\d{1,2})\s*분)?"  # '1시간'은 시각이 아니라 길이
_CTIME = r"(\d{1,2}):(\d{2})"


def _parse_time(m: re.Match[str], offset: int = 0) -> int:
    """_KTIME 또는 _CTIME 매치 → 분"""
    groups = m.groups()[offset:]
    if len(groups) >= 2 and groups[1] is not None and ":" not in m.group(0):
        meridiem, hour, half, minute = groups[0], int(groups[1]), groups[2], groups[3]
        mins = 30 if half == "반" else int(minute) if minute else 0
        return _hour(meridiem, hour) * 60 + mins
    return int(groups[0]) * 60 + int(groups[1])


def parse(text: str, today: date) -> Draft:
    d = Draft()
    s = " ".join(text.split())

    # ---- 종류 접두어
    m = re.match(r"^(이벤트|일정|습관)\s*[:：]\s*", s)
    if m:
        if m.group(1) == "습관":
            d.kind, d.mode = "routine", "habit"
            d.freq = "daily"
        else:
            d.kind = "event"
        d.matched.append(m.group(1))
        s = s[m.end():]

    # ---- 우선순위 (!긴급, !!!)
    m = re.search(r"(?<!\S)!(긴급|높음|중요|보통|낮음)(?!\S)", s)
    if m:
        d.priority = PRIORITY_WORDS[m.group(1)]
        d.matched.append(m.group(0))
        s = _cut(s, m.span())
    else:
        m = re.search(r"(?<!\S)(!{2,3})(?!\S)", s)
        if m:
            d.priority = "urgent" if len(m.group(1)) == 3 else "high"
            d.matched.append(m.group(0))
            s = _cut(s, m.span())

    # ---- #프로젝트
    m = re.search(r"(?<!\S)#(\S+)", s)
    if m:
        d.project_query = m.group(1)
        d.matched.append(m.group(0))
        s = _cut(s, m.span())

    # ---- 반복 규칙
    if d.kind != "event":
        rules: list[tuple[str, Any]] = [
            (r"(\d{1,3})\s*일\s*마다", lambda m: ("interval", {"interval_days": int(m.group(1))})),
            (r"매월\s*(\d{1,2}|말)\s*일", lambda m: ("monthly", {"month_day": 31 if m.group(1) == "말" else int(m.group(1))})),
            (r"(매주|격주)\s*([월화수목금토일](?:\s*[,·/]?\s*[월화수목금토일])*)\s*(?:요일)?", lambda m: ("weekly", {
                "weekdays": sorted({_sun0(WEEKDAYS.index(c)) for c in re.sub(r"[^월화수목금토일]", "", m.group(2))}),
                "every_weeks": 2 if m.group(1) == "격주" else 1,
            })),
            (r"(?<!\S)([월화수목금토일]{2,7})(?!\S)", lambda m: ("weekly", {"weekdays": sorted({_sun0(WEEKDAYS.index(c)) for c in m.group(1)})})),
            (r"평일", lambda m: ("weekly", {"weekdays": [1, 2, 3, 4, 5]})),
            (r"주말", lambda m: ("weekly", {"weekdays": [0, 6]})),
            (r"매일", lambda m: ("daily", {})),
        ]
        for pattern, make in rules:
            m = re.search(pattern + PARTICLES, s)
            if m:
                freq, extra = make(m)
                d.kind, d.freq = "routine", freq
                for k, v in extra.items():
                    setattr(d, k, v)
                d.matched.append(m.group(0).strip())
                s = _cut(s, m.span())
                break

    # ---- 날짜
    date_rules: list[tuple[str, Any]] = [
        (r"(\d{4})-(\d{1,2})-(\d{1,2})", lambda m: date(int(m.group(1)), int(m.group(2)), int(m.group(3)))),
        (r"(\d{1,2})\s*월\s*(\d{1,2})\s*일", lambda m: _md(today, int(m.group(1)), int(m.group(2)))),
        (r"(?<![\d:])(\d{1,2})/(\d{1,2})(?![\d:])", lambda m: _md(today, int(m.group(1)), int(m.group(2)))),
        (r"(\d{1,2})\s*일\s*(?:뒤|후)", lambda m: today + timedelta(days=int(m.group(1)))),
        (r"글피", lambda m: today + timedelta(days=3)),
        (r"모레", lambda m: today + timedelta(days=2)),
        (r"내일", lambda m: today + timedelta(days=1)),
        (r"오늘", lambda m: today),
        (r"(이번\s*주|다음\s*주|담주)?\s*([월화수목금토일])요일", lambda m: _weekday(today, m.group(1), m.group(2))),
    ]
    for pattern, make in date_rules:
        m = re.search(pattern + PARTICLES, s)
        if m:
            try:
                d.day = make(m)
            except ValueError:
                continue  # 2월 30일 같은 없는 날짜
            d.matched.append(m.group(0).strip())
            s = _cut(s, m.span())
            break

    # ---- 시각 범위 / 시각
    rng = re.search(rf"(?:{_KTIME}|{_CTIME})\s*(?:~|-|–|부터)\s*(?:{_KTIME}|{_CTIME})\s*(?:까지)?", s)
    if rng:
        d.start_minute = _range_part(rng, 0)
        d.end_minute = _range_part(rng, 6)
        # '오후 3시~5시'처럼 뒤에 오전·오후가 없으면 앞을 따른다
        if d.end_minute is not None and d.start_minute is not None and d.end_minute <= d.start_minute and d.end_minute + 12 * 60 > d.start_minute:
            d.end_minute += 12 * 60
        d.matched.append(rng.group(0).strip())
        s = _cut(s, rng.span())
    else:
        m = re.search(_KTIME + PARTICLES, s) or re.search(_CTIME + PARTICLES, s)
        if m:
            d.start_minute = _parse_time(m)
            d.matched.append(m.group(0).strip())
            s = _cut(s, m.span())

    # ---- 길이
    m = re.search(r"(\d{1,2})\s*시간\s*(반|(\d{1,2})\s*분)?\s*(?:동안|간)?|(\d{1,3})\s*분\s*(?:동안|간)?", s)
    if m:
        if m.group(1):
            d.duration = int(m.group(1)) * 60 + (30 if m.group(2) == "반" else int(m.group(3)) if m.group(3) else 0)
        else:
            d.duration = int(m.group(4))
        d.matched.append(m.group(0).strip())
        s = _cut(s, m.span())
    if d.start_minute is not None and d.end_minute is None and d.duration:
        d.end_minute = d.start_minute + d.duration
    if d.start_minute is not None and d.end_minute is not None and d.duration is None:
        d.duration = d.end_minute - d.start_minute
    if d.end_minute is not None:
        d.end_minute = min(d.end_minute, 24 * 60)

    title = re.sub(r"\s+", " ", s).strip(" ,.-~")
    if d.kind == "routine" and "습관" in title and d.mode != "habit":
        d.mode = "habit"
        title = re.sub(r"\s*습관\s*", " ", title).strip()

    # ---- 이벤트 키워드 (제목이 그 말로 끝날 때만)
    if d.kind in ("task", "event"):
        for word, kind in EVENT_WORDS.items():
            if re.search(rf"{word}(?:일|날)?$", title):
                d.kind, d.event_kind = "event", kind
                break
    if d.kind == "event" and d.event_kind is None:
        d.event_kind = "other"
    d.title = title
    return d


def _md(today: date, month: int, day: int) -> date:
    """올해 그 날짜, 이미 지났으면 내년"""
    candidate = date(today.year, month, day)
    return candidate if candidate >= today else date(today.year + 1, month, day)


def _weekday(today: date, which: str | None, name: str) -> date:
    target = WEEKDAYS.index(name)
    if which and which.replace(" ", "") in ("다음주", "담주"):
        monday_next = today + timedelta(days=7 - today.weekday())
        return monday_next + timedelta(days=target)
    if which:  # 이번 주
        return today + timedelta(days=target - today.weekday())
    delta = (target - today.weekday()) % 7
    return today + timedelta(days=delta)


def _range_part(m: re.Match[str], offset: int) -> int | None:
    g = m.groups()[offset: offset + 6]  # (meridiem, hour, half, minute, hh, mm)
    if g[1] is not None:
        mins = 30 if g[2] == "반" else int(g[3]) if g[3] else 0
        return _hour(g[0], int(g[1])) * 60 + mins
    if g[4] is not None:
        return int(g[4]) * 60 + int(g[5])
    return None
