"""Every tenant-scoped route, walked as one tenant against the other. This file is the CI gate."""

from __future__ import annotations

import uuid

import pytest
from conftest import Fixture, bearer

from outpost.contract import Role

API = "/api/v1"


@pytest.fixture
def tok_a(fx: Fixture) -> str:
    return fx.token(fx.admin_a, fx.tenant_a, role=Role.CUSTOMER_ADMIN)


@pytest.fixture
def tok_b(fx: Fixture) -> str:
    return fx.token(fx.admin_b, fx.tenant_b, role=Role.CUSTOMER_ADMIN)


async def _make_connector(client, tok: str, name: str = "AWS prod") -> str:
    r = await client.post(f"{API}/connectors", json={"type_id": "aws", "display_name": name, "requested_scopes": ["read:cloud.aws"]}, headers=bearer(tok))
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def test_b_cannot_see_a(client, tok_a, tok_b):
    cid = await _make_connector(client, tok_a)
    r = await client.get(f"{API}/connectors", headers=bearer(tok_b))
    assert r.status_code == 200 and all(i["id"] != cid for i in r.json()["items"])
    for path in (f"/connectors/{cid}", f"/connectors/{cid}/trust-instructions"):
        r = await client.get(f"{API}{path}", headers=bearer(tok_b))
        assert r.status_code == 404, path
        assert r.json()["code"] == "not_found" and "AWS prod" not in r.text
    r = await client.post(f"{API}/connectors/{cid}/complete", json={"role_arn": "arn:aws:iam::1:role/x"}, headers=bearer(tok_b))
    assert r.status_code == 404
    r = await client.delete(f"{API}/connectors/{cid}", headers=bearer(tok_b))
    assert r.status_code == 404
    # B's attempts are on B's flight recorder, never on A's
    ev = (await client.get(f"{API}/audit/events", params={"action": "connector.not_found"}, headers=bearer(tok_b))).json()["items"]
    assert any(e["resource_id"] == cid for e in ev)
    ev_a = (await client.get(f"{API}/audit/events", params={"action": "connector.not_found"}, headers=bearer(tok_a))).json()["items"]
    assert all(e["resource_id"] != cid for e in ev_a)


async def test_every_get_route_with_an_id_is_404_cross_tenant(client, tok_a, tok_b):
    """Walk the OpenAPI schema so a new route cannot be added without this test covering it."""
    cid = await _make_connector(client, tok_a, "walk")
    schema = client.app.openapi()
    walked = 0
    for path, methods in schema["paths"].items():
        if "{" not in path:
            continue
        concrete = path.replace("{connector_id}", cid)
        assert concrete != path, f"unknown path parameter in {path}; teach the walker about it"
        for method in methods:
            body = {"role_arn": "arn:aws:iam::1:role/x"} if method == "post" else None
            r = await client.request(method.upper(), concrete, json=body, headers=bearer(tok_b))
            assert r.status_code == 404, f"{method.upper()} {path} -> {r.status_code}: {r.text}"
            assert "walk" not in r.text
            walked += 1
    assert walked >= 4


async def test_tenant_id_in_any_request_is_400(client, tok_a):
    schema = client.app.openapi()
    checked = 0
    for path, methods in schema["paths"].items():
        for method in methods:
            if method not in ("post", "put", "patch", "delete", "get"):
                continue
            concrete = path.replace("{connector_id}", str(uuid.uuid4()))
            if method == "get":
                r = await client.get(concrete, params={"tenant_id": str(uuid.uuid4())}, headers=bearer(tok_a))
            else:
                r = await client.request(method.upper(), concrete, json={"tenant_id": str(uuid.uuid4()), "nested": {"tenant_id": "x"}}, headers=bearer(tok_a))
            assert r.status_code == 400 and r.json()["code"] == "tenant_id_not_allowed", f"{method.upper()} {path} -> {r.status_code} {r.text}"
            checked += 1
    assert checked >= 8


async def test_unscoped_and_revoked_tokens_are_rejected(client, fx: Fixture, tok_a):
    r = await client.get(f"{API}/connectors")
    assert r.status_code == 401
    r = await client.get(f"{API}/connectors", headers=bearer("not-a-token"))
    assert r.status_code == 401
    r = await client.delete(f"{API}/session", headers=bearer(tok_a))
    assert r.status_code == 204
    r = await client.get(f"{API}/connectors", headers=bearer(tok_a))
    assert r.status_code == 401 and r.json()["code"] == "session_revoked"


async def test_viewer_cannot_request_or_complete(client, fx: Fixture):
    tok = fx.token(fx.viewer_b, fx.tenant_b, role=Role.CUSTOMER_VIEWER)
    r = await client.post(f"{API}/connectors", json={"type_id": "aws", "display_name": "x"}, headers=bearer(tok))
    assert r.status_code == 403 and r.json()["code"] == "role_not_allowed"
    r = await client.get(f"{API}/catalog/missions", headers=bearer(tok))
    assert r.status_code == 200
