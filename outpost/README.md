# Outpost

Consultant-led, AI-driven security remediation on the Reasoning Engine.

The design documents (roadmap, tenant isolation, engine contract, schema, router contracts, connector specs, screen mockups) live in the Alphabet Soup repository under [`docs/outpost/`](https://github.com/thestateofcybersecurity/AlphabetSoup/tree/main/docs/outpost). The SQL in `sql/` is the canonical copy once this repository exists; the design copies are reference. CI runs ruff and the two-tenant suite against a Postgres 16 service on every push and pull request.

## What is here

| Path | What |
|---|---|
| `sql/migrations/` | `0001_bootstrap.sql` is the schema from the design docs (three schemas, three roles, forced RLS on every tenant table, hash-chained audit). `0002_user_roles.sql` adds the home-tenant role column. |
| `sql/seed/catalog.sql` | Catalog rows for the Entra ID and AWS connectors, their missions, playbooks, agents, and MCP servers. |
| `sql/lint/` | `check_rls.sql` and `check_catalog.sql`; both must return zero rows. |
| `src/outpost/contract.py` | Vendored copy of the engine package contract. Replace with `from reasoning_engine.contract import ...` when the engine publishes 1.0. |
| `src/outpost/context.py` | The tenant middleware as a FastAPI dependency: verifies the token, checks session revocation, **rejects any `tenant_id` in path, query, or body**, and opens a transaction with `SET LOCAL app.tenant_id` as `outpost_app`. |
| `src/outpost/auth.py` | Token issue and verify, the sessions table, and the session switch that mints a new token, revokes the old one, and writes to both flight recorders. |
| `src/outpost/authz.py` | One policy table. Handlers call `authorize(ctx, action)` and never inline role checks. |
| `src/outpost/audit.py` | Append-only audit writes. |
| `src/outpost/secrets.py` | The envelope interface for connector secrets with a dev implementation; the KMS implementation is the first production task. |
| `src/outpost/routers/` | `session`, `connectors`, `catalog`, `audit`, `health`. Contracts in `docs/outpost/ROUTERS.md`. |
| `src/outpost/cli.py` | `outpost migrate`, `outpost seed`, `outpost lint`. |
| `tests/` | The two-tenant harness. Every tenant-scoped route is walked as tenant A against tenant B's ids and must return 404 with an empty body; every mutating route is sent a `tenant_id` and must return 400; the consultant switch, customer-only connector completion, audit chains, and both SQL lints are exercised. |

## Run it

```bash
docker compose up -d postgres
cp .env.example .env
make setup migrate seed
make test
make run          # http://localhost:8000/docs
```

Tests need a superuser DSN in `OUTPOST_TEST_ADMIN_DSN` (defaults to `postgresql://postgres@localhost:5432/postgres`); they create and drop a database named `outpost_test`.

## What is deliberately not here yet

- Real identity: `POST /session/dev-login` issues a token for a seeded user and exists only when `OUTPOST_ENV=dev`. Production is OIDC through Cognito with phishing-resistant MFA.
- Real connector drivers: `connectors.complete` calls a driver interface; the dev driver marks the connector connected and grants every read capability. The Entra ID and AWS drivers implement the health checks in `docs/outpost/connectors/`.
- KMS envelope encryption, Elasticsearch aliases, Redis ACL users, Temporal workflows, run workers, missions, playbooks, sorties, approvals. Each has a schema table and a router contract; none has code.
