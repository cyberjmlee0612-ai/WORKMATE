from datetime import date
from uuid import UUID

from pydantic import BaseModel


class ReportTotals(BaseModel):
    tracked_minutes: int  # 기간 안 실제 기록(진행 중 타이머는 지금까지)
    planned_minutes: int  # 기간 안 계획 블록
    completed_tasks: int  # 기간 안에 완료한 업무
    active_days: int  # 기록이 있는 날 수
    due_settled: int  # 마감일이 기간 안이고 결과가 정해진 업무(완료했거나 마감이 지남)
    due_on_time: int  # 그중 마감일까지 완료
    due_overdue: int  # 마감이 지났는데 아직 미완료


class PreviousTotals(ReportTotals):
    start: date
    end: date


class ReportDay(BaseModel):
    day: date
    tracked_minutes: int
    planned_minutes: int
    completed_tasks: int


class ReportProject(BaseModel):
    id: UUID
    name: str
    parent_id: UUID | None  # 리포트에 함께 나온 상위 프로젝트 (없으면 최상위로 표시)
    status: str
    own_tracked_minutes: int
    own_planned_minutes: int
    tracked_minutes: int  # 하위 포함 합산
    planned_minutes: int


class ReportPersonal(BaseModel):
    tracked_minutes: int
    planned_minutes: int


class ReportTopTask(BaseModel):
    task_id: UUID
    title: str
    status: str
    project_path: str | None
    tracked_minutes: int
    planned_minutes: int


class EstimateItem(BaseModel):
    task_id: UUID
    title: str
    project_path: str | None
    estimated_minutes: int
    tracked_minutes: int


class ReportEstimates(BaseModel):
    items: list[EstimateItem]  # 차이가 큰 순, 최대 20개
    measured_count: int
    unmeasured_count: int
    estimated_total: int
    tracked_total: int


class ReportOut(BaseModel):
    start: date
    end: date
    previous: PreviousTotals
    summary: ReportTotals
    daily: list[ReportDay]
    projects: list[ReportProject]
    personal: ReportPersonal
    top_tasks: list[ReportTopTask]
    estimates: ReportEstimates
