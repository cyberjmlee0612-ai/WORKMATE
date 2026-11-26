from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.task import TaskOut

# move   = (A) 선택한 업무는 개인 업무로 옮기고, 나머지 소속 업무와 프로젝트를 삭제
# delete = (C) 소속 업무와 프로젝트를 모두 삭제
# (B) 삭제 취소는 요청을 보내지 않는다
DeletionMode = Literal["move", "delete"]
# 하위 프로젝트 처리 (2026-11-26 사용자 확정): lift = 한 단계 위로 꺼내기(기본), delete = 그 안의 업무까지 함께 삭제
SubprojectMode = Literal["lift", "delete"]


class SubprojectSummary(BaseModel):
    id: UUID
    name: str
    status: str
    depth: int  # 1 = 바로 아래
    task_count: int  # 제외된 업무 포함


class DeletionPreview(BaseModel):
    project_id: UUID
    project_name: str
    parent_name: str | None  # 꺼낼 때 하위 프로젝트가 옮겨 갈 곳 (없으면 최상위)
    tasks: list[TaskOut]  # 제외(cancelled)된 업무 포함, 모든 소속 업무
    subprojects: list[SubprojectSummary]  # 모든 하위 프로젝트 (그 하위 포함)


class ProjectDeleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: DeletionMode
    # 사용자가 확인한 소속 업무 ID 전체. 서버의 현재 목록과 다르면 409로 다시 확인시킨다.
    expected_task_ids: list[UUID]
    # mode=move일 때 개인 업무로 옮길 업무
    keep_task_ids: list[UUID] = []
    subprojects: SubprojectMode = "lift"
    # 사용자가 확인한 하위 프로젝트 ID 전체. 다르면 409(subprojects_changed)
    expected_subproject_ids: list[UUID] = []

    @field_validator("expected_task_ids", "keep_task_ids", "expected_subproject_ids")
    @classmethod
    def _unique(cls, value: list[UUID]) -> list[UUID]:
        if len(set(value)) != len(value):
            raise ValueError("같은 업무가 중복되어 있습니다.")
        return value


BULK_MAX = 100


class ProjectBulkDelete(BaseModel):
    """편집 모드에서 여러 프로젝트 삭제. 업무·하위 처리 방법은 모든 선택에 똑같이 적용한다."""

    model_config = ConfigDict(extra="forbid")

    project_ids: list[UUID] = Field(min_length=1, max_length=BULK_MAX)
    tasks: DeletionMode  # move = 직접 속한 업무를 개인 업무로, delete = 함께 삭제
    subprojects: SubprojectMode = "lift"

    @field_validator("project_ids")
    @classmethod
    def _dedupe(cls, value: list[UUID]) -> list[UUID]:
        return list(dict.fromkeys(value))


class ProjectBulkDeleteResult(BaseModel):
    deleted_projects: int
    moved_tasks: int
    deleted_tasks: int
    lifted_subprojects: int
    deleted_subprojects: int


class ProjectMove(BaseModel):
    """편집 모드에서 여러 프로젝트를 parent_id 아래(null = 최상위)로 옮긴다."""

    model_config = ConfigDict(extra="forbid")

    project_ids: list[UUID] = Field(min_length=1, max_length=BULK_MAX)
    parent_id: UUID | None

    @field_validator("project_ids")
    @classmethod
    def _dedupe(cls, value: list[UUID]) -> list[UUID]:
        return list(dict.fromkeys(value))


class ProjectMoveResult(BaseModel):
    moved: int
    unchanged: int
    skipped: int  # 상위가 함께 선택되어 상위를 따라간 것
    missing: int


class ProjectDeleteResult(BaseModel):
    moved_tasks: int
    deleted_tasks: int  # 하위 프로젝트와 함께 지운 업무 포함
    lifted_subprojects: int = 0
    deleted_subprojects: int = 0


class TasksChangedResponse(BaseModel):
    detail: str
    code: Literal["tasks_changed"] = "tasks_changed"
    tasks: list[TaskOut]
