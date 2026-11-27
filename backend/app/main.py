from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import ai, checkins, daily_notes, dashboard, estimates, events, health, me, projects, reports, routines, schedule, tasks, time_entries, time_plans
from app.api import settings as settings_api
from app.core.config import get_settings
from app.core.errors import register_error_handlers
from app.db import close_pool, open_pool


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    open_pool(get_settings().database_url)
    try:
        yield
    finally:
        close_pool()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="WORKMATE API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,  # 쿠키가 아니라 Authorization 헤더로 인증
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )
    register_error_handlers(app)
    app.include_router(health.router)
    app.include_router(me.router)
    app.include_router(projects.router)
    app.include_router(tasks.router)
    app.include_router(dashboard.router)
    app.include_router(time_entries.timer_router)
    app.include_router(time_entries.entries_router)
    app.include_router(time_plans.router)
    app.include_router(daily_notes.router)
    app.include_router(reports.router)
    app.include_router(settings_api.router)
    app.include_router(schedule.router)
    app.include_router(events.router)
    app.include_router(checkins.router)
    app.include_router(estimates.router)
    app.include_router(routines.router)
    app.include_router(ai.router)
    return app


app = create_app()
