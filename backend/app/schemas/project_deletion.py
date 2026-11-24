from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator

from app.schemas.task import TaskOut

# move   = (A) 선택한 업무는 개인 업무로 옮기고, 나머지 소속 업무와 프로젝트를 삭제
# delete = (C) 소속 업무와 프로젝트를 모두 삭제
# (B) 삭제 취소는 요청을 보내지 않는다
DeletionMode = Literal["move", "delete"]


class DeletionPreview(BaseModel):
    project_id: UUID
    project_name: str
    tasks: list[TaskOut]  # 제외(cancelled)된 업무 포함, 모든 소속 업무


class ProjectDeleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: DeletionMode
    # 사용자가 확인한 소속 업무 ID 전체. 서버의 현재 목록과 다르면 409로 다시 확인시킨다.
    expected_task_ids: list[UUID]
    # mode=move일 때 개인 업무로 옮길 업무
    keep_task_ids: list[UUID] = []

    @field_validator("expected_task_ids", "keep_task_ids")
    @classmethod
    def _unique(cls, value: list[UUID]) -> list[UUID]:
        if len(set(value)) != len(value):
            raise ValueError("같은 업무가 중복되어 있습니다.")
        return value


class ProjectDeleteResult(BaseModel):
    moved_tasks: int
    deleted_tasks: int


class TasksChangedResponse(BaseModel):
    detail: str
    code: Literal["tasks_changed"] = "tasks_changed"
    tasks: list[TaskOut]
