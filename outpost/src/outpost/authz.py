"""One policy table. Handlers call authorize(); no inline role checks anywhere else."""

from __future__ import annotations

from .contract import RequestContext, Role
from .errors import forbidden

CUSTOMER = {Role.CUSTOMER_ADMIN, Role.CUSTOMER_OPERATOR, Role.CUSTOMER_VIEWER, Role.AUDITOR}
CONSULTANT = {Role.CONSULTANT_LEAD, Role.CONSULTANT_ANALYST}
TENANT_ROLES = CUSTOMER | CONSULTANT

POLICY: dict[str, set[Role]] = {
    "session.switch": CONSULTANT | {Role.PLATFORM_ADMIN},
    "catalog.read": TENANT_ROLES | {Role.FIRM_ADMIN, Role.PLATFORM_ADMIN},
    "connectors.read": TENANT_ROLES,
    "connectors.request": {Role.CUSTOMER_ADMIN, Role.CONSULTANT_LEAD},
    "connectors.trust_instructions": {Role.CUSTOMER_ADMIN},
    "connectors.complete": {Role.CUSTOMER_ADMIN},
    "connectors.revoke": {Role.CUSTOMER_ADMIN},
    "audit.read": {Role.CUSTOMER_ADMIN, Role.AUDITOR, Role.CONSULTANT_LEAD},
}


def authorize(ctx: RequestContext, action: str, *, same_tenant_only: bool = False) -> None:
    allowed = POLICY.get(action)
    if allowed is None:
        raise forbidden("unknown_action", f"no policy for {action}")
    if same_tenant_only and ctx.is_cross_tenant:
        raise forbidden("customer_must_complete", "only a user of this tenant can perform this action")
    if ctx.role not in allowed:
        raise forbidden("role_not_allowed", f"{ctx.role.value} may not {action}")
