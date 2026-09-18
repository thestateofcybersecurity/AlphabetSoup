"""Tokens and sessions.

Dev signs HS256 with a shared secret. Production signs RS256 with a KMS-held key and publishes the
public key; verify() keeps the same claim checks. Claims: sub, home_tenant, acting_tenant, role, sid,
engagement_id, iss, iat, exp.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import jwt
from psycopg import AsyncConnection

from .config import Settings
from .contract import Role
from .errors import Problem


def issue(
    settings: Settings, *, user_id: UUID, home_tenant: UUID, acting_tenant: UUID, role: Role, sid: UUID, engagement_id: UUID | None
) -> tuple[str, datetime]:
    now = datetime.now(UTC)
    exp = now + timedelta(seconds=settings.token_ttl_seconds)
    claims = {
        "iss": settings.jwt_issuer,
        "sub": str(user_id),
        "home_tenant": str(home_tenant),
        "acting_tenant": str(acting_tenant),
        "role": role.value,
        "sid": str(sid),
        "engagement_id": str(engagement_id) if engagement_id else None,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    return jwt.encode(claims, settings.jwt_secret, algorithm="HS256"), exp


def verify(settings: Settings, token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"], issuer=settings.jwt_issuer)
    except jwt.PyJWTError as e:
        raise Problem(401, "token_invalid", "Unauthorized", str(e)) from e


async def create_session(
    conn: AsyncConnection, *, user_id: UUID, home_tenant: UUID, acting_tenant: UUID, role: Role, engagement_id: UUID | None, ttl_seconds: int
) -> UUID:
    sid = uuid4()
    await conn.execute(
        """insert into platform.sessions (sid, user_id, home_tenant_id, acting_tenant_id, engagement_id, role, expires_at)
           values (%s, %s, %s, %s, %s, %s, now() + make_interval(secs => %s))""",
        (sid, user_id, home_tenant, acting_tenant, engagement_id, role.value, ttl_seconds),
    )
    return sid


async def revoke_session(conn: AsyncConnection, sid: UUID, reason: str) -> None:
    await conn.execute("update platform.sessions set revoked_at = now(), revoked_reason = %s where sid = %s and revoked_at is null", (reason, sid))


async def session_is_live(conn: AsyncConnection, sid: UUID) -> bool:
    cur = await conn.execute("select 1 from platform.sessions where sid = %s and revoked_at is null and expires_at > now()", (sid,))
    return await cur.fetchone() is not None
