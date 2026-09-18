# Outpost router contracts

**Status:** draft v0.1 (2026-09-18). Companion to [schema.sql](schema.sql), [engine_contract.py](engine_contract.py), and [TENANT-ISOLATION.md](TENANT-ISOLATION.md). Shapes are written as TypeScript interfaces because the React client consumes them; the FastAPI side generates OpenAPI from Pydantic models with the same field names.

---

## 1. Conventions that apply to every endpoint

- **Base path** `/api/v1`. All responses are JSON. Timestamps are RFC 3339 UTC. Ids are UUIDs.
- **Auth.** `Authorization: Bearer <access token>` (15-minute JWT). Middleware verifies the signature, checks `platform.sessions` for revocation, builds `RequestContext`, opens the transaction, and runs the three `SET LOCAL` statements. No endpoint reads tenant identity from anywhere else.
- **`tenant_id` is forbidden in requests.** Any path, query, or body field named `tenant_id` returns `400 tenant_id_not_allowed`. The acting tenant is always the token's.
- **Cross-tenant ids return 404**, indistinguishable from a missing id, and write an audit event with `target_tenant_id` set.
- **Errors** are RFC 9457 `application/problem+json`: `{ type, title, status, code, detail?, request_id, errors?: [{field, message}] }`. Codes referenced below are the `code` field.
- **Idempotency.** Every `POST` that creates a resource accepts `Idempotency-Key`; a repeat with the same key and body returns the original response, a repeat with a different body returns `409 idempotency_conflict`.
- **Pagination.** `?limit=` (default 25, max 100) and `?cursor=`. Responses are `{ items: T[], next_cursor: string | null }`.
- **Audit.** Every mutating call, every approval, every session switch, and every read by an actor whose home tenant differs from the acting tenant writes to the flight recorder.
- **Streams** are Server-Sent Events. The server re-checks the session on connect and closes the stream when the token expires or the session is revoked.
- **Roles** are abbreviated: PA platform admin, FA firm admin, CL consultant lead, CA consultant analyst, CuA customer admin, CuO customer operator, CuV customer viewer, AU auditor. "Cu*" means any customer role. A consultant's role only applies inside an active engagement.

Shared shapes:

```ts
type Mode = 'autopilot' | 'clearance' | 'beacon';
type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
interface Page<T> { items: T[]; next_cursor: string | null }
interface Problem { type: string; title: string; status: number; code: string; detail?: string; request_id: string; errors?: { field: string; message: string }[] }
interface Actor { user_id: string; display_name: string; side: 'customer' | 'consultant' | 'platform' }
```

---

## 2. Session

| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | `/session` | any | Who am I, acting as what. Never returns secrets. |
| POST | `/session/switch` | CL, CA, PA | Enter a customer tenant through an engagement (or a break-glass grant). Verifies the assignment is active and inside the window, mints a new token, revokes the old session id, writes an audit event to the customer's and the firm's chains. |
| POST | `/session/return` | CL, CA, PA | Back to the home tenant. Same token rotation and audit. |
| DELETE | `/session` | any | Log out; revoke the session id. |

```ts
interface SessionInfo { user_id: string; home_tenant: TenantRef; acting_tenant: TenantRef; role: string; engagement_id: string | null; break_glass_grant: string | null; expires_at: string }
interface TenantRef { id: string; kind: 'customer' | 'firm'; name: string; slug: string }
interface SwitchRequest { engagement_id?: string; break_glass_grant_id?: string }
interface TokenResponse { access_token: string; expires_at: string; session: SessionInfo }
```
Errors: `403 assignment_inactive`, `403 engagement_outside_window`, `403 mfa_required` (phishing-resistant MFA is required to switch).

---

## 3. Platform (operators only)

| Method | Path | Roles | Purpose |
|---|---|---|---|
| POST | `/platform/tenants` | PA | Create a customer or firm. Runs the provisioning job: KMS key, ES alias and API key, Redis prefix, default provider policy. Returns `202` with the job. |
| GET | `/platform/tenants`, `/platform/tenants/{id}` | PA | Metadata only, never tenant data. |
| POST | `/platform/tenants/{id}/offboard` | PA (two distinct admins) | Export, revoke connectors, schedule crypto-shred. Second admin confirms with `POST .../offboard/confirm`. |
| POST | `/platform/break-glass` | PA | Request a grant `{ tenant_id, reason, hours ≤ 4 }`. A different PA approves with `POST /platform/break-glass/{id}/approve`. The customer admin is notified at approval time. |

---

## 4. Firm and engagements

| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | `/firm/fleet` | FA, CL, CA | The Command Deck. Returns `EngagementSummary[]` for the caller's assignments: counts and bands only, from `platform.engagement_summaries`. No customer row is read. |
| POST | `/firm/engagements` | FA | Propose an engagement `{ customer_slug, starts_at, ends_at }`. Status `draft` until the customer accepts. |
| POST | `/engagements/{id}/accept` | CuA | Customer accepts; status `active`. Audited on both chains. |
| POST | `/engagements/{id}/end` | FA or CuA | Ends early; revokes all assignments. |
| POST | `/engagements/{id}/assignments` | FA | `{ user_id, role: 'lead' | 'analyst' }`. |
| DELETE | `/engagements/{id}/assignments/{aid}` | FA or CuA | Either side revokes; `revoked_side` records which. Revokes any live session acting through it. |
| GET | `/engagements/{id}` | FA, CL, CA, CuA | Engagement, assignments, status. |

```ts
interface EngagementSummary { engagement_id: string; customer: TenantRef; missions_due: number; approvals_waiting: number; sorties_failed_7d: number; findings_open: number; findings_critical: number; connectors_unhealthy: number; posture_band: string | null; as_of: string }
```

---

## 5. Tenant settings (acting tenant)

| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET / PUT | `/tenant/profile` | GET Cu*, CL, CA; PUT CuA, CL | Customer profile (industry, headcount, regions, data types, clouds). Regulations are derived, not set. |
| GET / PUT | `/tenant/provider-policy` | GET CuA, AU, CL; PUT CuA only | AI provider allowlist, residency, default tier. Widening is audited with the before and after. |
| GET | `/tenant/access-log` | Cu*, AU | Who from outside this tenant looked at what, when. Derived from the flight recorder (`actor_home_tenant_id != tenant_id`). |
| POST | `/tenant/kill-switch` | CuA, CL | Cancel every queued and in-flight sortie, revoke run credentials, disable Autopilot enablements. Requires a reason. Re-enabling is per playbook. |

```ts
interface ProviderPolicy { providers: ('bedrock' | 'openai' | 'gemini')[]; residency: 'us' | 'eu'; default_tier: 'opus' | 'sonnet' | 'haiku'; guardrail_id: string | null; updated_by: Actor | null; updated_at: string }
```

---

## 6. Connectors (the Hangar)

| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | `/connectors` | Cu*, CL, CA | List with health and the missions each unlocks. |
| POST | `/connectors` | CL, CuA | Request a connection `{ type_id, display_name, requested_scopes }`. Status `awaiting_customer`. Returns the trust instructions. |
| GET | `/connectors/{id}` | Cu*, CL, CA | Detail. Never includes a secret; `external_ref` only. |
| GET | `/connectors/{id}/trust-instructions` | CuA | What the customer applies: an OAuth consent URL bound to `{tenant, connector, user}` state, or a role-trust template with the per-tenant `ExternalId`. |
| POST | `/connectors/{id}/complete` | **CuA only** | Finish the trust step: `{ oauth_code, state }` or `{ role_arn }`. The server exchanges the code or assumes the role once, stores the secret envelope-encrypted with the tenant's KMS key, runs a health check, derives capabilities, sets `connected`. A consultant calling this gets `403 customer_must_complete`. |
| GET | `/connectors/oauth/callback` | (browser) | Provider redirect. State is single-use and bound to the requesting customer user's session; mismatch is `400 oauth_state_invalid`. |
| POST | `/connectors/{id}/health` | Cu*, CL | Re-check now. |
| POST | `/connectors/{id}/scopes` | CL, CuA | Request additional (write) scopes; goes back to `awaiting_customer`. Read and write scopes are always separate requests. |
| DELETE | `/connectors/{id}` | CuA | Revoke at the vendor where possible, then delete the secret. Missions that depended on it lock. |

```ts
interface Connector { id: string; type_id: string; family: string; display_name: string; status: 'requested' | 'awaiting_customer' | 'connected' | 'degraded' | 'revoked' | 'expired'; external_ref: Record<string, string>; requested_scopes: string[]; granted_scopes: string[]; capabilities: string[]; health: { ok: boolean; checked_at: string; detail?: string } | null; unlocks: { mission_id: string; title: string }[]; requested_by: Actor | null; completed_by: Actor | null; completed_at: string | null }
interface TrustInstructions { kind: 'oauth' | 'aws-role' | 'gcp-wif' | 'azure-federated' | 'api-key'; consent_url?: string; template?: Record<string, unknown>; external_id?: string; minimum_permissions: { scope: string; permissions: string[]; unlocks: string[] }[]; expires_at: string }
```

---

## 7. Catalog (shared, read-only)

| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | `/catalog/missions` | any tenant role | Every mission with `unlocked: boolean` and `missing_capabilities: string[]` computed against this tenant's healthy connectors. |
| GET | `/catalog/missions/{id}` | any | Checks, questionnaire, seed dataset, refs. |
| GET | `/catalog/playbooks`, `/catalog/playbooks/{id}` | any | Includes `mode_ceiling`, `blast_radius`, `reversible`, required write scopes, the call schema, verification, rollback. |
| GET | `/catalog/connector-types` | any | Auth kind, capabilities, minimum permissions, trust template. |
| GET | `/catalog/agents`, `/catalog/mcp-servers` | any | Agent risk tier and threat model link; MCP review status and pinned digest. |

---

## 8. Missions

| Method | Path | Roles | Purpose |
|---|---|---|---|
| POST | `/missions/runs` | CL, CuA | Start a run `{ mission_id, scope, connector_ids, model_route? }`. `409 mission_locked` when capabilities are missing; `403 provider_not_allowed` when `model_route` names a forbidden provider. Returns `202` with the run in `assessing`. |
| GET | `/missions/runs` | Cu*, CL, CA | Filter by `mission_id`, `status`. |
| GET | `/missions/runs/{id}` | Cu*, CL, CA | Run detail and scope. |
| GET | `/missions/runs/{id}/stream` | Cu*, CL, CA | SSE of run events from the blackboard. |
| POST | `/missions/runs/{id}/answers` | CuO, CuA, CL, CA | Bulk `{ answers: { question_id, answer, note? }[] }` for questions with no evidence hook. Auto-answered questions cannot be overridden except by CuA with a reason (recorded as `alt` with evidence `{override:true}`). |
| POST | `/missions/runs/{id}/assess` | CL, CuA | Resume after answers are in; scores and produces findings and recommendations. |
| GET | `/missions/runs/{id}/briefing` | Cu*, CL, CA | The Briefing: score, band, groups, delta vs. previous run, findings by severity, recommendations. |
| POST | `/missions/runs/{id}/cancel` | CL, CuA | Cancel. |

```ts
interface MissionRun { id: string; mission_id: string; status: 'scoped' | 'assessing' | 'awaiting_answers' | 'briefed' | 'planned' | 'failed' | 'cancelled'; scope: Record<string, unknown>; connector_ids: string[]; previous_run_id: string | null; started_by: Actor | null; started_at: string | null; finished_at: string | null; score: number | null; band: string | null; model_route: { provider: string; model_id: string } | null }
interface Briefing { run: MissionRun; result: AssessmentResult; delta: { previous_run_id: string; score_change: number; new_findings: number; resolved_findings: number } | null; findings: Finding[]; recommendations: Recommendation[]; unanswered: { question_id: string; text: string }[] }
interface AssessmentResult { answered: number; total: number; applicable: number; overall_percent: number; tier_percents: Record<string, number>; groups: { id: string; name: string; percent: number; answered: number; applicable: number }[]; distribution: Record<'yes' | 'alt' | 'na' | 'no', number>; attained_tier: string | null; insufficient: boolean }
```

---

## 9. Findings

| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | `/findings` | Cu*, CL, CA | Filters: `status`, `severity`, `mission_id`, `crosswalk_domain`, `asset_kind`, `asset_ref`. |
| GET | `/findings/{id}` | Cu*, CL, CA | Detail with assets, evidence, plain-English explanation, framework refs, resolving sorties. |
| PATCH | `/findings/{id}` | CuA (accept risk, needs `reason`); CL, CuO (`in_remediation`) | Status changes only; evidence and severity come from runs. |
| GET | `/findings/{id}/history` | Cu*, CL, CA, AU | Every run that saw it, every status change, every sortie that touched it. |

```ts
interface Finding { id: string; mission_run_id: string; mission_id: string; check_id: string; fingerprint: string; title: string; severity: Severity; status: 'open' | 'accepted_risk' | 'in_remediation' | 'resolved' | 'reopened'; crosswalk_domain: string | null; framework_refs: { framework: string; ref: string }[]; explanation: string | null; evidence: Record<string, unknown>; assets: { kind: string; ref: string }[]; first_seen_at: string; last_seen_at: string; resolved_at: string | null; resolved_by_sortie: string | null }
```

---

## 10. Recommendations and plans

| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | `/recommendations` | Cu*, CL, CA | Filter by `mission_run_id`, `decision`. |
| POST | `/recommendations/{id}/decision` | CL, CuA | `{ decision: 'accepted' | 'rejected' | 'deferred', mode?, cadence?, change_window? }`. Accepting creates a `PlaybookEnablement` (disabled until enabled, see §11) and a plan task. `mode` above the playbook's `mode_ceiling` is `422 mode_exceeds_ceiling`. |
| GET / POST | `/plans` | GET Cu*, CL, CA; POST CL, CuA | Remediation plans (roadmap planner model). |
| GET / PATCH | `/plans/{id}`, `/plans/{id}/tasks/{tid}` | PATCH CuO, CuA, CL | Quarter, status, owner, due date, note, KPI status, milestones. |
| GET | `/plans/{id}/export?format=csv|json` | Cu*, CL, CA | Same shapes as the site's `planToCsv` and JSON export. |
| POST | `/import/alphabet-soup` | CL, CuA | Upload an `alphabet-soup-backup` bundle; pre-fills questionnaire missions from the customer's free-site assessments. Rejects keys outside the `alphabetsoup:` prefix. |

```ts
interface Recommendation { id: string; mission_run_id: string; playbook: { id: string; title: string; mode_ceiling: Mode; blast_radius: 'low' | 'medium' | 'high'; reversible: boolean }; finding_ids: string[]; suggested_mode: Mode; suggested_cadence: string; rationale: string; decision: 'pending' | 'accepted' | 'rejected' | 'deferred'; decided_by: Actor | null; decided_at: string | null }
```

---

## 11. Playbook enablements

| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | `/playbooks` | Cu*, CL, CA | This tenant's enablements with mode, cadence, next run, last sortie. |
| POST | `/playbooks` | CL, CuA | `{ playbook_id, mode, cadence, change_window? }`. Created disabled. |
| PATCH | `/playbooks/{id}` | CL, CuA | Change mode, cadence, window. Any change to an enabled Autopilot enablement disables it until re-approved. |
| POST | `/playbooks/{id}/enable` | CL, CuA | Beacon and Clearance: enables immediately. Autopilot: `403 autopilot_requires_dual_approval` unless both sides have approved `subject_kind: 'enablement'` for the current config hash (§13), and `422 autopilot_not_eligible` unless `blast_radius: low`, `reversible`, and `consecutive_verified >= 3`. Creates or updates the Temporal schedule. |
| POST | `/playbooks/{id}/disable` | CL, CuA, CuO | Either side alone. Pauses the schedule; in-flight sorties finish or are cancelled per `{ cancel_in_flight }`. |
| POST | `/playbooks/{id}/run` | CuO, CuA, CL | Start a manual sortie now (the Beacon button). Clearance still applies if the mode is Clearance. |

```ts
interface PlaybookEnablement { id: string; playbook: Recommendation['playbook']; mode: Mode; cadence: string; change_window: { tz: string; days: number[]; start: string; end: string } | null; enabled: boolean; enabled_at: string | null; next_run_at: string | null; consecutive_verified: number; config_hash: string; approvals: ApprovalState; last_sortie: SortieSummary | null }
```

---

## 12. Sorties

| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | `/sorties` | Cu*, CL, CA | Filter by `status`, `playbook_id`, `finding_id`. |
| GET | `/sorties/{id}` | Cu*, CL, CA | Preview, preview hash, plan summary, calls by phase, verification, rollback, approvals. |
| GET | `/sorties/{id}/stream` | Cu*, CL, CA | SSE from the run's blackboard channel. |
| POST | `/sorties/{id}/cancel` | CL, CuA, CuO | Cancel a queued or waiting sortie; in-flight execution completes the current call, then rolls back if reversible. |
| POST | `/internal/sorties/{id}/calls` | run token only | Worker appends preview, execute, and rollback calls. The token's `acting_tenant` is fixed at launch; an executed call whose `params_hash` is not in the approved preview is rejected with `409 call_not_in_preview` and the sortie fails closed. |
| POST | `/internal/sorties/{id}/verification` | run token only | Worker reports the re-run check result. `succeeded` closes the findings; `verification_failed` triggers rollback. |

```ts
interface Sortie { id: string; playbook_id: string; enablement_id: string | null; trigger: 'scheduled' | 'manual' | 'on_finding'; mode: Mode; status: 'planning' | 'previewed' | 'awaiting_clearance' | 'approved' | 'executing' | 'verifying' | 'succeeded' | 'verification_failed' | 'rolled_back' | 'rollback_failed' | 'rejected' | 'expired' | 'cancelled' | 'failed'; finding_ids: string[]; preview: SortieCall[] | null; preview_hash: string | null; plan_summary: string | null; calls: { preview: SortieCall[]; execute: SortieCall[]; rollback: SortieCall[] }; approvals: ApprovalState; verification: { status: 'pending' | 'passed' | 'failed'; detail?: string } | null; requested_by: Actor | null; started_at: string | null; executed_at: string | null; finished_at: string | null; killed_by: Actor | null }
interface SortieCall { seq: number; mcp_server_id: string; tool: string; params: Record<string, unknown>; params_hash: string; status: 'pending' | 'ok' | 'error' | 'rejected' | 'skipped'; result?: Record<string, unknown>; at: string }
type SortieSummary = Pick<Sortie, 'id' | 'status' | 'trigger' | 'started_at' | 'finished_at'>
```

---

## 13. Approvals (Clearance)

| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | `/approvals` | CuA, CL | The queue for the caller's side: sorties in `awaiting_clearance` and Autopilot enablements awaiting the caller's signature. |
| POST | `/approvals` | CuA (customer side), CL (consultant side) | `{ subject_kind: 'sortie' | 'enablement', subject_id, subject_hash, decision: 'approved' | 'rejected', comment? }`. The server derives `side` from the context: `home_tenant == acting_tenant` is customer, otherwise consultant. `409 stale_subject_hash` if the preview or config changed. A rejection from either side ends the sortie as `rejected`. When both sides have approved the same hash the sortie moves to `approved` and the Temporal workflow is signalled. |
| GET | `/approvals/{id}` | CuA, CL, AU | Detail. |

```ts
interface ApprovalState { subject_hash: string; customer: ApprovalRecord | null; consultant: ApprovalRecord | null; complete: boolean; expires_at: string }
interface ApprovalRecord { id: string; approver: Actor; decision: 'approved' | 'rejected'; comment: string | null; decided_at: string; consumed_at: string | null }
```
Rules the endpoint enforces: one approval per side per hash (unique index), the approver cannot be the sortie's `requested_by` when the sortie was started manually, approvals expire after 72h, and an approval is consumed when the sortie executes so it can never authorize a second run.

---

## 14. External attack surface

| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | `/scan/assets` | Cu*, CL, CA | Assets with verification state and probing flags. |
| POST | `/scan/assets` | CL, CuA | Propose `{ kind, value }`. Unverified until the customer completes a challenge. Assets discovered from a connected cloud inventory arrive verified with `source: 'aws-inventory'`. |
| POST | `/scan/assets/{id}/challenge` | CuA | `{ method: 'dns-txt' | 'well-known' }` returns the token to place. |
| POST | `/scan/assets/{id}/verify` | CuA | Checks the challenge; sets `verified_at`, `verified_by`. |
| PATCH | `/scan/assets/{id}` | CuA | `active_probing_allowed`, `rate_limit_rps`, `retired_at`. Probing on an unverified asset is `422 asset_unverified`. |
| GET | `/scan/observations?asset_id=&since=` | Cu*, CL, CA | Observations and what disappeared (`gone_at`). |

---

## 15. Flight recorder

| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | `/audit/events` | CuA, AU, CL | Cursor over this tenant's chain. Filters: `action`, `actor_user_id`, `since`, `until`, `cross_tenant_only`. |
| GET | `/audit/export` | CuA, AU | JSONL stream of the full chain with `prev_hash` and `hash`, plus the anchored head hash, so an external auditor can verify it. |
| GET | `/audit/verify` | CuA, AU | Runs `outpost.audit_verify`; returns `{ ok, first_broken_seq }`. |

```ts
interface AuditEvent { seq: number; at: string; actor: Actor | null; actor_home_tenant: TenantRef | null; engagement_id: string | null; action: string; resource_kind: string | null; resource_id: string | null; target_tenant_id: string | null; request_id: string | null; detail: Record<string, unknown>; prev_hash: string | null; hash: string }
```

---

## 16. Notifications

| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | `/notifications` | any tenant role | Beacon reminders, clearance requests, failures. |
| POST | `/notifications/{id}/read` | owner | Mark read. |
| GET / PUT | `/notifications/channels` | CuA (tenant), any (own) | Email, Slack, Teams destinations. Webhook URLs are stored encrypted like connector secrets. |

---

## 17. Engine routers mounted under `/engine`

From `EngineRouters` in the package contract, each mounted with Outpost's `ContextDependency`:

| Mount | Factory | Notes |
|---|---|---|
| `/engine/missions` | `missions(ctx)` | Low-level mission records behind `/missions/runs`. Read-only from the client. |
| `/engine/findings` | `findings(ctx)` | Raw findings; Outpost's `/findings` is the normalized view. |
| `/engine/knowledge` | `knowledge(ctx)` | Search across the shared corpus and this tenant's corpus. |
| `/engine/frameworks` | `frameworks(ctx)` | Shared framework controls with plain-English text. |

Nothing from the engine's operator bucket is mounted.

---

## 18. Internal and job endpoints

Called by run workers and provisioning jobs with their own short-lived tokens, never by the browser. Each token's `acting_tenant` is fixed at issue.

| Method | Path | Caller | Purpose |
|---|---|---|---|
| POST | `/internal/sorties/{id}/calls`, `/verification` | run worker | See §12. |
| POST | `/internal/missions/runs/{id}/evidence` | run worker | Connector evidence for auto-answered questions and check results. |
| PUT | `/internal/summaries/{engagement_id}` | tenant summary job | Counts only, into `platform.engagement_summaries`. |
| POST | `/internal/tenants/{id}/provision`, `/offboard` | provisioning job | Idempotent steps with retries; each step audited. |
