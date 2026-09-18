"""Connector drivers: the vendor-facing half of `complete` and health.

A driver receives the trust material the customer supplied, verifies it against the vendor once,
and returns the identity plus the capabilities it could confirm. The dev driver confirms nothing and
grants every read capability the type declares; the Entra ID and AWS drivers implement the health
checks in docs/outpost/connectors/.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass(frozen=True, slots=True)
class Health:
    ok: bool
    identity: dict[str, str]
    scopes_verified: list[str] = field(default_factory=list)
    scopes_missing: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


class Driver(Protocol):
    def trust_instructions(self, connector: dict, secret: dict[str, Any]) -> dict: ...
    async def complete(self, connector: dict, ctype: dict, secret: dict[str, Any], supplied: dict[str, Any]) -> tuple[dict[str, Any], Health]: ...


class DevDriver:
    def trust_instructions(self, connector: dict, secret: dict[str, Any]) -> dict:
        kind = connector["auth_kind"]
        if kind == "aws-role":
            return {"kind": kind, "external_id": secret["external_id"], "template": "cloudformation", "role_name": "OutpostReadOnly"}
        return {"kind": kind, "consent_url": f"https://login.microsoftonline.com/organizations/v2.0/adminconsent?state={secret['state']}"}

    async def complete(self, connector: dict, ctype: dict, secret: dict[str, Any], supplied: dict[str, Any]) -> tuple[dict[str, Any], Health]:
        reads = [c["id"] for c in ctype["capabilities"] if c["kind"] == "read"]
        identity = {"kind": "dev", "id": supplied.get("role_arn") or supplied.get("tenant") or "dev"}
        return {**secret, **supplied}, Health(ok=True, identity=identity, scopes_verified=reads, warnings=["dev driver: nothing was verified with the vendor"])
