"""GET /session, POST /session/switch, POST /session/return, DELETE /session, POST /session/dev-login (dev only)."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from .. import audit, auth
from ..authz import authorize
from ..context import db_of, get_ctx, session, settings_of
from ..contract import RequestContext, Role
from ..db import SET_IDENTITY, TenantSession
from ..errors import Problem, forbidden

router = APIRouter(prefix="/session", tags=["session"])


class SwitchRequest(BaseModel):
    engagement_id: UUID


class DevLogin(BaseModel):
    idp_subject: str


async def _tenant_ref(conn, tenant_id: UUID) -> dict:
    cur = await conn.execute("select id, kind, name, slug from platform.tenants where id = %s", (tenant_id,))
    row = await cur.fetchone()
    return {**row, "id": str(row["id"])}


@router.get("")
async def whoami(request: Request, ctx: RequestContext = Depends(get_ctx)) -> dict:
    async with db_of(request).app.connection() as conn:
        return {
            "user_id": str(ctx.actor_user),
            "home_tenant": await _tenant_ref(conn, ctx.home_tenant),
            "acting_tenant": await _tenant_ref(conn, ctx.acting_tenant),
            "role": ctx.role.value,
            "engagement_id": str(ctx.engagement_id) if ctx.engagement_id else None,
            "break_glass_grant": None,
        }


async def _rotate(request: Request, ctx: RequestContext, *, acting: UUID, role: Role, engagement_id: UUID | None, action: str) -> dict:
    """Mint a new session, revoke the old one, and write the event to the new acting chain and the home chain."""
    settings = settings_of(request)
    async with db_of(request).app.connection() as conn:
        async with conn.transaction():
            sid = await auth.create_session(
                conn,
                user_id=ctx.actor_user,
                home_tenant=ctx.home_tenant,
                acting_tenant=acting,
                role=role,
                engagement_id=engagement_id,
                ttl_seconds=settings.token_ttl_seconds,
            )
            await auth.revoke_session(conn, ctx.session_id, action)
            new_ctx = RequestContext(
                acting_tenant=acting,
                home_tenant=ctx.home_tenant,
                actor_user=ctx.actor_user,
                role=role,
                session_id=sid,
                request_id=ctx.request_id,
                engagement_id=engagement_id,
            )
            await conn.execute(SET_IDENTITY, {"acting": str(acting), "home": str(ctx.home_tenant), "user": str(ctx.actor_user)})
            await audit.record(
                TenantSession(conn, new_ctx),
                action,
                resource_kind="tenant",
                resource_id=acting,
                detail={"from": str(ctx.acting_tenant), "previous_sid": str(ctx.session_id)},
                both_chains=True,
            )
    token, exp = auth.issue(
        settings, user_id=ctx.actor_user, home_tenant=ctx.home_tenant, acting_tenant=acting, role=role, sid=sid, engagement_id=engagement_id
    )
    return {
        "access_token": token,
        "expires_at": exp.isoformat(),
        "session": {"acting_tenant": str(acting), "role": role.value, "engagement_id": str(engagement_id) if engagement_id else None},
    }


@router.post("/switch")
async def switch(body: SwitchRequest, request: Request, ctx: RequestContext = Depends(get_ctx)) -> dict:
    authorize(ctx, "session.switch")
    if ctx.is_cross_tenant:
        raise forbidden("already_acting", "return to your home tenant before switching again")
    async with db_of(request).app.connection() as conn:
        cur = await conn.execute(
            """select a.role as assignment_role, e.customer_tenant_id
                 from platform.engagement_assignments a
                 join platform.engagements e on e.id = a.engagement_id
                where a.engagement_id = %s and a.user_id = %s and a.revoked_at is null
                  and e.firm_tenant_id = %s and e.status = 'active' and now() between e.starts_at and e.ends_at""",
            (body.engagement_id, ctx.actor_user, ctx.home_tenant),
        )
        row = await cur.fetchone()
    if row is None:
        raise forbidden("assignment_inactive", "no active assignment on that engagement")
    role = Role.CONSULTANT_LEAD if row["assignment_role"] == "lead" else Role.CONSULTANT_ANALYST
    return await _rotate(request, ctx, acting=row["customer_tenant_id"], role=role, engagement_id=body.engagement_id, action="session.switch")


@router.post("/return")
async def return_home(request: Request, ctx: RequestContext = Depends(get_ctx)) -> dict:
    if not ctx.is_cross_tenant:
        raise Problem(409, "already_home", "Conflict", "already acting in the home tenant")
    async with db_of(request).app.connection() as conn:
        cur = await conn.execute("select role from platform.users where id = %s", (ctx.actor_user,))
        home_role = Role((await cur.fetchone())["role"])
    return await _rotate(request, ctx, acting=ctx.home_tenant, role=home_role, engagement_id=None, action="session.return")


@router.delete("", status_code=204)
async def logout(request: Request, ctx: RequestContext = Depends(get_ctx), s: TenantSession = Depends(session)) -> None:
    await auth.revoke_session(s.conn, ctx.session_id, "logout")
    await audit.record(s, "session.logout")


@router.post("/dev-login", include_in_schema=False)
async def dev_login(body: DevLogin, request: Request) -> dict:
    """Dev only: a token for a seeded user, acting in their home tenant. Never registered outside dev."""
    settings = settings_of(request)
    if not settings.is_dev:
        raise Problem(404, "not_found", "Not found")
    async with db_of(request).app.connection() as conn:
        cur = await conn.execute("select id, home_tenant_id, role from platform.users where idp_subject = %s and status = 'active'", (body.idp_subject,))
        user = await cur.fetchone()
        if user is None:
            raise Problem(401, "unknown_user", "Unauthorized")
        role = Role(user["role"])
        async with conn.transaction():
            sid = await auth.create_session(
                conn,
                user_id=user["id"],
                home_tenant=user["home_tenant_id"],
                acting_tenant=user["home_tenant_id"],
                role=role,
                engagement_id=None,
                ttl_seconds=settings.token_ttl_seconds,
            )
    token, exp = auth.issue(
        settings, user_id=user["id"], home_tenant=user["home_tenant_id"], acting_tenant=user["home_tenant_id"], role=role, sid=sid, engagement_id=None
    )
    return {"access_token": token, "expires_at": exp.isoformat()}
