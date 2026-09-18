"""The Hangar. Request by consultant or customer admin; complete by customer admin only."""

from __future__ import annotations

import json
import secrets as pysecrets
from dataclasses import asdict
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from .. import audit
from ..authz import authorize
from ..context import session
from ..db import TenantSession
from ..errors import Problem, not_found
from .catalog import tenant_capabilities

router = APIRouter(prefix="/connectors", tags=["connectors"])

COLUMNS = "id, type_id, display_name, status, external_ref, requested_scopes, granted_scopes, capabilities, health, last_checked_at, requested_by, completed_by, completed_at, created_at"  # noqa: E501


class ConnectorRequest(BaseModel):
    type_id: str
    display_name: str = Field(min_length=1, max_length=120)
    requested_scopes: list[str] = Field(default_factory=list)


class CompleteRequest(BaseModel):
    role_arn: str | None = None
    oauth_code: str | None = None
    state: str | None = None
    tenant: str | None = None


def _public(row: dict, unlocks: list[dict] | None = None) -> dict:
    out = {**row, "id": str(row["id"])}
    for k in ("requested_by", "completed_by"):
        out[k] = str(row[k]) if row.get(k) else None
    out["unlocks"] = unlocks or []
    return out


async def _unlocks(s: TenantSession, capabilities: list[str]) -> list[dict]:
    rows = await s.fetchall("select id, title, required_capabilities from catalog.missions")
    return [{"mission_id": r["id"], "title": r["title"]} for r in rows if all(c in capabilities for c in r["required_capabilities"])]


async def _get(s: TenantSession, connector_id: UUID) -> dict:
    row = await s.fetchone(f"select {COLUMNS} from outpost.connectors where id = %s", (connector_id,))
    if row is None:
        await audit.record(s, "connector.not_found", resource_kind="connector", resource_id=connector_id, durable=True)
        raise not_found()
    return row


@router.get("")
async def list_connectors(s: TenantSession = Depends(session)) -> dict:
    authorize(s.context, "connectors.read")
    rows = await s.fetchall(f"select {COLUMNS} from outpost.connectors order by created_at desc")
    if s.context.is_cross_tenant:
        await audit.record(s, "connector.list", resource_kind="connector", detail={"count": len(rows)})
    return {"items": [_public(r, await _unlocks(s, r["capabilities"])) for r in rows], "next_cursor": None}


@router.get("/{connector_id}")
async def get_connector(connector_id: UUID, s: TenantSession = Depends(session)) -> dict:
    authorize(s.context, "connectors.read")
    row = await _get(s, connector_id)
    if s.context.is_cross_tenant:
        await audit.record(s, "connector.read", resource_kind="connector", resource_id=connector_id)
    return _public(row, await _unlocks(s, row["capabilities"]))


@router.post("", status_code=201)
async def request_connector(body: ConnectorRequest, request: Request, s: TenantSession = Depends(session)) -> dict:
    authorize(s.context, "connectors.request")
    ctype = await s.fetchone("select id, auth_kind, capabilities from catalog.connector_types where id = %s", (body.type_id,))
    if ctype is None:
        raise Problem(422, "unknown_connector_type", "Unprocessable", f"no connector type {body.type_id}")
    declared = {c["id"] for c in ctype["capabilities"]}
    unknown = [sc for sc in body.requested_scopes if sc not in declared]
    if unknown:
        raise Problem(422, "unknown_scope", "Unprocessable", f"not declared by {body.type_id}: {', '.join(unknown)}")
    row = await s.fetchone(
        f"""insert into outpost.connectors (type_id, display_name, status, requested_scopes, requested_by)
            values (%s, %s, 'awaiting_customer', %s, %s) returning {COLUMNS}""",
        (body.type_id, body.display_name, body.requested_scopes, s.context.actor_user),
    )
    # Trust material generated now, stored sealed, shown only to a customer admin.
    tenant_slug = (await s.fetchone("select slug from platform.tenants where id = %s", (s.context.acting_tenant,)))["slug"]
    material: dict[str, Any] = (
        {"external_id": f"{tenant_slug}-{pysecrets.token_hex(6)}"} if ctype["auth_kind"] == "aws-role" else {"state": pysecrets.token_urlsafe(24)}
    )
    envelope = request.app.state.envelope
    blob, key_arn, context = envelope.seal(s.context.acting_tenant, row["id"], material)
    await s.execute(
        "insert into outpost.connector_secrets (connector_id, kind, ciphertext, kms_key_arn, encryption_context) values (%s, %s, %s, %s, %s)",
        (row["id"], ctype["auth_kind"] if ctype["auth_kind"] != "oauth" else "oauth-refresh", blob, key_arn, json.dumps(context)),
    )
    await audit.record(
        s, "connector.request", resource_kind="connector", resource_id=row["id"], detail={"type_id": body.type_id, "scopes": body.requested_scopes}
    )
    return _public(row)


@router.get("/{connector_id}/trust-instructions")
async def trust_instructions(connector_id: UUID, request: Request, s: TenantSession = Depends(session)) -> dict:
    authorize(s.context, "connectors.trust_instructions", same_tenant_only=True)
    row = await _get(s, connector_id)
    ctype = await s.fetchone("select id, auth_kind, capabilities, trust_template from catalog.connector_types where id = %s", (row["type_id"],))
    secret = await _open_secret(request, s, row["id"])
    instructions = request.app.state.driver.trust_instructions({**row, "auth_kind": ctype["auth_kind"]}, secret)
    instructions["minimum_permissions"] = [
        {"scope": c["id"], "permissions": c["permissions"]} for c in ctype["capabilities"] if c["id"] in row["requested_scopes"]
    ]
    await audit.record(s, "connector.trust_instructions", resource_kind="connector", resource_id=connector_id)
    return instructions


async def _open_secret(request: Request, s: TenantSession, connector_id: UUID) -> dict[str, Any]:
    sec = await s.fetchone(
        "select id, ciphertext, encryption_context from outpost.connector_secrets where connector_id = %s order by rotated_at desc limit 1", (connector_id,)
    )
    if sec is None:
        raise Problem(409, "trust_not_completed", "Conflict", "no trust material for this connector")
    return request.app.state.envelope.open(s.context.acting_tenant, connector_id, bytes(sec["ciphertext"]), sec["encryption_context"])


@router.post("/{connector_id}/complete")
async def complete(connector_id: UUID, body: CompleteRequest, request: Request, s: TenantSession = Depends(session)) -> dict:
    authorize(s.context, "connectors.complete", same_tenant_only=True)
    row = await _get(s, connector_id)
    if row["status"] not in ("awaiting_customer", "degraded", "expired"):
        raise Problem(409, "wrong_state", "Conflict", f"connector is {row['status']}")
    ctype = await s.fetchone("select id, auth_kind, capabilities from catalog.connector_types where id = %s", (row["type_id"],))
    secret = await _open_secret(request, s, connector_id)
    supplied = {k: v for k, v in body.model_dump().items() if v is not None}
    if ctype["auth_kind"] == "aws-role" and "role_arn" not in supplied:
        raise Problem(422, "role_arn_required", "Unprocessable")
    if ctype["auth_kind"] == "oauth" and ("oauth_code" not in supplied or supplied.get("state") != secret.get("state")):
        raise Problem(400, "oauth_state_invalid", "Bad request")
    new_secret, health = await request.app.state.driver.complete(row, ctype, secret, supplied)
    if not health.ok:
        raise Problem(409, "trust_not_completed", "Conflict", "the vendor did not accept the trust material")
    envelope = request.app.state.envelope
    blob, key_arn, context = envelope.seal(s.context.acting_tenant, connector_id, new_secret)
    await s.execute(
        "update outpost.connector_secrets set ciphertext = %s, kms_key_arn = %s, encryption_context = %s, rotated_at = now() where connector_id = %s",
        (blob, key_arn, json.dumps(context), connector_id),
    )
    granted = [sc for sc in row["requested_scopes"] if sc in health.scopes_verified]
    updated = await s.fetchone(
        f"""update outpost.connectors
               set status = 'connected', external_ref = %s, granted_scopes = %s, capabilities = %s, health = %s,
                   last_checked_at = now(), completed_by = %s, completed_at = now()
             where id = %s returning {COLUMNS}""",
        (json.dumps(health.identity), granted, granted, json.dumps(asdict(health)), s.context.actor_user, connector_id),
    )
    await audit.record(s, "connector.complete", resource_kind="connector", resource_id=connector_id, detail={"granted": granted})
    return _public(updated, await _unlocks(s, granted))


@router.delete("/{connector_id}", status_code=204)
async def revoke(connector_id: UUID, s: TenantSession = Depends(session)) -> None:
    authorize(s.context, "connectors.revoke", same_tenant_only=True)
    row = await _get(s, connector_id)
    await s.execute("delete from outpost.connector_secrets where connector_id = %s", (connector_id,))
    await s.execute("update outpost.connectors set status = 'revoked', capabilities = '{}', granted_scopes = '{}' where id = %s", (connector_id,))
    await audit.record(s, "connector.revoke", resource_kind="connector", resource_id=connector_id, detail={"had_scopes": row["granted_scopes"]})
    _ = await tenant_capabilities(s)  # missions that depended on this connector now report locked
