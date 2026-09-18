# Outpost: AI-driven security remediation platform

**Status:** roadmap, v0.2 (2026-09-18). Nothing here is built yet. The eight open questions from v0.1 are decided; see §10.
**Companion doc:** [TENANT-ISOLATION.md](TENANT-ISOLATION.md) covers the multi-tenant security architecture in depth.

"Outpost" is the codename (decided 2026-09-18). It is not a Star Wars trademark and does not collide with a current security product, but check the mark before it goes on a public page.

---

## 1. The pitch

A consultant connects a customer's environment, the platform assesses it across every cybersecurity domain, and then AI agents and MCP services remediate what they find on a cadence the customer chooses: fully automatic, human-approved, or human-reminded.

Three things make it different from a scanner or a GRC tool:

1. **Consultant-led scope.** Nothing runs until a consultant and the customer agree on which connectors are in place. Connectors, not a sales SKU, unlock missions.
2. **Missions, not dashboards.** Every engagement is a sequence of missions. A mission assesses one thing with one tool, produces findings, and recommends the playbooks that would fix them and how often they should run.
3. **Remediation with a dial.** Each playbook runs in one of three modes. The customer can turn the dial per playbook, and the platform enforces a ceiling per playbook based on blast radius.

The Reasoning Engine (FastAPI, Postgres, Elasticsearch, Redis, Bedrock gateway) already has missions, findings, datasets, an ontology, and a live agent blackboard. Outpost is a **new repository** that imports the engine as a package and adds the multi-tenant boundary, the connector and playbook layers, and its own UI. It is not a second backend, and it is not a fork.

---

## 2. What we already have to build from

The Alphabet Soup site is client-only, but every scoring and planning module in `src/lib/` is pure TypeScript with no DOM dependency, and every dataset in `src/data/` is fact-checked JSON. That gives us a seed catalog on day one. The table maps each site asset to its role in Outpost.

| Site asset | Where it lives | Role in Outpost |
|---|---|---|
| 10 self-assessments (Ransomware, CISA CPG, CIS IG1, CIS v8, NIST CSF, 800-171/CMMC, Cyber Essentials, Zero Trust, SSDF, PCI DSS) | `src/data/assessment*.json`, `src/lib/assessment.ts` | **Questionnaire missions.** Same question bank, but each question gets an optional `evidence` hook so a connector can auto-answer it. `scoreAssessment`, `readinessBand`, `latestDelta` port as-is for scoring and trend. |
| Security program (16 goals, KPIs, milestones, hours) and roadmap planner | `security-program.json`, `roadmap-kpis.json`, `src/lib/roadmap.ts` | **Remediation plan model.** A mission's accepted recommendations become a plan with quarters, owners, KPIs, and maturity roll-up. `gapsPlan` already turns assessment answers into tasks. |
| vCISO task library (89 tasks, hours, package size) | `vciso-tasks.json` | **Consultant engagement template.** Pre-loads the consultant's own work items per engagement size. |
| Policy generator (24 policies, IG-tiered, placeholder-filled) | `policies.json`, `src/lib/policy.ts` | **GRC playbook.** The policy-drafting agent starts from `selectPolicies` + `fill`; findings link to the policy that should exist. |
| Regulatory mapper (16 regulations, triggers, first-90) | `regulations.json`, `src/lib/reg-mapper.ts` | **Scoping step.** The customer profile determines which regulations apply, which weights findings and unlocks compliance missions. |
| Crosswalk (24 domains across CSF / ISO / SOC 2 / CIS) | `crosswalk.json`, `src/lib/crosswalk.ts` | **Findings normalization.** Every finding is tagged to a crosswalk domain so one fix updates every framework view. |
| Cloud baseline (54 CIS Foundations controls, AWS/Azure/GCP, 30/60/90) | `cloud-baseline.json`, `src/lib/cloud-baseline.ts` | **Cloud posture mission.** Each control gets a connector check and a playbook. `buildPlan` becomes the recommended cadence. |
| Secure SDLC rubric (19 practices, 6 phases) + SSDF assessment | `ssdlc.json`, `src/lib/ssdlc.ts` | **AppSec mission.** Repo connectors evidence the practices; `adoptionPlan` sequences the playbooks. |
| Incident runbooks (5 scenarios, injects, comms templates) | `runbooks.json`, `src/lib/runbook.ts` | **IR readiness mission and tabletop playbook.** The tabletop-scheduler agent fills and schedules them. |
| AI risk tiering, AI threat model, AI workload control mapper | `ai-risk-tiering.json`, `ai-threat-model.json`, `ai-cloud-controls.json` and their libs | **AI security domain.** Use-case register, threat register, and cloud-native control checks. Also the model for how Outpost governs *its own* agents (see §7). |
| Board metrics (12 metrics, thresholds, talk tracks) | `board-metrics.json`, `src/lib/board-metrics.ts` | **Executive reporting.** Mission results feed metric values automatically. |
| Automation ROI | `automation-roi.json`, `src/lib/automation-roi.ts` | **Playbook prioritization.** Ranks which agents to switch on first by hours saved vs. effort. |
| Skills matrix | `skills-matrix.json`, `src/lib/skills-matrix.ts` | **People domain.** Team coverage feeds the "who owns this remediation" question. |
| Trust package (39 answers, TF-IDF matching) | `trust-library.json`, `src/lib/trust-package.ts` | **Third-party domain.** Vendor questionnaire responder agent, seeded from the customer's own findings. |
| Framework corpora with plain-English translations (CSF 106, CIS 153, ISO 93, SOC 2 38, HIPAA 22, AI 155) | `src/data/*.json` | **Ontology and explanation layer.** Load into the Reasoning Engine ontology and Elasticsearch so every finding can explain itself in plain English. |
| Backup bundle format | `src/lib/my-data.ts` | **Import path.** A customer who used the free site can hand their consultant an `alphabet-soup-backup` file to pre-fill missions. |

**Gap:** the site has no data for identity, endpoint, email, network, vulnerability management, or detection coverage. Those domains need new datasets in Phase 1 (see §4).

---

## 3. Core concepts

| Concept | Definition | Star Wars-flavored UI name |
|---|---|---|
| **Tenant** | A customer organization. The hard security boundary. Every row, index, key, secret, and log line carries a tenant id. | Sector |
| **Firm** | A consulting organization. Also a tenant. Consultants belong to a firm. | Fleet |
| **Engagement** | A time-boxed link between a firm's consultants and a customer tenant, with a role and an end date. Assignment is how a consultant ever sees customer data. | Deployment |
| **Connector** | An authenticated integration to a customer system (Entra ID, AWS, GitHub, Okta, M365, Google Workspace, CrowdStrike, Tenable, ...). Declares capabilities (`read:identity`, `write:iam-policy`) and scopes. | Uplink (the connectors page is the **Hangar**) |
| **Mission** | A catalog entry tied to one tool and a set of required connector capabilities. A **mission run** executes it against the in-scope environment and produces findings and a score. | Mission (a mission's results page is the **Briefing**) |
| **Finding** | A normalized observation: severity, crosswalk domain, framework refs, affected assets, evidence, and the playbooks that could resolve it. | Contact |
| **Playbook** | A remediation recipe: which agent, which MCP servers and tools, preconditions, blast radius class, reversibility, verification step, and a default cadence. | Playbook (agents collectively are the **Squadron**) |
| **Execution mode** | Per playbook per tenant: **Autopilot** (scheduled, unattended), **Clearance** (human approves each run from a preview), **Beacon** (reminder to a human, who runs it manually). | Autopilot / Clearance / Beacon |
| **Schedule** | A cadence and change window for a playbook in Autopilot or Clearance mode. | Patrol |
| **Run** | One execution of a playbook: plan, preview, approval, execute, verify, rollback if needed. Streams live through the Redis blackboard. | Sortie |
| **Audit log** | Append-only, hash-chained record of every read, write, approval, and consultant context switch. | Flight recorder |

### Views

- **Command Deck** (consultant): a client switcher across assigned engagements, fleet-wide status (missions due, approvals waiting, failed runs), and a per-client drill-in. Switching clients is an explicit, logged act that mints a new short-lived token scoped to that tenant. There is no "all clients" data view, only aggregate counts.
- **Bridge** (customer): posture over time, active missions, approvals queue, schedule, findings, reports, and a read-only log of which consultants accessed what and when.
- **Hangar** (both): connectors, their health, capabilities, and the missions they unlock.

---

## 4. Domain coverage

Outpost has to span GRC to AppSec. Each domain below lists the connectors that unlock it, the initial missions, seeded from site data where possible, and the first playbooks. Playbooks marked (A) can be offered in Autopilot; everything else caps at Clearance.

| Domain | Connectors | Initial missions | First playbooks |
|---|---|---|---|
| **GRC and compliance** | Customer profile (no connector), ticketing (Jira, ServiceNow), HRIS, document store | Framework gap assessment (any of the 10 site assessments, consultant-picked), Regulatory applicability, Crosswalk gap register, Policy set generation | Policy drafter, control-owner reminder (A), evidence request tickets (A), regulatory watch |
| **Identity and access** | Entra ID, Okta, Google Workspace, AWS IAM, GitHub org | MFA coverage, stale and orphaned accounts, privileged role review, conditional access baseline, admin without MFA | Disable stale accounts, enforce MFA registration campaign, access review campaign (A for reminders), remove unused privileged roles |
| **Cloud posture** | AWS, Azure, GCP (read-only role first) | CIS Foundations baseline (54 controls from `cloud-baseline.json`), public exposure, logging and audit trail, encryption at rest, IAM key hygiene | Enable audit logging, block public S3/blob, rotate stale keys, guardrail policies as IaC pull requests, tag hygiene (A) |
| **Endpoint and device** | Intune, Jamf, CrowdStrike, Defender for Endpoint | EDR coverage, patch compliance, disk encryption, OS end-of-life | Patch nudges (A), enrollment reminders (A), isolate host (never Autopilot) |
| **Vulnerability management** | Tenable, Qualys, Defender VM, Dependabot, Snyk | Exposure triage by KEV and EPSS, SLA compliance, unowned assets | Ticket creation with owner (A), SLA breach escalation (A), auto-patch for low-risk classes |
| **AppSec and SSDLC** | GitHub, GitLab, Bitbucket, Semgrep, Snyk | SSDLC maturity (`ssdlc.json` + SSDF), repo hygiene (branch protection, secret scanning, signed commits), dependency risk, SBOM presence | Enable branch protection, dependency fix PRs (A), secret rotation tickets, Semgrep rule rollout |
| **Email and collaboration** | M365, Google Workspace | SPF/DKIM/DMARC, external sharing, phishing protections, mailbox forwarding rules | DMARC progression (none to quarantine to reject, Clearance each step), kill suspicious forwarding rules, sharing policy fixes |
| **Network and perimeter** | DNS providers, external attack surface scan (our own scanner), Meraki, Fortinet, Palo Alto | External attack surface, exposed management ports, TLS hygiene, DNS record hygiene | Re-scan and diff (A), ticket exposed services (A), firewall rule proposal |
| **Data protection and backup** | AWS Backup, Veeam, M365 backup vendors, DLP | Backup 3-2-1 verification (from the Ransomware assessment), immutability, restore test recency, data classification | Schedule restore test (A reminder), enable immutability, classification labels |
| **Detection and response** | Microsoft Sentinel, Splunk, Elastic, EDR | Logging coverage vs. ATT&CK, alert triage health, IR readiness (from `runbooks.json`) | Tabletop scheduler (A), detection gap tickets (A), log source onboarding |
| **Third-party risk** | Vendor inventory (spreadsheet import), SSO app inventory, trust library | Vendor inventory and tiering, questionnaire response | Questionnaire responder (drafts only), vendor review reminders (A) |
| **AI security** | Bedrock, Azure OpenAI, OpenAI org, Vertex, SSO app inventory (shadow AI) | AI use-case inventory and tiering, AI threat model, AI workload control gaps | Guardrail configuration, use-case register upkeep (A), shadow AI notice |
| **People and awareness** | KnowBe4, LMS, HRIS | Team skills coverage, training completion, phishing simulation results | Training reminders (A), hiring profile |
| **Leadership and reporting** | none (derived) | Board metrics, program maturity, automation ROI | Monthly board pack (A), trust package refresh |

The Phase 1 gap list: identity, endpoint, email, vulnerability, network, and detection have no seed datasets yet. Each needs a control catalog in the same shape as `cloud-baseline.json` (`id, domain, title, rationale, priority, refs`) so the site's tooling, validation, and plain-English style carry over.

---

## 5. The mission lifecycle

```
Unlock -> Scope -> Assess -> Brief -> Plan -> Execute -> Verify -> Debrief
```

1. **Unlock.** A mission appears in the catalog when its required connector capabilities are present and healthy. The Hangar shows "3 more missions unlock if you connect Entra ID."
2. **Scope.** The consultant picks the boundary: which subscriptions, tenants, repos, OUs, or business units. Scope is stored with the mission and enforced at connector-call time, not just in the UI.
3. **Assess.** A read-only run. Connector calls gather evidence, questionnaire items with no evidence hook go to the consultant or customer to answer, and the site's scoring engine produces a score, band, and per-group breakdown. Findings are normalized to the crosswalk.
4. **Brief.** The mission Briefing page: score, findings by severity, what changed since last run, and a **recommendation list**: for each finding cluster, the playbook that resolves it, the suggested execution mode ceiling, and a suggested cadence (from `buildPlan`, `adoptionPlan`, or `gapsPlan` depending on the tool). The recommendation is generated by the Reasoning Engine but rendered as a deterministic list the consultant edits.
5. **Plan.** Consultant and customer accept, reject, or defer each recommendation, set the mode within the ceiling, and set the cadence. Accepted items become the tenant's remediation plan (the roadmap planner model: quarters, owners, KPIs, milestones).
6. **Execute.** Runs happen on schedule (Autopilot), after approval (Clearance), or when a human clicks run (Beacon). Every run produces a plan and a preview first; Clearance shows the preview to the approver.
7. **Verify.** After a run, the assessment check that produced the finding re-executes. A finding closes only when its own check passes. Failed verification triggers rollback where the playbook supports it.
8. **Debrief.** Reports: mission delta, board metrics, trust package updates, and the consultant's engagement summary.

### Execution mode rules

| Mode | What happens | Who can enable | Ceiling logic |
|---|---|---|---|
| **Autopilot** | Runs on schedule, unattended, inside a change window. Preview and result are logged. Notifies on completion and on any deviation from the preview. | Enabling Autopilot is itself a dual approval (customer admin plus consultant). Either party can disable it alone. | Only playbooks with `blast_radius: low`, `reversible: true`, and a passing verification step in the last 3 runs |
| **Clearance** | Agent prepares plan and preview, then waits. Approvers see a diff, an affected-asset list, and the rollback plan. **Two approvals are required: one customer admin and one assigned consultant.** Either can go first; each approval is bound to the preview hash, single-use, and expires after 72h. A changed preview voids both. The customer admin can additionally require a second customer approver for `blast_radius: high`. | Customer admin plus consultant | Default for everything |
| **Beacon** | Agent prepares the plan and a runbook, then notifies a human with a "run now" button and the manual steps. Nothing executes without the click. | Anyone with the operator role | Default for playbooks that touch production write scopes the customer has not granted |

Every mode has a **kill switch**: tenant-wide "abort all sorties" that cancels queued and in-flight runs and revokes the run's temporary credentials.

---

## 6. Architecture on the Reasoning Engine

```
+---------------------------------------------------------------+
| React + TS + Tailwind  (Command Deck / Bridge / Hangar)         |
+---------------------------------------------------------------+
| FastAPI                                                         |
|  existing routers (missions, findings, datasets, ontology ...)  |
|  new routers: tenants, engagements, connectors, catalog,        |
|               playbooks, schedules, approvals, runs, audit      |
|  tenant middleware: token -> acting_tenant -> RLS session       |
+-------------------+------------------+------------------------+
| Postgres (RLS)    | Elasticsearch    | Redis                   |
| all tables carry  | index-per-tenant | t:<id>: key prefix,     |
| tenant_id         | via alias + key  | ACL per worker identity |
+-------------------+------------------+------------------------+
| Scheduler (Temporal or Celery beat + Postgres lease)            |
+---------------------------------------------------------------+
| Run workers: one ephemeral container per sortie                 |
|  - only that tenant's secrets injected (KMS-scoped)             |
|  - MCP servers started per run, tenant-bound tokens             |
|  - egress allowlist per connector                               |
+---------------------------------------------------------------+
| Bedrock gateway (per-tenant guardrails, tenant-tagged logs),    |
| OpenAI / Gemini via the same gateway when a mission opts in     |
+---------------------------------------------------------------+
```

### Repository and package boundary (decided)

Outpost lives in its own repository and depends on the Reasoning Engine as a versioned Python package. That forces a clean contract, and the contract is where the tenancy work lands.

What the engine package must expose for Outpost to import it:

- **Mission and finding models** as importable SQLAlchemy models and Pydantic schemas, with a `tenant_id` column and RLS policy on every tenant-scoped table. If the engine's tables lack `tenant_id` today, that migration ships in the engine first, as its own release, before Outpost's Phase 0 starts.
- **A request-context protocol** (`RequestContext { acting_tenant, actor, engagement, role }`) that every engine repository and router accepts. Outpost's middleware builds it; the engine never reads tenant identity from anywhere else.
- **The model gateway** as a callable with a `tenant_policy` argument (provider allowlist, guardrail id, data residency) so Outpost can enforce per-tenant routing.
- **The blackboard and event bus** as a client that takes a key-prefix and a Redis ACL credential rather than opening its own connection.
- **Router factories**, not mounted apps: `engine.routers.missions(ctx_dependency)` so Outpost mounts them under its own auth.
- **Dataset and ontology loaders** that accept an index name resolver, so shared corpora and tenant corpora resolve to different aliases.

Anything the engine cannot expose this way is wrapped in Outpost rather than patched in a fork. The engine's own release cadence is decoupled: Outpost pins a version and upgrades deliberately.

### Other early decisions (decided)

- **Scheduler: Temporal.** Each sortie is a Temporal workflow: plan, preview, wait-for-approvals (days, durable), execute, verify, rollback. Cancellation is the kill switch. Temporal runs as a managed cluster (Temporal Cloud) unless there is a reason to self-host; namespaces are per environment, and the tenant id is a search attribute on every workflow so operators can find and cancel by tenant.
- **Run isolation.** One ECS Fargate task per run (Lambda for short read-only checks), never a shared long-lived worker with tenant data in memory. Temporal activities launch the task and await it.
- **MCP servers.** Our own per connector family, run inside the run container with a tenant-bound short-lived credential. Third-party MCP servers go through an allowlist and a static review before any tenant can enable them.
- **Model routing.** Per-mission model choice already exists. Each tenant carries a **provider allowlist and data-residency policy**; a customer can forbid OpenAI and Gemini routing entirely, and the gateway enforces it, not the mission config. The default for a new tenant is Bedrock only.
- **First connectors.** Entra ID and AWS. They unlock the most missions per connector for the typical customer and exercise both credential patterns (OAuth app consent and cross-account role assumption with ExternalId).
- **Trust step.** The customer admin always completes the OAuth consent or applies the role-trust template in their own console. The consultant prepares the request and sees the health of the result, never the credential.

### External attack surface scanner (decided: build our own)

The scanner is Outpost's one component that touches systems Outpost has no credential for, so it needs its own rules.

- **Ownership before scanning.** A domain or IP range enters scope only after the customer proves control: a DNS TXT record, an HTTP well-known file, or a cloud-connector-derived inventory (public IPs and hostnames read from the connected AWS account are auto-verified). Consultants can propose scope; they cannot verify it.
- **Passive first, active second.** Passive sources (certificate transparency, DNS, cloud inventory) run on every cadence. Active probing (port and TLS checks, HTTP fingerprinting) runs only against verified assets, from a fixed published IP range with a reverse-DNS identity, at a rate limit the customer can lower.
- **Never exploit.** The scanner identifies exposure and version; it does not attempt authentication, injection, or denial. Findings that need exploitation to confirm are marked "unconfirmed" and routed to a human.
- **Diff, not dump.** The mission output is what changed since the last run: new hosts, new open ports, expiring certificates, dropped assets.
- Phasing: passive sources and the diff engine in Phase 1 (it needs no write scope and unlocks the Network domain early); active probing in Phase 3 once the ownership-verification and rate-limit machinery has run for a while.

---

## 7. Security posture (summary; detail in TENANT-ISOLATION.md)

Outpost is a system that holds credentials to customers' crown-jewel systems and lets AI agents change them. Its own security has to be better than the posture it sells.

1. **Tenant id comes only from the token.** Never from a path, query, or body. Middleware sets it on the DB session and RLS enforces it. A schema lint fails CI if any table lacks `tenant_id` and an RLS policy.
2. **Consultants switch context explicitly.** A consultant token names one `acting_tenant` at a time, bound to an active engagement. Switching mints a new token, expires the old one, and writes an audit event the customer can see.
3. **Connector credentials are per-tenant envelope-encrypted** with a per-tenant KMS key. Prefer OAuth refresh tokens and AWS role assumption with a per-tenant ExternalId over static keys. Runs receive short-lived derived credentials, never the root secret.
4. **Every run is ephemeral and single-tenant.** No shared filesystem, no shared process memory, egress allowlisted to the connector's endpoints.
5. **Connector data is untrusted input to the model.** Prompt injection from a malicious ticket, commit message, or username must not trigger a write. Writes only happen through playbook steps that were previewed, and Autopilot playbooks only run pre-registered tool calls with parameters validated against a schema, not free-form agent actions.
6. **Retrieval is tenant-filtered at the query builder,** not by asking the model nicely. Elasticsearch aliases and API keys are per tenant.
7. **Append-only, hash-chained audit log.** Customer can see every consultant read. Exportable.
8. **Cross-tenant leak tests are a CI gate.** Every endpoint runs against a two-tenant fixture and must return 403 or 404 with an empty body for the other tenant.
9. **Crypto-shred on offboarding.** Destroying the tenant's KMS key renders every secret and encrypted field unreadable.
10. **Dogfood.** Outpost's own AI agents get tiered with the AI risk tool, threat-modeled with the AI threat model tool, and controlled with the AI workload control mapper. Publish the result.

---

## 8. Look and feel

The site is warm editorial (cream paper, tomato, serif headlines). Outpost is the night shift: the same design discipline, a different mood.

- **Dark-first, light mode supported.** Deep space navy and near-black paper; a cool holo-blue as the primary accent; amber for warnings and Beacon; red reserved for critical findings and the kill switch. Keep the site's rule that every accent clears 4.5:1 against its paper in both schemes, and keep a `tests/contrast.test.ts` equivalent.
- **Typography.** Keep IBM Plex Sans for body and IBM Plex Mono for telemetry, ids, and log lines. Replace Fraunces with a geometric display face with wide tracking for mission titles (Space Grotesk or Orbitron used sparingly for headings only).
- **Motifs.** Thin bracketed corner frames on cards, a subtle scanline gradient on the Command Deck header, holo-blue glow on focus rings, progress rendered as segmented bars rather than smooth fills, and a mission ticker on the Bridge. All decoration respects `prefers-reduced-motion` and is never the only carrier of meaning.
- **Vocabulary.** The Star Wars feel comes from the nouns (Command Deck, Bridge, Hangar, Squadron, Sortie, Clearance, Beacon, Flight recorder), not from franchise references, and every page keeps a plain-English subtitle so a customer's CFO is never lost. No trademarked names, characters, or ship names anywhere in the product.
- **Sound and motion.** Optional, off by default: a soft chirp on approval, a low tone on failed verification.

---

## 9. Roadmap

Rough sizes assume two to three engineers plus you on product. Each phase has an exit gate; do not start the next one until the gate passes.

### Phase 0: Foundation (6 to 8 weeks)

- New `outpost` repository. Engine package contract (see §6): `RequestContext`, router factories, tenant-aware gateway and blackboard clients. Engine `tenant_id` migration shipped and released first if needed.
- Tenant, firm, engagement, user, and role models. OIDC login with enforced MFA. Consultant context switch.
- Postgres RLS on every table, tenant middleware, schema lint in CI, two-tenant leak test harness.
- Elasticsearch per-tenant alias and API key provisioning. Redis key namespacing and ACLs.
- Append-only audit log with hash chaining and a customer-visible access view.
- Connector framework: OAuth, AWS role assumption with ExternalId, static API key (discouraged) with per-tenant KMS envelope encryption. Capability declaration and health checks. The customer-completes-trust flow for both Entra ID and AWS.
- Temporal namespace, the sortie workflow skeleton (plan, preview, dual approval wait, execute, verify), and the kill switch.
- Mission catalog schema. Two read-only missions seeded: **Identity baseline** (Entra ID) and **Cloud CIS Foundations** (AWS, from `cloud-baseline.json`).
- Frontend shell: Command Deck, Bridge, Hangar, theme system, contrast tests.
- **Exit gate:** cross-tenant test suite green, external pentest of the tenancy layer with no high findings, tenancy retrofit of the existing 38 routers complete.

### Phase 1: Assess (8 weeks)

- Port the 10 site assessments as questionnaire missions with evidence hooks. Port `assessment.ts` scoring.
- New control catalogs for identity, endpoint, email, vulnerability, network, detection (same JSON shape as `cloud-baseline.json`).
- External attack surface scanner, passive sources and diff engine only, with ownership verification.
- Connectors: Okta, Google Workspace, M365, GitHub, Azure, GCP, CrowdStrike or Defender, Tenable or Qualys. Read scopes only.
- Findings model with crosswalk normalization and plain-English explanations from the framework corpora loaded into the ontology and Elasticsearch.
- Mission Briefing page with recommendation list (playbook, mode ceiling, cadence). Recommendations are generated by the Reasoning Engine and reviewed by the consultant.
- Regulatory applicability scoping and the customer profile.
- **Exit gate:** a consultant can onboard a customer, connect three systems, run five missions, and hand over a briefing without touching the database.

### Phase 2: Remediate (8 weeks)

- Playbook model: agent, MCP tools, preconditions, blast radius, reversibility, verification, rollback, default cadence.
- Execution modes with ceilings, dual approval (customer admin plus consultant) bound to the preview hash, expiry, Beacon reminders.
- Ephemeral run workers launched from Temporal activities with tenant-scoped secrets and egress allowlists.
- Live run streaming through the Redis blackboard to the Bridge.
- First ten playbooks, all low blast radius: stale-account disable, MFA campaign, audit logging enable, public storage block, branch protection, dependency fix PR, DMARC step-up, ticket creation, restore-test reminder, tabletop scheduler.
- Remediation plan view (roadmap planner model) with KPIs and maturity roll-up.
- **Exit gate:** an Autopilot playbook runs on schedule, its preview matches its result, verification closes the finding, and a forced failure rolls back cleanly, all visible in the flight recorder.

### Phase 3: Squadron (ongoing from month 6)

- MCP server SDK with tenant-scoping baked in; one MCP server per connector family.
- Agent registry: each agent declares tools, model tier, and the playbooks it serves. Agents are tiered with the AI risk tool and threat-modeled before release.
- Third-party MCP allowlist with static review and per-tenant enablement.
- Cadence learning: recommend cadence from finding recurrence rather than a static default.
- External attack surface scanner, active probing from a published IP range with per-customer rate limits.
- Cross-domain playbooks (an identity finding that also fixes a cloud IAM finding).

### Phase 4: Report and scale (month 8 onward)

- Board pack generation from `board-metrics.json`, trust package refresh from findings, automation ROI on which playbooks earned their keep.
- Multi-consultant firms, engagement handoff, customer self-service for connector renewal.
- Data export and crypto-shred offboarding.
- SOC 2 Type II for Outpost itself, using Outpost.

---

## 10. Decisions log

| # | Question | Decision (2026-09-18) | Where it lands |
|---|---|---|---|
| 1 | Where does Outpost live? | New repository that imports the Reasoning Engine as a package. | §6 package contract; Phase 0 |
| 2 | Who approves in Clearance mode? | Both: one customer admin and one assigned consultant, either order, bound to the preview hash. | §5 execution modes; TENANT-ISOLATION §9 |
| 3 | Who completes the connector trust step? | The customer, always. Consultants prepare and observe, never hold credentials. | §6; TENANT-ISOLATION §7 |
| 4 | External attack surface scanner? | Build our own, passive first, active only against ownership-verified assets. | §6; Phases 1 and 3 |
| 5 | Run orchestrator? | Temporal. | §6; Phase 0 |
| 6 | Per-tenant AI provider allowlist? | Yes. Customer can forbid non-Bedrock routing; default is Bedrock only. | §6; TENANT-ISOLATION §9 |
| 7 | First two connectors? | Entra ID and AWS. | Phase 0 |
| 8 | Codename? | Outpost. | Everywhere |

## 11. Next steps

1. Turn Phase 0 into concrete artifacts: the engine package contract (a written interface the engine team can build against), the Outpost Postgres schema with RLS policies, and the router contracts for tenants, engagements, connectors, catalog, approvals, and runs.
2. Mock the Command Deck, Bridge, and Hangar screens in the Outpost theme so the vocabulary and the dual-approval flow can be tested with a consultant before code.
3. Write the Entra ID and AWS connector specs: minimum permissions, the customer-side trust template, the capability list, and the missions each unlocks.
