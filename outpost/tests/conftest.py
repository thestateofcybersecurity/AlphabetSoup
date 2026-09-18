"""Two-tenant harness.

Creates a fresh outpost_test database from the migrations, seeds the catalog, and provisions:
  tenant A (customer), tenant B (customer), FIRM (consulting firm)
  admin_a, admin_b (customer_admin in their tenants), viewer_b, consultant (home FIRM)
  one active engagement FIRM -> A with the consultant assigned as lead.
Tokens are minted directly (the IdP is not part of this skeleton).
"""

from __future__ import annotations

import os
import subprocess
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

import httpx
import psycopg
import pytest
import pytest_asyncio
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from outpost import auth
from outpost.cli import SQL, lint, migrate, seed
from outpost.config import Settings
from outpost.contract import Role
from outpost.main import create_app

ADMIN = os.environ.get("OUTPOST_TEST_ADMIN_DSN", "postgresql://postgres@localhost:5432/postgres")
TEST_DB = "outpost_test"


def _with_db(dsn: str, db: str, user: str | None = None) -> str:
    """Rebuild a DSN for another database (and optionally another user), whatever its form."""
    params = conninfo_to_dict(dsn)
    params["dbname"] = db
    if user:
        params["user"] = user
    return make_conninfo(**params)


@dataclass
class Fixture:
    settings: Settings
    tenant_a: UUID
    tenant_b: UUID
    firm: UUID
    admin_a: UUID
    admin_b: UUID
    viewer_b: UUID
    consultant: UUID
    engagement: UUID

    def token(self, user: UUID, home: UUID, *, acting: UUID | None = None, role: Role, engagement: UUID | None = None) -> str:
        acting = acting or home
        with psycopg.connect(self.settings.app_dsn) as c:  # sessions are the app's to create
            sid = uuid.uuid4()
            c.execute(
                "insert into platform.sessions (sid, user_id, home_tenant_id, acting_tenant_id, engagement_id, role, expires_at) values (%s,%s,%s,%s,%s,%s, now() + interval '15 minutes')",
                (sid, user, home, acting, engagement, role.value),
            )
        tok, _ = auth.issue(self.settings, user_id=user, home_tenant=home, acting_tenant=acting, role=role, sid=sid, engagement_id=engagement)
        return tok


@pytest.fixture(scope="session")
def fx() -> Fixture:
    with psycopg.connect(ADMIN, autocommit=True) as c:
        c.execute(f"drop database if exists {TEST_DB} with (force)")
        c.execute(f"create database {TEST_DB}")
    admin_db = _with_db(ADMIN, TEST_DB)
    migrate(admin_db)
    prov = _with_db(ADMIN, TEST_DB, user="outpost_provisioner")
    seed(prov)
    assert lint(admin_db) == [], "SQL lints must be clean on a fresh database"
    a, b, firm = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    admin_a, admin_b, viewer_b, consultant, engagement = (uuid.uuid4() for _ in range(5))
    with psycopg.connect(prov) as c:
        c.execute(
            "insert into platform.tenants (id, kind, name, slug) values (%s,'customer','Tenant A','a'), (%s,'customer','Tenant B','b'), (%s,'firm','Firm','firm')",
            (a, b, firm),
        )
        c.execute(
            """insert into platform.users (id, home_tenant_id, idp_subject, email, display_name, role) values
               (%s,%s,'sub-admin-a','admin@a.example','Admin A','customer_admin'),
               (%s,%s,'sub-admin-b','admin@b.example','Admin B','customer_admin'),
               (%s,%s,'sub-viewer-b','viewer@b.example','Viewer B','customer_viewer'),
               (%s,%s,'sub-consultant','c@firm.example','Consultant','consultant_lead')""",
            (admin_a, a, admin_b, b, viewer_b, b, consultant, firm),
        )
        c.execute(
            "insert into platform.engagements (id, firm_tenant_id, customer_tenant_id, ends_at, status, created_by) values (%s,%s,%s, now() + interval '90 days', 'active', %s)",
            (engagement, firm, a, consultant),
        )
        c.execute(
            "insert into platform.engagement_assignments (engagement_id, user_id, role, granted_by) values (%s,%s,'lead',%s)",
            (engagement, consultant, consultant),
        )
    settings = Settings(
        app_dsn=_with_db(ADMIN, TEST_DB, user="outpost_app"),
        provisioner_dsn=prov,
        admin_dsn=admin_db,
        jwt_secret="test-secret-" + "x" * 32,
        token_ttl_seconds=900,
        env="dev",
    )
    return Fixture(settings, a, b, firm, admin_a, admin_b, viewer_b, consultant, engagement)


@pytest_asyncio.fixture
async def client(fx: Fixture) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app(fx.settings)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            c.app = app  # type: ignore[attr-defined]
            yield c


def bearer(token: str) -> dict[str, str]:
    return {"authorization": f"Bearer {token}"}


def sql_files_match_docs() -> list[str]:
    """While the skeleton lives beside the design docs, the SQL copies must stay identical."""
    docs = Path(__file__).resolve().parents[2] / "docs" / "outpost"
    pairs = [
        (SQL / "migrations" / "0001_bootstrap.sql", docs / "schema.sql"),
        (SQL / "seed" / "catalog.sql", docs / "connectors" / "seed.sql"),
        (SQL / "lint" / "check_rls.sql", docs / "check_rls.sql"),
        (SQL / "lint" / "check_catalog.sql", docs / "connectors" / "check_catalog.sql"),
    ]
    return [str(mine) for mine, theirs in pairs if theirs.exists() and mine.read_bytes() != theirs.read_bytes()]


def psql_available() -> bool:
    return subprocess.run(["psql", "--version"], capture_output=True).returncode == 0
