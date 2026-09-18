"""Outpost <-> Reasoning Engine package contract, v1.0 draft (2026-09-18).

This module is the interface Outpost imports. It ships inside the engine as
``reasoning_engine.contract`` and Outpost pins ``reasoning-engine ~= 1.0``.

Rules of the contract
---------------------
1. Every engine call that can touch tenant data takes a ``RequestContext`` as its
   first argument. There is no engine API that accepts a tenant id as a plain
   parameter, and no engine API that reads tenant identity from anywhere else.
2. The engine never opens its own database, Elasticsearch, or Redis connection with
   ambient credentials for tenant data. Outpost hands it a tenant-scoped session,
   an ``IndexTarget`` (alias + API key), or a ``BlackboardCredential``.
3. Everything here is a ``typing.Protocol`` or a frozen dataclass. The engine provides
   implementations behind ``engine_services()``; Outpost never imports engine
   internals. Only the standard library is used so the contract itself has no
   dependency surface.
4. Adding an optional field or a new Protocol is a minor version. Removing or
   renaming anything, or changing what a tenant-scoped table is, is a major version.

Verify this file compiles: ``python -m py_compile engine_contract.py``.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Literal, Protocol, runtime_checkable
from uuid import UUID

CONTRACT_VERSION = "1.0"


# ---------------------------------------------------------------------------
# 1. Identity: who is calling, acting as which tenant
# ---------------------------------------------------------------------------
class Role(str, Enum):
    PLATFORM_ADMIN = "platform_admin"
    FIRM_ADMIN = "firm_admin"
    CONSULTANT_LEAD = "consultant_lead"
    CONSULTANT_ANALYST = "consultant_analyst"
    CUSTOMER_ADMIN = "customer_admin"
    CUSTOMER_OPERATOR = "customer_operator"
    CUSTOMER_VIEWER = "customer_viewer"
    AUDITOR = "auditor"


@dataclass(frozen=True, slots=True)
class RequestContext:
    """Built by Outpost's auth middleware from a verified token. Immutable.

    The engine treats ``acting_tenant`` as the only tenant it may read or write.
    ``home_tenant`` differs from ``acting_tenant`` only for consultants and for a
    break-glass platform admin; in both cases the grant that allows it is named.
    """

    acting_tenant: UUID
    home_tenant: UUID
    actor_user: UUID
    role: Role
    session_id: UUID
    request_id: str
    engagement_id: UUID | None = None
    break_glass_grant: UUID | None = None
    issued_at: datetime | None = None

    def __post_init__(self) -> None:
        if self.is_cross_tenant and not (self.engagement_id or self.break_glass_grant):
            raise ValueError("cross-tenant context requires an engagement or a break-glass grant")
        if self.role in (Role.CONSULTANT_LEAD, Role.CONSULTANT_ANALYST) and not self.engagement_id:
            if self.is_cross_tenant:
                raise ValueError("consultant acting in a customer tenant requires an engagement")

    @property
    def is_cross_tenant(self) -> bool:
        return self.acting_tenant != self.home_tenant

    @property
    def is_consultant(self) -> bool:
        return self.role in (Role.CONSULTANT_LEAD, Role.CONSULTANT_ANALYST)

    @property
    def approval_side(self) -> Literal["customer", "consultant"]:
        """Which side of a dual approval this actor can supply."""
        return "consultant" if self.is_cross_tenant else "customer"


ContextDependency = Callable[..., Awaitable[RequestContext]]
"""A FastAPI dependency Outpost supplies to engine router factories."""


# ---------------------------------------------------------------------------
# 2. Tenant-scoped database session
# ---------------------------------------------------------------------------
@runtime_checkable
class TenantSession(Protocol):
    """An open transaction on which Outpost has already run

        SET LOCAL app.tenant_id = <ctx.acting_tenant>;
        SET LOCAL app.home_tenant_id = <ctx.home_tenant>;
        SET LOCAL app.user_id = <ctx.actor_user>;

    as the ``outpost_app`` role. Engine repositories execute on it and never
    change the role or these settings. Commit and rollback belong to Outpost.
    """

    @property
    def context(self) -> RequestContext: ...

    async def execute(self, statement: Any, params: Mapping[str, Any] | None = None) -> Any: ...


# The engine declares which of its tables hold tenant data. Outpost's RLS lint
# reads this list from the installed package and fails if any of these tables lack
# tenant_id + forced RLS, or if any table not listed here gains a tenant_id column.
TENANT_SCOPED_TABLES: frozenset[str] = frozenset(
    {
        "missions",
        "mission_events",
        "findings",
        "finding_evidence",
        "datasets",
        "dataset_rows",
        "blackboard_snapshots",
        "model_invocations",
    }
)

SHARED_TABLES: frozenset[str] = frozenset(
    {
        "ontology_nodes",
        "ontology_edges",
        "framework_controls",  # CSF, CIS, ISO, SOC 2, HIPAA, AI frameworks with plain-English text
        "tool_definitions",
    }
)


# ---------------------------------------------------------------------------
# 3. Missions and findings (engine-owned records, Outpost-owned lifecycle)
# ---------------------------------------------------------------------------
class MissionStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    NEEDS_INPUT = "needs_input"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass(frozen=True, slots=True)
class MissionSpec:
    tool: str
    """Engine tool id, e.g. ``assessment.cloud_baseline``."""
    inputs: Mapping[str, Any]
    """Tool inputs. Outpost passes scope and connector evidence; never credentials."""
    model_route: ModelRoute | None = None
    labels: Mapping[str, str] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class Mission:
    id: UUID
    tool: str
    status: MissionStatus
    created_at: datetime
    finished_at: datetime | None
    result: Mapping[str, Any] | None
    error: str | None


class Severity(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


@dataclass(frozen=True, slots=True)
class FrameworkRef:
    framework: str  # "csf" | "cis" | "iso27001" | "soc2" | "hipaa" | "ai-rmf" | ...
    ref: str


@dataclass(frozen=True, slots=True)
class Finding:
    id: UUID
    mission_id: UUID
    check_id: str
    fingerprint: str
    title: str
    severity: Severity
    framework_refs: Sequence[FrameworkRef]
    crosswalk_domain: str | None
    explanation: str | None
    evidence: Mapping[str, Any]
    assets: Sequence[tuple[str, str]]  # (asset_kind, asset_ref)


@runtime_checkable
class MissionRepository(Protocol):
    async def create(self, session: TenantSession, spec: MissionSpec) -> Mission: ...
    async def get(self, session: TenantSession, mission_id: UUID) -> Mission | None: ...
    async def list(self, session: TenantSession, *, tool: str | None = None, limit: int = 50, cursor: str | None = None) -> tuple[Sequence[Mission], str | None]: ...
    async def cancel(self, session: TenantSession, mission_id: UUID) -> Mission: ...


@runtime_checkable
class FindingRepository(Protocol):
    async def upsert_many(self, session: TenantSession, findings: Sequence[Finding]) -> Sequence[Finding]: ...
    async def for_mission(self, session: TenantSession, mission_id: UUID) -> Sequence[Finding]: ...


# ---------------------------------------------------------------------------
# 4. Model gateway with per-tenant policy
# ---------------------------------------------------------------------------
class Provider(str, Enum):
    BEDROCK = "bedrock"
    OPENAI = "openai"
    GEMINI = "gemini"


class ModelTier(str, Enum):
    OPUS = "opus"
    SONNET = "sonnet"
    HAIKU = "haiku"


@dataclass(frozen=True, slots=True)
class TenantModelPolicy:
    """Read from ``outpost.provider_policies``. The gateway enforces it; a mission's
    requested route is a preference the policy may refuse."""

    providers: frozenset[Provider]
    residency: Literal["us", "eu"]
    default_tier: ModelTier
    guardrail_id: str | None = None

    def __post_init__(self) -> None:
        if not self.providers:
            raise ValueError("a tenant policy must allow at least one provider")


@dataclass(frozen=True, slots=True)
class ModelRoute:
    provider: Provider
    tier: ModelTier


@dataclass(frozen=True, slots=True)
class ModelRequest:
    system: str
    messages: Sequence[Mapping[str, Any]]
    route: ModelRoute | None = None
    tools: Sequence[Mapping[str, Any]] = ()
    max_tokens: int = 4096
    untrusted_segments: Sequence[str] = ()
    """Connector-derived text the gateway must wrap as data, never as instructions."""


@dataclass(frozen=True, slots=True)
class ModelUsage:
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int = 0


@dataclass(frozen=True, slots=True)
class ModelResponse:
    text: str
    tool_calls: Sequence[Mapping[str, Any]]
    route: ModelRoute
    model_id: str
    usage: ModelUsage
    guardrail_action: Literal["none", "intervened", "blocked"] = "none"


@dataclass(frozen=True, slots=True)
class ModelEvent:
    kind: Literal["text", "tool_call", "usage", "guardrail", "done"]
    data: Mapping[str, Any]


class ProviderNotAllowed(PermissionError):
    """Raised, logged, and audited when a route names a provider the tenant forbids."""


@runtime_checkable
class ModelGateway(Protocol):
    async def complete(self, ctx: RequestContext, policy: TenantModelPolicy, request: ModelRequest) -> ModelResponse: ...
    def stream(self, ctx: RequestContext, policy: TenantModelPolicy, request: ModelRequest) -> AsyncIterator[ModelEvent]: ...
    async def embed(self, ctx: RequestContext, policy: TenantModelPolicy, texts: Sequence[str]) -> Sequence[Sequence[float]]: ...
    """Embeddings are computed per tenant and never cached across tenants."""


# ---------------------------------------------------------------------------
# 5. Blackboard and event bus (Redis) with per-run credentials
# ---------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class BlackboardCredential:
    """Minted by Outpost per run: a Redis ACL user limited to ``t:<tenant>:runs:<run>:*``."""

    key_prefix: str
    username: str
    password: str
    ttl_seconds: int

    def __repr__(self) -> str:  # never leak the password into logs
        return f"BlackboardCredential(prefix={self.key_prefix!r}, user={self.username!r})"


@dataclass(frozen=True, slots=True)
class RunEvent:
    run_id: UUID
    at: datetime
    kind: str
    payload: Mapping[str, Any]


@runtime_checkable
class Blackboard(Protocol):
    async def publish(self, cred: BlackboardCredential, event: RunEvent) -> None: ...
    def subscribe(self, cred: BlackboardCredential) -> AsyncIterator[RunEvent]: ...
    async def put(self, cred: BlackboardCredential, key: str, value: Mapping[str, Any], ttl_seconds: int | None = None) -> None: ...
    async def get(self, cred: BlackboardCredential, key: str) -> Mapping[str, Any] | None: ...


# ---------------------------------------------------------------------------
# 6. Knowledge store (Elasticsearch) with alias resolution
# ---------------------------------------------------------------------------
Corpus = Literal["shared", "tenant"]


@dataclass(frozen=True, slots=True)
class IndexTarget:
    alias: str
    api_key_id: str
    api_key: str

    def __repr__(self) -> str:
        return f"IndexTarget(alias={self.alias!r}, key={self.api_key_id!r})"


@runtime_checkable
class IndexResolver(Protocol):
    """Outpost's implementation returns the read-only shared alias for ``shared`` and
    the tenant's own alias plus per-tenant API key for ``tenant``. The engine never
    builds an index name from a string."""

    def resolve(self, ctx: RequestContext, corpus: Corpus) -> IndexTarget: ...


@dataclass(frozen=True, slots=True)
class KnowledgeHit:
    corpus: Corpus
    doc_id: str
    score: float
    source: Mapping[str, Any]


@runtime_checkable
class KnowledgeStore(Protocol):
    async def search(self, ctx: RequestContext, resolver: IndexResolver, query: str, *, corpora: Sequence[Corpus] = ("shared", "tenant"), k: int = 8) -> Sequence[KnowledgeHit]: ...
    async def index(self, ctx: RequestContext, resolver: IndexResolver, docs: Sequence[Mapping[str, Any]]) -> int: ...
    """Indexes into the tenant corpus only. Writing to ``shared`` is a provisioning-time job outside this contract."""


# ---------------------------------------------------------------------------
# 7. Shared datasets, ontology, and the ported scoring library
# ---------------------------------------------------------------------------
@runtime_checkable
class DatasetLoader(Protocol):
    """Read-only access to shared reference JSON (the Alphabet Soup datasets:
    assessments, cloud-baseline, ssdlc, policies, crosswalk, frameworks...)."""

    def load(self, name: str) -> Mapping[str, Any]: ...
    def names(self) -> Sequence[str]: ...


@runtime_checkable
class Ontology(Protocol):
    async def explain(self, ref: FrameworkRef) -> str | None:
        """Plain-English translation for a framework control, from the shared corpus."""
        ...

    async def crosswalk(self, ref: FrameworkRef) -> Sequence[FrameworkRef]: ...


Answer = Literal["yes", "alt", "na", "no"]


@dataclass(frozen=True, slots=True)
class GroupScore:
    id: str
    name: str
    percent: float
    answered: int
    applicable: int


@dataclass(frozen=True, slots=True)
class AssessmentResult:
    """Mirror of ``AssessmentResult`` in the site's ``src/lib/assessment.ts``."""

    answered: int
    total: int
    applicable: int
    overall_percent: float
    tier_percents: Mapping[str, float]
    groups: Sequence[GroupScore]
    distribution: Mapping[Answer, int]
    attained_tier: str | None
    insufficient: bool


@runtime_checkable
class Scoring(Protocol):
    """Port of the site's pure scoring functions. Deterministic, no model calls."""

    def score_assessment(self, dataset: Mapping[str, Any], answers: Mapping[str, Answer]) -> AssessmentResult: ...
    def readiness_band(self, percent: float) -> str: ...
    def gaps_plan(self, dataset: Mapping[str, Any], answers: Mapping[str, Answer]) -> Sequence[Mapping[str, Any]]: ...


# ---------------------------------------------------------------------------
# 8. Router factories
# ---------------------------------------------------------------------------
@runtime_checkable
class EngineRouters(Protocol):
    """Each factory returns a FastAPI ``APIRouter`` whose every endpoint depends on
    the supplied ``ContextDependency``. Outpost mounts them under its own auth and
    prefix. The engine does not export a pre-mounted ``app``."""

    def missions(self, ctx: ContextDependency) -> Any: ...
    def findings(self, ctx: ContextDependency) -> Any: ...
    def knowledge(self, ctx: ContextDependency) -> Any: ...
    def frameworks(self, ctx: ContextDependency) -> Any: ...  # shared, read-only


# ---------------------------------------------------------------------------
# 9. Service locator: the one thing Outpost constructs
# ---------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class EngineServices:
    missions: MissionRepository
    findings: FindingRepository
    gateway: ModelGateway
    blackboard: Blackboard
    knowledge: KnowledgeStore
    datasets: DatasetLoader
    ontology: Ontology
    scoring: Scoring
    routers: EngineRouters


EngineFactory = Callable[[Mapping[str, Any]], EngineServices]
"""``reasoning_engine.contract.engine_services(config) -> EngineServices``.

``config`` carries only non-tenant settings (Bedrock region, ES cluster URL, Redis
host). Tenant-specific credentials arrive per call via the objects above.
"""


# ---------------------------------------------------------------------------
# 10. Conformance: what the engine ships so Outpost can trust it
# ---------------------------------------------------------------------------
@runtime_checkable
class TwoTenantFixture(Protocol):
    """``reasoning_engine.testing.two_tenant``: seeds look-alike data for tenants A
    and B, yields a RequestContext for each, and provides ``assert_isolated`` which
    walks every engine router endpoint as A against B's ids and asserts 403 or 404
    with an empty body plus an audit event. Outpost runs this in its own CI against
    the pinned engine version."""

    def context_a(self) -> RequestContext: ...
    def context_b(self) -> RequestContext: ...
    async def assert_isolated(self, app: Any) -> None: ...
