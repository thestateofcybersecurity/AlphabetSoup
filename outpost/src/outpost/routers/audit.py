"""Flight recorder reads."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from ..authz import authorize
from ..context import session
from ..db import TenantSession

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("/events")
async def events(s: TenantSession = Depends(session), limit: int = Query(25, ge=1, le=100), cursor: int | None = None, action: str | None = None) -> dict:
    authorize(s.context, "audit.read")
    rows = await s.fetchall(
        """select seq, at, actor_user_id, actor_home_tenant_id, engagement_id, action, resource_kind, resource_id, target_tenant_id, request_id, detail,
                  encode(prev_hash, 'hex') as prev_hash, encode(hash, 'hex') as hash
             from outpost.audit_events
            where (%(cursor)s::bigint is null or seq < %(cursor)s) and (%(action)s::text is null or action = %(action)s)
            order by seq desc limit %(limit)s""",
        {"cursor": cursor, "action": action, "limit": limit + 1},
    )
    page, more = rows[:limit], len(rows) > limit
    for r in page:
        for k in ("actor_user_id", "actor_home_tenant_id", "engagement_id", "resource_id", "target_tenant_id"):
            r[k] = str(r[k]) if r[k] else None
        r["at"] = r["at"].isoformat()
    return {"items": page, "next_cursor": str(page[-1]["seq"]) if more and page else None}


@router.get("/verify")
async def verify(s: TenantSession = Depends(session)) -> dict:
    authorize(s.context, "audit.read")
    row = await s.fetchone("select outpost.audit_verify(%s) as first_broken_seq", (s.context.acting_tenant,))
    return {"ok": row["first_broken_seq"] is None, "first_broken_seq": row["first_broken_seq"]}
