# Outpost connector contract

**Status:** draft v0.1 (2026-09-18). The rules every connector follows. The first two connectors are specified in [entra-id.md](entra-id.md) and [aws.md](aws.md); [seed.sql](seed.sql) loads their catalog rows into the schema.

A connector is the only way Outpost touches a customer system. It has to be safe to grant, cheap to revoke, and impossible to use across tenants. Everything below exists to make those three properties structural.

---

## 1. Lifecycle

| State | Who moves it here | What exists |
|---|---|---|
| `requested` | Consultant lead or customer admin: `POST /connectors` | A row with `type_id`, requested scopes, no secret. |
| `awaiting_customer` | Server, immediately after request | Trust instructions generated: consent URL or role template, bound to this tenant and connector, expiring in 7 days. |
| `connected` | **Customer admin only**: `POST /connectors/{id}/complete` | The secret record (§4), a passing health check, derived capabilities. |
| `degraded` | Health job | Health failed or a scope was lost; the connector still exists. Missions that depend on the missing capability lock. |
| `expired` | Health job | The credential can no longer be exchanged (revoked consent, deleted role, expired key). |
| `revoked` | Customer admin: `DELETE /connectors/{id}` | Revoked at the vendor where an API allows it, then the secret row is deleted. Terminal. |

A consultant never sees a secret, never pastes one, and cannot call `complete`. The consultant prepares the request and reads the health result.

## 2. Capabilities and scopes

A **capability** is what Outpost can do; a **scope** is what the vendor grants. Connector types declare the mapping. Missions and playbooks require capabilities, never vendor permissions, so a mission definition is portable across connector types that offer the same capability.

Naming grammar: `read:<domain>[.<area>]` and `write:<domain>.<object>`.

- `read:*` capabilities are requested together as the connector's read scope.
- Each `write:*` capability is requested **separately**, only when a customer enables a playbook that needs it, and is granted through a distinct vendor permission (a second IAM role, an additional Graph permission) so a customer can revoke one write capability without touching the rest.
- A capability is `derived` at health-check time from what the vendor reports as granted, never copied from what was requested.

## 3. Connector type record (`catalog.connector_types`)

```jsonc
{
  "id": "aws",
  "family": "cloud",
  "display_name": "AWS",
  "auth_kind": "aws-role",                  // oauth | aws-role | gcp-wif | azure-federated | api-key
  "capabilities": [
    { "id": "read:cloud.aws", "permissions": ["arn:aws:iam::aws:policy/SecurityAudit", "..."], "kind": "read" },
    { "id": "write:cloud.aws.s3-public-access", "permissions": ["s3:PutBucketPublicAccessBlock", "..."], "kind": "write",
      "playbooks": ["cloud.block-public-storage"] }
  ],
  "trust_template": { /* what the customer applies; see each spec */ },
  "docs_url": "https://..."
}
```

## 4. Secret record (`outpost.connector_secrets`)

What is stored is the **minimum that lets Outpost mint a short-lived credential later**, never the credential a run uses.

| `kind` | Stored (encrypted) | Minted per run |
|---|---|---|
| `oauth-refresh` | Refresh token or, for app-only consent, only the vendor tenant id and consent record | Access token, 60 minutes or less |
| `aws-role` | Role ARN and the per-tenant ExternalId | STS session, 60 minutes, session name = run id, session tags = tenant and run |
| `api-key` | The key | The key itself, injected only into that run's container; flagged in the Hangar with a rotation reminder |

Encryption: envelope with the tenant's KMS key and encryption context `{"tenant_id": "<id>", "connector_id": "<id>"}`. The schema rejects a row whose context names a different tenant.

The run worker never receives the stored secret. The API server decrypts it, exchanges it, and injects the derived credential into the run container's environment at launch. The derived credential expires with the run's `run_credentials_expire_at`, and the kill switch revokes it where the vendor supports revocation.

## 5. Health check contract

Every connector type implements `health(ctx, connector) -> Health`, run on `complete`, on demand, and hourly.

```jsonc
{
  "ok": true,
  "checked_at": "2026-09-18T15:00:00Z",
  "identity": { "kind": "aws-account", "id": "123456789012", "display": "acme-prod" },
  "scopes_verified": ["read:cloud.aws", "read:cloud.aws.inventory"],
  "scopes_missing": ["read:cloud.aws.backup"],
  "warnings": ["3 regions are not opted in and were skipped"],
  "latency_ms": 840
}
```

`ok` is false only when the identity call fails. Missing scopes degrade the connector and lock the affected missions; they do not fail health.

## 6. Scope enforcement at call time

A mission run carries `scope` (accounts and regions, directory administrative units, repositories). The connector's call wrapper receives the scope and **refuses** any call whose target is outside it, before the call is made. This is enforced in the wrapper, not in the agent prompt, so a prompt-injected "also check the other account" is rejected with a logged `scope_violation`.

## 7. Evidence documents

Every check produces one evidence document per asset set, stored on the finding and on the mission answer.

```jsonc
{
  "check_id": "aws-logging-cloudtrail-all-regions",
  "connector_id": "…",
  "collected_at": "…",
  "calls": [{ "service": "cloudtrail", "op": "DescribeTrails", "params_hash": "…" }],
  "observed": { "trails": 1, "multi_region": false, "log_file_validation": true },
  "verdict": "fail",                      // pass | fail | na | unknown
  "assets": [{ "kind": "aws:account", "ref": "123456789012" }],
  "explanation": "One trail exists but it records a single region."
}
```

`unknown` means the connector could not evidence the check (a licence the customer lacks, a permission not granted). The mission then asks a human the corresponding questionnaire item instead of guessing.

## 8. Check definitions (`catalog.missions.checks[]`)

```jsonc
{
  "id": "aws-data-s3-block-public-access",
  "title": "S3 Block Public Access is on at the account and every bucket",
  "severity": "critical",
  "refs": [{ "framework": "cis-aws", "ref": "2.1.5" }, { "framework": "csf", "ref": "PR.DS-01" }],
  "evidence": { "connector_type": "aws", "capability": "read:cloud.aws", "collector": "s3.public_access" },
  "seed": { "dataset": "cloud-baseline.json", "id": "aws-data-s3-block-public-access" },
  "resolved_by": ["cloud.block-public-storage"]
}
```

`collector` names a function in the connector's MCP server that returns an evidence document. `seed` links back to the site dataset so the plain-English rationale and the roadmap KPIs come along.

## 9. Write calls

A playbook's `call_schema` lists the MCP tools it may call and the constraints on their parameters. Two constraints are universal:

- **Target must come from the finding.** Any parameter that names an asset (`bucket`, `user_id`, `role_arn`) must appear in the affected-asset list of a finding the sortie is resolving. The executor checks this, not the agent.
- **Preview equals execute.** The executor rejects any executed call whose `params_hash` is not in the approved preview.

Every write tool has a matching `verify` (re-run the check on the same assets) and, where the playbook is reversible, a `rollback` that restores the configuration captured in the preview phase.

## 10. Rate limits, retries, pagination

- Honor vendor throttling with exponential backoff and jitter; never retry a write more than once, and only when the vendor confirms the first attempt did not apply.
- Page through everything; a collector that stops at the first page is a bug, and the evidence document records `pages` and `truncated`.
- Collectors are idempotent and read-only by construction: a collector module cannot import a write client.

## 11. Failure taxonomy

| Code | Meaning | Effect |
|---|---|---|
| `trust_not_completed` | Consent or role trust missing | Stays `awaiting_customer` |
| `identity_mismatch` | The credential resolves to a different tenant or account than `external_ref` | Refuse `complete`; audit |
| `scope_lost` | A previously granted permission is gone | `degraded`; lock missions |
| `credential_expired` | Refresh or assume fails permanently | `expired`; notify customer admin |
| `scope_violation` | A call targeted something outside mission scope | Call refused; audit; sortie fails closed |
| `throttled` | Vendor rate limit | Backoff; mission continues |
| `partial_coverage` | Some regions, units, or repos unreadable | Evidence marked `unknown` for those; warning on health |

## 12. Revocation

`DELETE /connectors/{id}` revokes at the vendor first where possible (delete the service principal's consent, or instruct the customer to delete the role since Outpost cannot), deletes the secret row, revokes any live derived credential, locks dependent missions, and disables enablements that need a lost write capability. The audit event carries the before-state of scopes.
