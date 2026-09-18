"""Connection pools and the tenant-scoped session.

The application pool connects as outpost_app, which has no BYPASSRLS. A TenantSession is one
transaction on which the request's identity has been set with SET LOCAL; the engine and the
routers execute on it and never change the settings or the role.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from .config import Settings
from .contract import RequestContext


class Database:
    def __init__(self, settings: Settings):
        self.app = AsyncConnectionPool(settings.app_dsn, open=False, kwargs={"row_factory": dict_row})
        self.provisioner = AsyncConnectionPool(settings.provisioner_dsn, open=False, min_size=0, max_size=2, kwargs={"row_factory": dict_row})

    async def open(self) -> None:
        await self.app.open()
        await self.provisioner.open()

    async def close(self) -> None:
        await self.app.close()
        await self.provisioner.close()


@dataclass(slots=True)
class TenantSession:
    conn: AsyncConnection
    context: RequestContext
    durable_audit: list[tuple[str, dict]] = field(default_factory=list)
    """Audit rows that must persist even if this request's transaction rolls back (denied access, 404s)."""

    async def execute(self, statement: str, params: Any = None):
        return await self.conn.execute(statement, params)

    async def fetchone(self, statement: str, params: Any = None) -> dict | None:
        cur = await self.conn.execute(statement, params)
        return await cur.fetchone()

    async def fetchall(self, statement: str, params: Any = None) -> list[dict]:
        cur = await self.conn.execute(statement, params)
        return await cur.fetchall()


SET_IDENTITY = """
select set_config('app.tenant_id', %(acting)s, true),
       set_config('app.home_tenant_id', %(home)s, true),
       set_config('app.user_id', %(user)s, true)
"""


def _identity(ctx: RequestContext) -> dict[str, str]:
    return {"acting": str(ctx.acting_tenant), "home": str(ctx.home_tenant), "user": str(ctx.actor_user)}


async def scoped(db: Database, ctx: RequestContext) -> AsyncIterator[TenantSession]:
    """Open one transaction scoped to ctx. Commits on success, rolls back on any exception.

    Rows queued on `durable_audit` are written afterwards in their own transaction, so a refused
    request still leaves its trace on the flight recorder.
    """
    async with db.app.connection() as conn:
        s = TenantSession(conn, ctx)
        try:
            async with conn.transaction():
                await conn.execute(SET_IDENTITY, _identity(ctx))
                yield s
        finally:
            if s.durable_audit:
                async with conn.transaction():
                    await conn.execute(SET_IDENTITY, _identity(ctx))
                    for statement, params in s.durable_audit:
                        await conn.execute(statement, params)
