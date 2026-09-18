# Outpost <-> Reasoning Engine package contract

**Status:** draft v1.0 (2026-09-18). The typed interface is [engine_contract.py](engine_contract.py); this page is the part that does not fit in a type signature. Decided in README §10: Outpost is a new repository that imports the engine as a package.

---

## 1. Packaging and versioning

- The engine publishes a wheel, `reasoning-engine`, to a private index. `reasoning_engine.contract` is the only module Outpost imports; everything else is internal and may change without notice.
- Outpost pins `reasoning-engine ~= 1.0` and upgrades deliberately. The engine's own release cadence is decoupled.
- Semver against the contract: a new optional field or a new Protocol is minor; removing, renaming, changing a table's tenant classification, or changing `RequestContext` is major.
- `CONTRACT_VERSION` in the module is asserted at Outpost startup against the version Outpost was built for. A mismatch refuses to boot.

## 2. What the engine must change before 1.0 ships

This is the tenancy retrofit, and it lands in the engine as its own release before Outpost's Phase 0 starts.

| Change | Why |
|---|---|
| `tenant_id uuid not null` on every table in `TENANT_SCOPED_TABLES`, with RLS enabled, forced, and a `tenant_isolation` policy identical to Outpost's `outpost.protect()` | RLS is the first line; the engine's own tables cannot be the hole. Outpost's `check_rls.sql` is extended to read `TENANT_SCOPED_TABLES` from the installed package and lint those tables too. |
| Every repository method takes a `TenantSession` (already scoped by Outpost's middleware) instead of opening a connection | The engine never chooses the tenant. |
| Every router endpoint depends on the supplied `ContextDependency`; the engine stops exporting a mounted `app` and exports `EngineRouters` factories instead | Outpost's auth wraps everything. |
| The model gateway takes `TenantModelPolicy` per call and raises `ProviderNotAllowed` | Per-tenant provider allowlist is enforced in the gateway, not in mission config. |
| The blackboard client takes a `BlackboardCredential` per call instead of a process-wide Redis connection for tenant data | Per-run ACL users. |
| Elasticsearch calls go through `IndexResolver`; no index name is ever a string literal in engine code | Per-tenant aliases and API keys. |
| Embedding and prompt caches are keyed by tenant, or removed | No cross-tenant content oracle. |
| The site's `assessment.ts`, `roadmap.ts` gap planner, and `readinessBand` are ported to Python behind `Scoring` | Deterministic scoring with no model call; identical numbers to the free site. |
| The site's datasets and framework corpora ship as package data behind `DatasetLoader` and are loaded into `SHARED_TABLES` and the `shared` index at provisioning | One source of truth for reference content. |
| `reasoning_engine.testing.two_tenant` fixture | Outpost's CI proves the engine's own routers isolate. |

## 3. What happens to the existing 38 routers

Sort each router into one of three buckets during the retrofit. A router that mixes buckets is split.

1. **Tenant-scoped** (missions, findings, datasets, blackboard streaming, model invocation history). Rewritten to the `ContextDependency` and `TenantSession` pattern and exported through `EngineRouters`. Mounted by Outpost under `/api/v1/engine/*`.
2. **Shared read-only** (ontology browse, framework controls, tool definitions). Take `ContextDependency` for auth and audit but touch no tenant table. Exported through `EngineRouters.frameworks` and mounted.
3. **Operator and internal** (health, admin, dataset ingestion, model routing config, anything that manages the engine itself). Not exported and not mounted in Outpost. Outpost's provisioning job calls the engine's Python API for the few of these it needs (loading the shared corpus).

Any router in bucket 1 that cannot be made to take a `TenantSession` is a finding, not a workaround: fix the engine, do not wrap it in Outpost.

## 4. Session and transaction ownership

- Outpost opens the transaction, runs the three `SET LOCAL` statements as `outpost_app`, builds `RequestContext`, and hands both to the engine.
- The engine never commits, never rolls back, never changes role, never runs `SET`. Repositories are pure data access on the session they are given.
- One request, one transaction, one tenant. Background work (a mission executing inside a run container) uses a run token whose `acting_tenant` is fixed at launch, and the same pattern applies.

## 5. Untrusted content

`ModelRequest.untrusted_segments` exists so the engine's prompt assembly can wrap connector-derived text as delimited, labeled data. The gateway must never place an untrusted segment where it can be read as an instruction, and the engine's tool-call parser must never select a tool from text inside one. This is checked by the prompt-injection corpus in Outpost's release gate; the engine ships the corpus with the package so it can test itself too.

## 6. Non-goals of the contract

- The contract does not cover playbooks, sorties, approvals, connectors, schedules, or the scanner. Those are Outpost's, and the engine knows nothing about them.
- The contract does not expose engine agents directly. Outpost's playbooks call MCP tools; the engine's role in a sortie is planning and explanation through `ModelGateway`, not execution.
- No engine API returns a secret. `IndexTarget` and `BlackboardCredential` are the only credential-bearing objects, both flow *into* the engine, and both keep secrets out of `repr`.
