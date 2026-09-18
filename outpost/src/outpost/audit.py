"""Flight recorder writes. INSERT only; the trigger chains and hashes the row."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from .db import TenantSession

INSERT = """
insert into outpost.audit_events
  (tenant_id, actor_user_id, actor_home_tenant_id, engagement_id, action, resource_kind, resource_id, target_tenant_id, request_id, detail)
values (%(tenant)s, %(actor)s, %(home)s, %(engagement)s, %(action)s, %(kind)s, %(rid)s, %(target)s, %(req)s, %(detail)s)
"""


async def record(
    s: TenantSession,
    action: str,
    *,
    resource_kind: str | None = None,
    resource_id: UUID | None = None,
    target_tenant_id: UUID | None = None,
    detail: dict[str, Any] | None = None,
    both_chains: bool = False,
    durable: bool = False,
) -> None:
    """Write to the acting tenant's chain; with both_chains, also to the actor's home chain.

    Only session events (switch, return) go to both chains. Everything a consultant does inside a
    customer tenant stays on that customer's chain, where the customer can read it and the consultant
    can read it while acting there; the firm's chain never carries customer resource ids.
    Every read by an actor whose home tenant differs from the acting tenant is recorded too; callers
    pass read actions through here the same way. `durable=True` queues the row to be written after the
    request transaction ends, so a refused request (404, 403) is recorded even though it rolls back.
    """
    import json

    ctx = s.context
    base = {
        "actor": str(ctx.actor_user),
        "home": str(ctx.home_tenant),
        "engagement": str(ctx.engagement_id) if ctx.engagement_id else None,
        "action": action,
        "kind": resource_kind,
        "rid": str(resource_id) if resource_id else None,
        "target": str(target_tenant_id) if target_tenant_id else None,
        "req": ctx.request_id,
        "detail": json.dumps(detail or {}),
    }
    rows = [{**base, "tenant": str(ctx.acting_tenant)}]
    if both_chains and ctx.home_tenant != ctx.acting_tenant:
        rows.append({**base, "tenant": str(ctx.home_tenant)})
    for row in rows:
        if durable:
            s.durable_audit.append((INSERT, row))
        else:
            await s.execute(INSERT, row)
