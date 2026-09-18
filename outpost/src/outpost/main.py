"""create_app(): the FastAPI application. `app` at module level is what uvicorn loads."""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request

from . import errors
from .config import Settings
from .connectors_driver import DevDriver
from .contract import CONTRACT_VERSION
from .db import Database
from .routers import audit, catalog, connectors, health, session
from .secrets import DevEnvelope

EXPECTED_CONTRACT = "1.0"


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    if CONTRACT_VERSION != EXPECTED_CONTRACT:
        raise RuntimeError(f"engine contract {CONTRACT_VERSION} != expected {EXPECTED_CONTRACT}")
    if len(settings.jwt_secret.encode()) < 32:
        raise RuntimeError("OUTPOST_JWT_SECRET must be at least 32 bytes")
    if not settings.is_dev:
        raise RuntimeError("only the dev envelope and dev driver exist yet; refuse to start outside dev")

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.settings = settings
        app.state.db = Database(settings)
        app.state.envelope = DevEnvelope()
        app.state.driver = DevDriver()
        await app.state.db.open()
        try:
            yield
        finally:
            await app.state.db.close()

    app = FastAPI(title="Outpost", version="0.0.1", lifespan=lifespan, docs_url="/docs" if settings.is_dev else None)

    @app.middleware("http")
    async def request_id(request: Request, call_next):
        request.state.request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        response = await call_next(request)
        response.headers["x-request-id"] = request.state.request_id
        return response

    errors.install(app)
    prefix = "/api/v1"
    app.include_router(health.router)
    for r in (session.router, connectors.router, catalog.router, audit.router):
        app.include_router(r, prefix=prefix)
    return app


try:
    app = create_app()
except KeyError:
    app = None  # imported without env (tests build their own); uvicorn needs the env set
