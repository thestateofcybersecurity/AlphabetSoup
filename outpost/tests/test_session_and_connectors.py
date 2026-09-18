"""The consultant lifecycle: switch, cross-tenant reads logged, customer-only complete, unlocks, chains."""

from __future__ import annotations

from conftest import Fixture, bearer

from outpost.contract import Role

API = "/api/v1"


async def test_consultant_switch_and_customer_completes(client, fx: Fixture):
    tok_c = fx.token(fx.consultant, fx.firm, role=Role.CONSULTANT_LEAD)
    tok_a = fx.token(fx.admin_a, fx.tenant_a, role=Role.CUSTOMER_ADMIN)

    # at home the consultant sees the firm tenant, which holds no connectors
    me = (await client.get(f"{API}/session", headers=bearer(tok_c))).json()
    assert me["acting_tenant"]["slug"] == "firm" and me["engagement_id"] is None
    assert (await client.get(f"{API}/connectors", headers=bearer(tok_c))).json()["items"] == []

    # switch into A through the engagement: new token, old one revoked
    r = await client.post(f"{API}/session/switch", json={"engagement_id": str(fx.engagement)}, headers=bearer(tok_c))
    assert r.status_code == 200, r.text
    tok_ca = r.json()["access_token"]
    assert (await client.get(f"{API}/session", headers=bearer(tok_c))).status_code == 401
    me = (await client.get(f"{API}/session", headers=bearer(tok_ca))).json()
    assert me["acting_tenant"]["slug"] == "a" and me["home_tenant"]["slug"] == "firm" and me["role"] == "consultant_lead"

    # a second switch from an acting context is refused
    r = await client.post(f"{API}/session/switch", json={"engagement_id": str(fx.engagement)}, headers=bearer(tok_ca))
    assert r.status_code == 403 and r.json()["code"] == "already_acting"

    # consultant requests a connector in A; only A's admin may read the trust material or complete it
    r = await client.post(
        f"{API}/connectors",
        json={"type_id": "aws", "display_name": "Acme prod", "requested_scopes": ["read:cloud.aws", "read:cloud.aws.backup"]},
        headers=bearer(tok_ca),
    )
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    assert r.json()["status"] == "awaiting_customer"
    r = await client.get(f"{API}/connectors/{cid}/trust-instructions", headers=bearer(tok_ca))
    assert r.status_code == 403 and r.json()["code"] == "customer_must_complete"
    r = await client.post(f"{API}/connectors/{cid}/complete", json={"role_arn": "arn:aws:iam::123456789012:role/OutpostReadOnly"}, headers=bearer(tok_ca))
    assert r.status_code == 403 and r.json()["code"] == "customer_must_complete"

    ti = await client.get(f"{API}/connectors/{cid}/trust-instructions", headers=bearer(tok_a))
    assert ti.status_code == 200 and ti.json()["external_id"].startswith("a-")
    assert {p["scope"] for p in ti.json()["minimum_permissions"]} == {"read:cloud.aws", "read:cloud.aws.backup"}

    # missions locked before, unlocked after the customer completes
    before = {m["id"]: m for m in (await client.get(f"{API}/catalog/missions", headers=bearer(tok_a))).json()["items"]}
    assert before["cloud-cis-foundations-aws"]["unlocked"] is False and before["cloud-cis-foundations-aws"]["missing_capabilities"] == ["read:cloud.aws"]
    r = await client.post(f"{API}/connectors/{cid}/complete", json={"role_arn": "arn:aws:iam::123456789012:role/OutpostReadOnly"}, headers=bearer(tok_a))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "connected" and sorted(r.json()["capabilities"]) == ["read:cloud.aws", "read:cloud.aws.backup"]
    assert {u["mission_id"] for u in r.json()["unlocks"]} == {"cloud-cis-foundations-aws", "backup-verification-aws"}
    after = {m["id"]: m for m in (await client.get(f"{API}/catalog/missions", headers=bearer(tok_a))).json()["items"]}
    assert after["cloud-cis-foundations-aws"]["unlocked"] and after["backup-verification-aws"]["unlocked"] and not after["identity-baseline"]["unlocked"]

    # completing twice is a conflict, and the secret never appears in any response
    r = await client.post(f"{API}/connectors/{cid}/complete", json={"role_arn": "arn:aws:iam::123456789012:role/OutpostReadOnly"}, headers=bearer(tok_a))
    assert r.status_code == 409
    detail = await client.get(f"{API}/connectors/{cid}", headers=bearer(tok_a))
    assert ti.json()["external_id"] not in detail.text

    # consultant reads are on A's flight recorder with the firm as home, and both chains verify
    _ = await client.get(f"{API}/connectors/{cid}", headers=bearer(tok_ca))
    ev = (await client.get(f"{API}/audit/events", headers=bearer(tok_a), params={"limit": 100})).json()["items"]
    actions = [e["action"] for e in ev]
    assert "session.switch" in actions and "connector.read" in actions and "connector.request" in actions and "connector.complete" in actions
    read = next(e for e in ev if e["action"] == "connector.read")
    assert read["actor_home_tenant_id"] == str(fx.firm) and read["engagement_id"] == str(fx.engagement)
    assert (await client.get(f"{API}/audit/verify", headers=bearer(tok_a))).json()["ok"] is True

    # the firm's own chain has the switch too, and the customer admin cannot read the firm chain
    r = await client.post(f"{API}/session/return", headers=bearer(tok_ca))
    tok_home = r.json()["access_token"]
    firm_ev = (await client.get(f"{API}/audit/events", headers=bearer(tok_home))).json()["items"]
    assert {e["action"] for e in firm_ev} >= {"session.switch", "session.return"}
    assert all(e["action"] not in ("connector.request", "connector.complete") for e in firm_ev), "customer-tenant writes never land on the firm chain"
    assert (await client.get(f"{API}/audit/verify", headers=bearer(tok_home))).json()["ok"] is True

    # revoke: secret gone, missions lock again
    r = await client.delete(f"{API}/connectors/{cid}", headers=bearer(tok_a))
    assert r.status_code == 204
    after = {m["id"]: m for m in (await client.get(f"{API}/catalog/missions", headers=bearer(tok_a))).json()["items"]}
    assert after["cloud-cis-foundations-aws"]["unlocked"] is False


async def test_switch_requires_active_assignment(client, fx: Fixture):
    tok_b_admin = fx.token(fx.admin_b, fx.tenant_b, role=Role.CUSTOMER_ADMIN)
    r = await client.post(f"{API}/session/switch", json={"engagement_id": str(fx.engagement)}, headers=bearer(tok_b_admin))
    assert r.status_code == 403 and r.json()["code"] == "role_not_allowed"
    tok_c = fx.token(fx.consultant, fx.firm, role=Role.CONSULTANT_LEAD)
    r = await client.post(f"{API}/session/switch", json={"engagement_id": "00000000-0000-0000-0000-000000000000"}, headers=bearer(tok_c))
    assert r.status_code == 403 and r.json()["code"] == "assignment_inactive"
