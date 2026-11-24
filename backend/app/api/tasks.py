from uuid import UUID

from fastapi import APIRouter, HTTPException, Response, status

from app.core.auth import CurrentUserDep
from app.db import UserDbDep
from app.repositories import tasks as repo
from app.schemas.task import TaskCreate, TaskOut, TaskPriority, TaskScope, TaskStatus, TaskUpdate

router = APIRouter(prefix="/tasks", tags=["tasks"])

# 남의 업무도 "없음"과 같은 404로 응답해 존재 여부를 노출하지 않는다
_NOT_FOUND = HTTPException(status.HTTP_404_NOT_FOUND, "업무를 찾을 수 없습니다.")


@router.get("", response_model=list[TaskOut])
def list_tasks(
    user: CurrentUserDep,
    db: UserDbDep,
    scope: TaskScope = "all",
    project_id: UUID | None = None,
    status: TaskStatus | None = None,
    priority: TaskPriority | None = None,
) -> list[dict]:
    """scope: all(전체) / project(프로젝트 업무) / personal(개인 업무). project_id를 주면 그 프로젝트의 업무만."""
    return repo.list_tasks(db, user.id, scope=scope, project_id=project_id, status=status, priority=priority)


@router.post("", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
def create_task(body: TaskCreate, user: CurrentUserDep, db: UserDbDep) -> dict:
    return repo.create_task(db, user.id, body)


@router.get("/{task_id}", response_model=TaskOut)
def get_task(task_id: UUID, user: CurrentUserDep, db: UserDbDep) -> dict:
    task = repo.get_task(db, user.id, task_id)
    if task is None:
        raise _NOT_FOUND
    return task


@router.patch("/{task_id}", response_model=TaskOut)
def update_task(task_id: UUID, body: TaskUpdate, user: CurrentUserDep, db: UserDbDep) -> dict:
    task = repo.update_task(db, user.id, task_id, body)
    if task is None:
        raise _NOT_FOUND
    return task


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: UUID, user: CurrentUserDep, db: UserDbDep) -> Response:
    # 이미 삭제된 업무면 404. 클라이언트는 결과가 같으므로 성공으로 처리한다.
    if not repo.delete_task(db, user.id, task_id):
        raise _NOT_FOUND
    return Response(status_code=status.HTTP_204_NO_CONTENT)
