"""AI 회고 (리포트 '분석 후기', 2026-11-26 사용자 요청: 선택 사항).

리포트 숫자만 보내고 잘한 점·아쉬운 점·다음 기간 제안을 받는다. 저장하지 않는다.
업무 제목과 프로젝트 이름은 보내지만, 업무 설명·메모는 보내지 않는다.
"""

from typing import Any

from pydantic import BaseModel, Field

from app.ai.provider import BreakdownProvider

MAX_POINTS = 3
POINT_MAX_LENGTH = 200


class AiReview(BaseModel):
    headline: str = Field(description="이 기간을 한 문장으로 요약")
    good: list[str] = Field(description="잘한 점 1~3개")
    improve: list[str] = Field(description="아쉬운 점 1~3개")
    suggestions: list[str] = Field(description="다음 기간에 해 볼 구체적인 행동 1~3개")


SYSTEM_PROMPT = """너는 한국어 업무 관리 서비스 WORKMATE의 회고 도우미다.
사용자의 기간 리포트 숫자를 보고 짧고 따뜻하지만 솔직한 회고를 쓴다.

규칙:
- 주어진 숫자에만 근거한다. 없는 사실을 지어내지 않는다.
- 각 항목은 한 문장, 가능하면 숫자를 인용한다 (예: "계획 12시간 중 9시간을 실제로 했어요").
- 이전 기간과 비교할 수 있으면 비교한다.
- 제안은 다음 기간에 바로 해 볼 수 있는 구체적인 행동으로.
- 기록이 적으면 그 사실을 아쉬운 점으로 짚고, 타이머·계획 사용을 제안한다.
- 존댓말(~요체)로 쓴다."""


def _h(minutes: int) -> str:
    hours, rest = divmod(minutes, 60)
    return f"{hours}시간 {rest}분" if hours else f"{rest}분"


def _rate(on_time: int, settled: int) -> str:
    return f"{on_time}/{settled} ({on_time * 100 // settled}%)" if settled else "해당 없음"


def build_prompt(report: dict[str, Any]) -> str:
    s, p = report["summary"], report["previous"]
    length = (report["end"] - report["start"]).days + 1
    lines = [
        f"기간: {report['start'].isoformat()} ~ {report['end'].isoformat()} ({length}일)",
        "",
        "지표 (이번 기간 / 이전 같은 길이 기간):",
        f"- 실제 기록 시간: {_h(s['tracked_minutes'])} / {_h(p['tracked_minutes'])}",
        f"- 계획한 시간: {_h(s['planned_minutes'])} / {_h(p['planned_minutes'])}",
        f"- 기록이 있는 날: {s['active_days']}일 / {p['active_days']}일",
        f"- 완료한 업무: {s['completed_tasks']}개 / {p['completed_tasks']}개",
        f"- 마감 지킴: {_rate(s['due_on_time'], s['due_settled'])} / {_rate(p['due_on_time'], p['due_settled'])}",
        f"- 마감이 지났는데 미완료: {s['due_overdue']}개",
        "",
        "날짜별 (날짜 | 계획 | 실제 | 완료):",
    ]
    lines += [f"- {d['day'].isoformat()} | {d['planned_minutes']}분 | {d['tracked_minutes']}분 | {d['completed_tasks']}개" for d in report["daily"]]

    roots = [r for r in report["projects"] if r["parent_id"] is None]
    lines += ["", "프로젝트별 실제/계획 시간 (하위 포함):"]
    lines += [f"- {r['name']}: {_h(r['tracked_minutes'])} / {_h(r['planned_minutes'])}" for r in roots[:10]] or ["- 없음"]
    personal = report["personal"]
    lines.append(f"- 개인 업무: {_h(personal['tracked_minutes'])} / {_h(personal['planned_minutes'])}")

    if report["top_tasks"]:
        lines += ["", "시간을 많이 쓴 업무:"]
        lines += [f"- {t['title']} ({t['project_path'] or '개인 업무'}): {_h(t['tracked_minutes'])}" for t in report["top_tasks"][:5]]

    est = report["estimates"]
    if est["measured_count"]:
        lines += ["", f"예상 vs 실제 (완료 업무 {est['measured_count']}개): 예상 합계 {_h(est['estimated_total'])}, 실제 합계 {_h(est['tracked_total'])}"]
        lines += [f"- {i['title']}: 예상 {i['estimated_minutes']}분, 실제 {i['tracked_minutes']}분" for i in est["items"][:5]]
    if est["unmeasured_count"]:
        lines.append(f"(예상 시간이 있지만 기록 없이 완료한 업무 {est['unmeasured_count']}개)")
    return "\n".join(lines)


def has_data(report: dict[str, Any]) -> bool:
    s = report["summary"]
    return bool(s["tracked_minutes"] or s["planned_minutes"] or s["completed_tasks"] or s["due_settled"])


def _clean(points: list[str]) -> list[str]:
    return [p.strip()[:POINT_MAX_LENGTH] for p in points if p and p.strip()][:MAX_POINTS]


def review(provider: BreakdownProvider, report: dict[str, Any]) -> dict[str, Any]:
    result = provider.generate(SYSTEM_PROMPT, build_prompt(report), AiReview)
    return {
        "headline": result.headline.strip()[:POINT_MAX_LENGTH],
        "good": _clean(result.good),
        "improve": _clean(result.improve),
        "suggestions": _clean(result.suggestions),
    }
