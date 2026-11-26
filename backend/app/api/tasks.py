from uuid import UUID

from fastapi import APIRouter, HTTPException, Response, status

from app.core.auth import CurrentUserDep
from app.db import UserDbDep
from app.repositories import tasks as repo
from app.repositories import projects as project_repo
from app.schemas.task import TaskBulkCreate, TaskBulkDelete, TaskBulkDeleteResult, TaskCreate, TaskMove, TaskMoveResult, TaskOut, TaskPriority, TaskScope, TaskStatus, TaskUpdate

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
    include_subprojects: bool = False,
) -> list[dict]:
    """scope: all(전체) / project(프로젝트 업무) / personal(개인 업무). project_id를 주면 그 프로젝트의 업무만,
    include_subprojects=true면 하위 프로젝트 업무까지."""
    return repo.list_tasks(
        db, user.id, scope=scope, project_id=project_id, status=status, priority=priority, include_subprojects=include_subprojects,
    )


@router.post("", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
def create_task(body: TaskCreate, user: CurrentUserDep, db: UserDbDep) -> dict:
    return repo.create_task(db, user.id, body)


@router.post("/bulk", response_model=list[TaskOut], status_code=status.HTTP_201_CREATED)
def create_tasks_bulk(body: TaskBulkCreate, user: CurrentUserDep, db: UserDbDep) -> list[dict]:
    """여러 업무를 한 트랜잭션으로 저장 (AI 제안 승인용). 하나라도 실패하면 아무것도 저장하지 않는다.
    new_project가 있으면 프로젝트를 만들고 그 안에 저장한다 (프로젝트도 함께 롤백된다)."""
    tasks = body.tasks
    if body.new_project is not None:
        project = project_repo.create_project(db, user.id, body.new_project)
        tasks = [t.model_copy(update={"project_id": project["id"]}) for t in tasks]
    return [repo.create_task(db, user.id, task) for task in tasks]


@router.post("/bulk-delete", response_model=TaskBulkDeleteResult)
def delete_tasks_bulk(body: TaskBulkDelete, user: CurrentUserDep, db: UserDbDep) -> dict:
    """여러 업무를 한 번에 삭제 (편집 모드). 이미 없는 업무는 missing으로 센다."""
    return repo.delete_tasks(db, user.id, body.task_ids)


@router.post("/move", response_model=TaskMoveResult)
def move_tasks(body: TaskMove, user: CurrentUserDep, db: UserDbDep) -> dict:
    """여러 업무를 다른 프로젝트나 개인 업무(project_id=null)로 한 번에 옮긴다."""
    return repo.move_tasks(db, user.id, body.task_ids, body.project_id)


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
