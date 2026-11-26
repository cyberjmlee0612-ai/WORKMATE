from datetime import date

from pydantic import BaseModel

from app.api.events import EventOut
from app.api.schedule import BlockOut
from app.schemas.project import ProjectOut
from app.schemas.task import TaskOut


class DashboardKpi(BaseModel):
    total_projects: int  # 보관(archived) 제외 — PRD 임시 기준
    active_projects: int  # 진행 중(planning/in_progress/review)
    total_tasks: int  # 프로젝트 업무 + 개인 업무
    completed_tasks: int
    progress: int  # completed ÷ total × 100, 정수 내림. 업무가 없으면 0


class DashboardOut(BaseModel):
    today: date
    kpi: DashboardKpi
    projects: list[ProjectOut]  # 진행 중 프로젝트, 최근 수정 순 최대 6개
    today_tasks: list[TaskOut]  # 마감일 ≤ 오늘인 미완료 + 오늘 완료한 업무, 최대 20개
    today_has_more: bool
    upcoming_events: list[EventOut]  # 오늘부터 60일 안, 가까운 순 최대 5개
    today_planned_minutes: int  # 오늘 시간표에 계획한 시간
    today_schedule: list[BlockOut]  # 오늘 요일의 반복 블록 (수업·쉬는 시간 등)
