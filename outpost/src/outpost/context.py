"""The tenant middleware, as FastAPI dependencies.

get_ctx:   Bearer token -> verified claims -> live session -> RequestContext. Rejects any tenant_id
           in the path, the query string, or a JSON body with 400 tenant_id_not_allowed.
session:   one transaction on the outpost_app pool with SET LOCAL app.* from the context.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator
from typing import Any
from uuid import UUID

from fastapi import Depends, Request

from . import auth
from .config import Settings
from .contract import RequestContext, Role
from .db import Database, TenantSession, scoped
from .errors import Problem

FORBIDDEN_KEY = "tenant_id"


def _contains_key(value: Any, key: str) -> bool:
    if isinstance(value, dict):
        return any(k == key or _contains_key(v, key) for k, v in value.items())
    if isinstance(value, list):
        return any(_contains_key(v, key) for v in value)
    return False


async def forbid_tenant_id(request: Request) -> None:
    if FORBIDDEN_KEY in request.path_params or FORBIDDEN_KEY in request.query_params:
        raise Problem(400, "tenant_id_not_allowed", "Bad request", "tenant identity comes from the token only")
    if request.headers.get("content-type", "").startswith("application/json"):
        body = await request.body()
        if body:
            try:
                parsed = json.loads(body)
            except ValueError:
                return  # validation will report the malformed body
            if _contains_key(parsed, FORBIDDEN_KEY):
                raise Problem(400, "tenant_id_not_allowed", "Bad request", "tenant identity comes from the token only")


def settings_of(request: Request) -> Settings:
    return request.app.state.settings


def db_of(request: Request) -> Database:
    return request.app.state.db


async def get_ctx(request: Request, _: None = Depends(forbid_tenant_id)) -> RequestContext:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        raise Problem(401, "token_missing", "Unauthorized")
    claims = auth.verify(settings_of(request), header[7:].strip())
    sid = UUID(claims["sid"])
    async with db_of(request).app.connection() as conn:
        if not await auth.session_is_live(conn, sid):
            raise Problem(401, "session_revoked", "Unauthorized", "sign in again")
    ctx = RequestContext(
        acting_tenant=UUID(claims["acting_tenant"]),
        home_tenant=UUID(claims["home_tenant"]),
        actor_user=UUID(claims["sub"]),
        role=Role(claims["role"]),
        session_id=sid,
        request_id=getattr(request.state, "request_id", None) or str(uuid.uuid4()),
        engagement_id=UUID(claims["engagement_id"]) if claims.get("engagement_id") else None,
    )
    request.state.ctx = ctx
    return ctx


async def session(request: Request, ctx: RequestContext = Depends(get_ctx)) -> AsyncIterator[TenantSession]:
    async for s in scoped(db_of(request), ctx):
        yield s
