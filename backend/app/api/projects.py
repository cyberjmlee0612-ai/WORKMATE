from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import JSONResponse

from app.core.auth import CurrentUserDep
from app.core.errors import GENERIC_VALIDATION_MESSAGE
from app.db import UserDbDep
from app.repositories import projects as repo
from app.schemas.project import ProjectCreate, ProjectOut, ProjectUpdate

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
