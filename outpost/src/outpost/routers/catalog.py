"""Shared catalog, read-only. Missions carry `unlocked` and `missing_capabilities` computed against this tenant's connected uplinks."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..authz import authorize
from ..context import session
from ..db import TenantSession

router = APIRouter(prefix="/catalog", tags=["catalog"])


async def tenant_capabilities(s: TenantSession) -> set[str]:
    rows = await s.fetchall("select capabilities from outpost.connectors where status in ('connected', 'degraded')")
    caps: set[str] = set()
    for r in rows:
        caps.update(r["capabilities"] or [])
    return caps


@router.get("/missions")
async def missions(s: TenantSession = Depends(session)) -> dict:
    authorize(s.context, "catalog.read")
    caps = await tenant_capabilities(s)
    rows = await s.fetchall("select id, domain, title, summary, tool, required_capabilities, seed_dataset, version from catalog.missions order by domain, id")
    items = []
    for r in rows:
        missing = [c for c in r["required_capabilities"] if c not in caps]
        items.append({**r, "unlocked": not missing, "missing_capabilities": missing})
    return {"items": items, "next_cursor": None}


@router.get("/playbooks")
async def playbooks(s: TenantSession = Depends(session)) -> dict:
    authorize(s.context, "catalog.read")
    rows = await s.fetchall(
        "select id, domain, title, summary, agent_id, blast_radius, reversible, mode_ceiling, required_capabilities, resolves_checks, default_cadence from catalog.playbooks order by domain, id"  # noqa: E501
    )
    return {"items": rows, "next_cursor": None}


@router.get("/connector-types")
async def connector_types(s: TenantSession = Depends(session)) -> dict:
    authorize(s.context, "catalog.read")
    rows = await s.fetchall("select id, family, display_name, auth_kind, capabilities, docs_url from catalog.connector_types order by id")
    return {"items": rows, "next_cursor": None}
