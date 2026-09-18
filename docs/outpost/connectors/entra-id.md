# Connector spec: Microsoft Entra ID

**Status:** draft v0.1 (2026-09-18). Follows the [connector contract](README.md). Catalog rows in [seed.sql](seed.sql).

| Field | Value |
|---|---|
| `id` | `entra-id` |
| `family` | `identity` |
| `auth_kind` | `oauth` (app-only, admin consent) |
| Vendor API | Microsoft Graph v1.0 (beta only where noted) |
| Identity | The customer's Entra tenant id, verified on `complete` |
| Unlocks | Identity baseline, Privileged access review, App consent and shadow AI inventory |

---

## 1. Authentication model

**Default: Outpost multi-tenant application with admin consent.** Outpost owns one app registration in its own Entra tenant. The customer's Global Administrator (or Privileged Role Administrator) grants tenant-wide admin consent to the application permissions listed in §2. Outpost then requests app-only tokens for that tenant with the client credentials flow, using a certificate.

Why app-only and not delegated: the missions run unattended on a schedule, and delegated permissions would tie every run to a named human's session and role. App-only permissions are also what the customer can review and revoke in one place (Enterprise applications > Outpost > Permissions).

What this means for isolation:

- The application certificate is a **platform** secret, not a tenant secret. It lives in a KMS-backed signing key that is never exported; the API server signs the client assertion, the worker never sees it.
- A token is issued **for one tenant** (`https://login.microsoftonline.com/{customer_tenant_id}/oauth2/v2.0/token`), lives about an hour, and is minted per run. The run container for tenant A never holds a token for tenant B.
- The accepted trade-off: a compromise of the platform signing key would let an attacker mint tokens for any consented tenant. Mitigations are the HSM-backed key, short token life, the audit trail on every mint, and the alternative below for customers who refuse the trade-off.

**Alternative: customer-owned app registration.** The customer creates their own single-tenant app registration, grants the same permissions, and uploads a certificate that Outpost generates for them (private key envelope-encrypted with the tenant's KMS key). Isolation is then complete per tenant at the cost of a longer setup. The Hangar offers this as "Bring your own app registration"; everything else in this spec is identical.

### Flow

1. Consultant or customer admin: `POST /connectors {type_id: "entra-id", requested_scopes: ["read:identity", ...]}`.
2. Server generates the admin consent URL with a single-use `state` bound to the tenant, the connector, and the requesting user's session:
   `https://login.microsoftonline.com/organizations/v2.0/adminconsent?client_id=<outpost>&scope=https://graph.microsoft.com/.default&redirect_uri=<callback>&state=<state>`
3. **Customer admin** opens it, signs in with a Global Administrator account, reviews the permission list, and consents.
4. Microsoft redirects to `/connectors/oauth/callback?tenant=<id>&state=<state>&admin_consent=True`. The server checks `state`, records `external_ref.entra_tenant_id`, and runs the health check.
5. `complete` is implicit for this connector: the callback is the customer's act. A callback whose session is not a customer admin of the acting tenant is rejected with `403 customer_must_complete`.

Every step is audited. The consent record (tenant id, consenting user's object id, timestamp, permission list) is stored as the secret record; there is no refresh token to store in the default model.

## 2. Capabilities and Graph permissions

Application permissions, least-privileged option first. Verify against the Graph permissions reference at build time; Microsoft adds narrower permissions regularly and the narrower one always wins.

| Capability | Graph application permissions | Unlocks |
|---|---|---|
| `read:identity` | `User.Read.All`, `Group.Read.All`, `Directory.Read.All`, `UserAuthenticationMethod.Read.All`, `Reports.Read.All` | Users, groups, MFA registration state, authentication methods report |
| `read:identity.signin` | `AuditLog.Read.All` | Sign-in activity for stale-account detection. **Requires Entra ID P1 or P2.** Without it the collector returns `unknown` and the mission asks the questionnaire item. |
| `read:identity.policy` | `Policy.Read.All` | Conditional access policies, security defaults, authentication methods policy, app consent policy |
| `read:identity.privileged` | `RoleManagement.Read.Directory`, `RoleEligibilitySchedule.Read.Directory`, `RoleAssignmentSchedule.Read.Directory` | Directory role members, PIM eligible vs. permanent assignments. **PIM data requires P2**; without it the review runs on permanent assignments only. |
| `read:identity.apps` | `Application.Read.All`, `DelegatedPermissionGrant.Read.All` | Service principals, OAuth grants, publisher info for the shadow-AI inventory |
| `write:identity.user-state` | `User.EnableDisable.All`, `User.RevokeSessions.All` | Disable stale accounts, revoke sessions |
| `write:identity.auth-methods-policy` | `Policy.ReadWrite.AuthenticationMethod` | MFA registration campaign settings |
| `write:identity.ca-policy` | `Policy.ReadWrite.ConditionalAccess` (plus `Application.Read.All`) | Create and edit conditional access policies |
| `write:identity.role-assignments` | `RoleManagement.ReadWrite.Directory` | Remove unused privileged role assignments |
| `write:identity.app-grants` | `DelegatedPermissionGrant.ReadWrite.All`, `AppRoleAssignment.ReadWrite.All` | Revoke risky OAuth grants |

Each write capability is a **separate consent** (the Hangar generates a new consent URL naming only the added permissions) so the customer's Enterprise application page shows exactly which writes exist and can remove any one of them.

Optional narrowing for writes: where Graph supports administrative-unit scoping (user state changes through a `User Administrator` role assignment scoped to an AU, instead of the tenant-wide `User.EnableDisable.All`), the Hangar offers it and the mission scope is then the AU. The trade is a longer setup for a smaller blast radius.

## 3. Trust instructions shown in the Hangar

> **Connect Microsoft Entra ID (read only).**
> 1. Sign in as a Global Administrator. Outpost never sees your password; Microsoft shows you the consent page.
> 2. Review the permissions. Everything on this list is read-only. Outpost will not change anything in your directory with this connection.
> 3. Consent. You can remove the application at any time under Enterprise applications, and Outpost will show the connection as revoked within the hour.
>
> Unlocks: Identity baseline (monthly), Privileged access review (quarterly), App consent and shadow AI inventory (monthly).

## 4. Health check

1. Mint a token for the recorded tenant id.
2. `GET /organization` and compare `id` to `external_ref.entra_tenant_id` (`identity_mismatch` on difference).
3. `GET /servicePrincipals?$filter=appId eq '<outpost>'` then its `appRoleAssignments` to list granted permissions; derive capabilities from the table in §2.
4. Licence probe: `GET /subscribedSkus` to record whether P1 or P2 is present, so the mission knows in advance which checks will be `unknown`.
5. Record `identity: {kind: "entra-tenant", id, display: verifiedDomains[default]}`.

## 5. Scope model

Default scope is the whole tenant. Optional narrowing: a list of administrative units or groups to **include**, and a list of accounts to **exclude** (break-glass accounts are excluded from stale-account checks by default once identified). The call wrapper filters collector results to the scope and refuses write targets outside it.

## 6. Missions

### `identity-baseline` (monthly; requires `read:identity`, `read:identity.policy`; better with `read:identity.signin`)

| Check id | Title | Severity | Collector | Refs |
|---|---|---|---|---|
| `entra-mfa-admin-phishing-resistant` | Every privileged role member has a phishing-resistant method registered | critical | `auth_methods.by_role` | CIS 6.5, CSF PR.AA-03, CIS M365 5.2.3.x |
| `entra-mfa-registration-coverage` | MFA registered for at least 95% of enabled users | high | `auth_methods.registration_report` | CIS 6.3, CSF PR.AA-03 |
| `entra-legacy-auth-blocked` | A conditional access policy blocks legacy authentication, or security defaults are on | critical | `policy.legacy_auth` | CIS M365 5.2.2.3, CSF PR.AA-05 |
| `entra-ca-mfa-all-users` | Conditional access requires MFA for all users (report-only does not count) | critical | `policy.ca_mfa` | CIS 6.3 |
| `entra-ca-mfa-admins` | Conditional access requires phishing-resistant MFA for admins | high | `policy.ca_admin_strength` | CIS 6.5 |
| `entra-security-defaults-or-ca` | Security defaults are on, or at least one enabled CA policy exists | critical | `policy.baseline_present` | CIS 6.3 |
| `entra-stale-accounts` | No enabled accounts without a sign-in in 90 days (P1 required) | high | `signin.stale` | CIS 5.3, CSF PR.AA-01 |
| `entra-guest-review` | Guest accounts are fewer than 10% of users or reviewed in the last 90 days | medium | `users.guests` | CIS 5.3, CIS M365 1.1.x |
| `entra-break-glass-exists` | At least two emergency access accounts exist and are excluded from CA | medium | `users.break_glass` | CIS M365 1.1.x |
| `entra-app-consent-restricted` | Users cannot consent to apps, or only to verified publishers for low-risk permissions | high | `policy.app_consent` | CIS M365 5.1.5.x, OWASP LLM06 |
| `entra-password-never-expires-admins` | No admin account has password expiration disabled without a phishing-resistant method | medium | `users.admin_password_policy` | CIS 5.2 |
| `entra-sspr-enabled` | Self-service password reset is enabled for all users | low | `policy.sspr` | CIS 5.2 |

Questionnaire fallback: each check has a plain-English question the customer answers when the collector returns `unknown`.

### `privileged-access-review` (quarterly; requires `read:identity.privileged`)

| Check id | Title | Severity | Collector |
|---|---|---|---|
| `entra-global-admin-count` | Between 2 and 5 Global Administrators | high | `roles.global_admins` |
| `entra-pim-eligible-not-permanent` | Privileged roles are PIM-eligible, not permanently active (P2) | high | `roles.pim_assignments` |
| `entra-privileged-cloud-only` | Privileged accounts are cloud-only, not synced from on-premises | medium | `roles.synced_admins` |
| `entra-privileged-unused` | No privileged role assignment unused for 60 days | medium | `roles.unused` |

### `app-consent-inventory` (monthly; requires `read:identity.apps`)

| Check id | Title | Severity | Collector |
|---|---|---|---|
| `entra-oauth-high-privilege-grants` | No third-party app holds `Mail.ReadWrite`, `Files.ReadWrite.All`, `Directory.ReadWrite.All` or similar without a documented owner | high | `apps.high_privilege` |
| `entra-oauth-unverified-publishers` | No grants to unverified publishers | medium | `apps.unverified` |
| `entra-shadow-ai-apps` | AI assistants and model providers with user consent are inventoried and tiered (feeds the AI use-case register) | medium | `apps.ai_inventory` |

## 7. Playbooks

| Playbook | Write capability | Blast radius | Reversible | Mode ceiling | Preview shows | Verify | Rollback |
|---|---|---|---|---|---|---|---|
| `identity.disable-stale-accounts` | `write:identity.user-state` | low | yes | autopilot | Each account, last sign-in date, `accountEnabled: false`, session revoke | `signin.stale` re-run on the same ids | Re-enable the same ids |
| `identity.mfa-registration-campaign` | `write:identity.auth-methods-policy` | low | yes | autopilot | The registration campaign settings diff | `auth_methods.registration_report` trend after 14 days | Restore prior settings |
| `identity.block-legacy-auth` | `write:identity.ca-policy` | medium | yes | clearance | Policy JSON, first as report-only, then enforce as a second sortie | `policy.legacy_auth` | Set policy to disabled |
| `identity.remove-unused-privileged-roles` | `write:identity.role-assignments` | high | yes | clearance | Each assignment, last use, the role | `roles.unused` | Re-create the assignment |
| `identity.revoke-risky-app-grant` | `write:identity.app-grants` | medium | yes | clearance | The grant, the app, the publisher, affected users | `apps.high_privilege` | Re-grant with the saved scopes |

Constraints in `call_schema`: `user_id` must be in the sortie's finding assets; accounts tagged break-glass are refused; `disable` batches are capped at 50 per sortie in Autopilot.

## 8. Failure modes

| Condition | Handling |
|---|---|
| Consent removed by the customer | Health returns `scope_lost` for everything; connector `expired`; customer notified; missions lock |
| P1 or P2 absent | Sign-in and PIM collectors return `unknown`; the Briefing says which checks needed a licence and asks the questionnaire item instead |
| Graph throttling (429) | Backoff with `Retry-After`; mission continues; evidence records retries |
| Tenant restricts app-only tokens by workload identity CA policy | Health fails with the CA error; Hangar shows the policy name to exclude |
| Token for the wrong tenant (misconfiguration) | `identity_mismatch`; refuse; audit |
