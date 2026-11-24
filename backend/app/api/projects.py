from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import JSONResponse

from app.core.auth import CurrentUserDep
from app.core.errors import GENERIC_VALIDATION_MESSAGE
from app.db import UserDbDep
from app.repositories import project_deletion as deletion_repo
from app.repositories import projects as repo
from app.schemas.project import ProjectCreate, ProjectOut, ProjectUpdate
from app.schemas.project_deletion import DeletionPreview, ProjectDeleteRequest, ProjectDeleteResult, TasksChangedResponse

router = APIRouter(prefix="/projects", tags=["projects"])

# 남의 프로젝트도 "없음"과 같은 404로 응답해 존재 여부를 노출하지 않는다
_NOT_FOUND = HTTPException(status.HTTP_404_NOT_FOUND, "프로젝트를 찾을 수 없습니다.")


@router.get("", response_model=list[ProjectOut])
def list_projects(user: CurrentUserDep, db: UserDbDep) -> list[dict]:
    return repo.list_projects(db, user.id)


@router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
def create_project(body: ProjectCreate, user: CurrentUserDep, db: UserDbDep) -> dict:
    return repo.create_project(db, user.id, body)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: UUID, user: CurrentUserDep, db: UserDbDep) -> dict:
    project = repo.get_project(db, user.id, project_id)
    if project is None:
        raise _NOT_FOUND
    return project


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(project_id: UUID, body: ProjectUpdate, user: CurrentUserDep, db: UserDbDep):
    try:
        project = repo.update_project(db, user.id, project_id, body)
    except ValueError as exc:  # 기존 값과 합친 날짜 순서 오류
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": GENERIC_VALIDATION_MESSAGE, "errors": {"due_date": str(exc)}},
        )
    if project is None:
        raise _NOT_FOUND
    return project


@router.get("/{project_id}/deletion-preview", response_model=DeletionPreview)
def get_deletion_preview(project_id: UUID, user: CurrentUserDep, db: UserDbDep) -> dict:
    """삭제 대화상자용: 프로젝트의 모든 소속 업무(제외된 업무 포함)."""
    preview = deletion_repo.get_preview(db, user.id, project_id)
    if preview is None:
        raise _NOT_FOUND
    return preview


# DELETE에 본문을 싣지 않도록 POST로 받는다 (일부 프록시·클라이언트가 DELETE 본문을 버린다)
@router.post(
    "/{project_id}/delete",
    response_model=ProjectDeleteResult,
    responses={409: {"model": TasksChangedResponse, "description": "확인한 업무 목록이 바뀜 — 최신 목록으로 다시 확인"}},
)
def delete_project(project_id: UUID, body: ProjectDeleteRequest, user: CurrentUserDep, db: UserDbDep):
    try:
        return deletion_repo.delete_project(db, user.id, project_id, body)
    except deletion_repo.ProjectNotFound:
        # 이미 삭제됐거나 남의 프로젝트. 클라이언트는 결과가 같으므로 성공으로 처리한다.
        raise _NOT_FOUND from None
    except deletion_repo.TasksChanged as changed:
        # 이 시점까지 데이터는 바뀌지 않았다(잠금·조회만 수행)
        payload = TasksChangedResponse(
            detail="다른 곳에서 이 프로젝트의 업무가 변경되었습니다. 최신 목록을 다시 확인해 주세요.",
            tasks=changed.tasks,  # type: ignore[arg-type]
        )
        return JSONResponse(status_code=status.HTTP_409_CONFLICT, content=payload.model_dump(mode="json"))
