/**
 * AI Workload Control Mapper: deterministic selection over the provider-neutral
 * control catalogue in src/data/ai-cloud-controls.json. Controls are selected by
 * workload tier (cumulative: acts includes connects includes answers), narrowed
 * by maturity phase, grouped by layer, and resolved to a single provider's
 * native service names. All functions are pure.
 */

export type ProviderId = 'aws' | 'azure' | 'gcp';
export type TierId = 'answers' | 'connects' | 'acts';
export type LayerId = 'infrastructure' | 'identity-data' | 'application';
export type PhaseId = 'foundational' | 'enhanced' | 'advanced';

export interface Control {
  id: string;
  tier: TierId;
  layer: LayerId;
  phase: PhaseId;
  objective: string;
  rationale: string;
  services: Record<ProviderId, string>;
  refs: string[];
}

export interface Named<T extends string> {
  id: T;
  order: number;
  name: string;
  hint: string;
}

export interface AiCloudControlsData {
  meta: {
    title: string;
    version: string;
    note: string;
    /** ISO date the provider service names were last checked against vendor docs. */
    servicesVerified: string;
    sources: { name: string; url: string }[];
  };
  providers: { id: ProviderId; name: string }[];
  tiers: (Named<TierId> & { example: string })[];
  layers: Named<LayerId>[];
  phases: Named<PhaseId>[];
  controls: Control[];
}

export interface Selection {
  provider: ProviderId;
  tier: TierId;
  /** Phases to include. Empty means include every phase. */
  phases: ReadonlySet<PhaseId>;
}

export const TIER_ORDER: TierId[] = ['answers', 'connects', 'acts'];
export const LAYER_ORDER: LayerId[] = ['infrastructure', 'identity-data', 'application'];
export const PHASE_ORDER: PhaseId[] = ['foundational', 'enhanced', 'advanced'];

const TIER_RANK: Record<TierId, number> = { answers: 0, connects: 1, acts: 2 };
const LAYER_RANK: Record<LayerId, number> = { infrastructure: 0, 'identity-data': 1, application: 2 };
const PHASE_RANK: Record<PhaseId, number> = { foundational: 0, enhanced: 1, advanced: 2 };

/**
 * Tiers are cumulative: an agent workload inherits every control from the
 * retrieval and answering tiers beneath it. This is the core rule of the model.
 */
export function tierApplies(controlTier: TierId, selected: TierId): boolean {
  return TIER_RANK[controlTier] <= TIER_RANK[selected];
}

/** An empty phase set means no phase filter, which is the default view. */
export function phaseApplies(controlPhase: PhaseId, phases: ReadonlySet<PhaseId>): boolean {
  return phases.size === 0 || phases.has(controlPhase);
}

export function inScope(control: Control, selection: Selection): boolean {
  return tierApplies(control.tier, selection.tier) && phaseApplies(control.phase, selection.phases);
}

function compareControls(a: Control, b: Control): number {
  return (
    LAYER_RANK[a.layer] - LAYER_RANK[b.layer] ||
    PHASE_RANK[a.phase] - PHASE_RANK[b.phase] ||
    TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
    a.objective.localeCompare(b.objective)
  );
}

export function selectedControls(data: AiCloudControlsData, selection: Selection): Control[] {
  return data.controls.filter((c) => inScope(c, selection)).sort(compareControls);
}

export interface LayerGroup {
  layer: LayerId;
  name: string;
  hint: string;
  controls: Control[];
}

/** Group the in-scope controls by layer, infrastructure first, empty layers dropped. */
export function groupByLayer(data: AiCloudControlsData, selection: Selection): LayerGroup[] {
  const scoped = selectedControls(data, selection);
  return [...data.layers]
    .sort((a, b) => a.order - b.order)
    .map((layer) => ({
      layer: layer.id,
      name: layer.name,
      hint: layer.hint,
      controls: scoped.filter((c) => c.layer === layer.id),
    }))
    .filter((g) => g.controls.length > 0);
}

export interface TierContribution {
  tier: TierId;
  name: string;
  count: number;
  inherited: boolean;
}

/** How many of the in-scope controls each tier contributes, and which are inherited. */
export function tierBreakdown(data: AiCloudControlsData, selection: Selection): TierContribution[] {
  const scoped = selectedControls(data, selection);
  return [...data.tiers]
    .sort((a, b) => a.order - b.order)
    .filter((t) => tierApplies(t.id, selection.tier))
    .map((t) => ({
      tier: t.id,
      name: t.name,
      count: scoped.filter((c) => c.tier === t.id).length,
      inherited: t.id !== selection.tier,
    }));
}

/** The distinct framework references across the in-scope set, stably ordered. */
export function referencedFrameworks(data: AiCloudControlsData, selection: Selection): string[] {
  const seen = new Set<string>();
  for (const control of selectedControls(data, selection)) {
    for (const ref of control.refs) seen.add(ref);
  }
  return [...seen].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

// --------------------------- framework references ---------------------------

/**
 * Every ref code in the dataset is an identifier the site already publishes on
 * /frameworks/ai/, so a ref chip can deep-link straight to its plain-English
 * translation. The shapes below are the four vocabularies that page carries:
 * NIST AI RMF functions, the OWASP LLM Top 10, MITRE ATLAS tactics, and the
 * ISO/IEC 42001 clauses. tests/ai-cloud-controls.test.ts checks each ref
 * against ai-frameworks.json so a typo or an invented identifier cannot ship.
 */
export type RefFrameworkId = 'AIRMF' | 'OWASP-LLM' | 'ATLAS' | 'ISO42001';

export interface RefFramework {
  id: RefFrameworkId;
  /** Short label for a chip title, e.g. "NIST AI RMF". */
  name: string;
  order: number;
}

const REF_FRAMEWORKS: { framework: RefFramework; pattern: RegExp }[] = [
  { framework: { id: 'AIRMF', name: 'NIST AI RMF', order: 0 }, pattern: /^(GOVERN|MAP|MEASURE|MANAGE) \d+$/ },
  { framework: { id: 'OWASP-LLM', name: 'OWASP Top 10 for LLMs', order: 1 }, pattern: /^LLM\d{2}$/ },
  { framework: { id: 'ATLAS', name: 'MITRE ATLAS', order: 2 }, pattern: /^AML\.TA\d{4}$/ },
  { framework: { id: 'ISO42001', name: 'ISO/IEC 42001', order: 3 }, pattern: /^(Clause \d+|Annex A)$/ },
];

/** Which of the four AI frameworks a ref code belongs to, or null if it fits none. */
export function refFramework(code: string): RefFramework | null {
  return REF_FRAMEWORKS.find((entry) => entry.pattern.test(code))?.framework ?? null;
}

export interface RefGroup {
  framework: RefFramework;
  codes: string[];
}

/**
 * The in-scope references grouped by framework, in framework order and then by
 * code. Sorting the four vocabularies into one flat list reads as noise, since
 * "AML.TA0010" and "Clause 6" and "LLM01" have nothing to sort against.
 */
export function referenceGroups(data: AiCloudControlsData, selection: Selection): RefGroup[] {
  const byFramework = new Map<RefFrameworkId, RefGroup>();
  for (const code of referencedFrameworks(data, selection)) {
    const framework = refFramework(code);
    if (!framework) continue;
    const group = byFramework.get(framework.id) ?? { framework, codes: [] };
    group.codes.push(code);
    byFramework.set(framework.id, group);
  }
  return [...byFramework.values()]
    .sort((a, b) => a.framework.order - b.framework.order)
    .map((group) => ({
      framework: group.framework,
      codes: [...group.codes].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })),
    }));
}

// ----------------------------- cloud comparison -----------------------------

export interface ComparisonRow {
  control: Control;
  /** One cell per provider, in the dataset's provider order. */
  cells: { provider: ProviderId; name: string; service: string }[];
}

/**
 * The same control set resolved across every provider at once. This is the view
 * the single-cloud mode cannot give you: whether the objective is a named
 * product on one cloud and a build-it-yourself job on another.
 */
export function comparisonRows(data: AiCloudControlsData, selection: Selection): ComparisonRow[] {
  return selectedControls(data, selection).map((control) => ({
    control,
    cells: data.providers.map((provider) => ({
      provider: provider.id,
      name: provider.name,
      service: serviceFor(control, provider.id),
    })),
  }));
}

export interface ComparisonGroup {
  layer: LayerId;
  name: string;
  hint: string;
  rows: ComparisonRow[];
}

/** Comparison rows grouped by layer, matching the single-cloud grouping. */
export function comparisonByLayer(data: AiCloudControlsData, selection: Selection): ComparisonGroup[] {
  const rows = comparisonRows(data, selection);
  return [...data.layers]
    .sort((a, b) => a.order - b.order)
    .map((layer) => ({
      layer: layer.id,
      name: layer.name,
      hint: layer.hint,
      rows: rows.filter((row) => row.control.layer === layer.id),
    }))
    .filter((group) => group.rows.length > 0);
}

/** Resolve a control to the native service for the selected provider. */
export function serviceFor(control: Control, provider: ProviderId): string {
  return control.services[provider];
}

export function providerName(data: AiCloudControlsData, provider: ProviderId): string {
  return data.providers.find((p) => p.id === provider)?.name ?? provider;
}

const csvCell = (value: string): string => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/** The columns every export shares, before the provider service columns. */
function csvPrefix(data: AiCloudControlsData, control: Control): string[] {
  const layerName = new Map(data.layers.map((l) => [l.id, l.name]));
  const tierName = new Map(data.tiers.map((t) => [t.id, t.name]));
  const phaseName = new Map(data.phases.map((p) => [p.id, p.name]));
  return [
    layerName.get(control.layer) ?? control.layer,
    phaseName.get(control.phase) ?? control.phase,
    tierName.get(control.tier) ?? control.tier,
    control.objective,
  ];
}

const CSV_PREFIX_HEADER = ['Layer', 'Phase', 'Introduced at tier', 'Control objective'];

/** CSV of the resolved control set for export, one service column. */
export function controlsCsv(data: AiCloudControlsData, selection: Selection): string {
  const header = [...CSV_PREFIX_HEADER, `${providerName(data, selection.provider)} service`, 'References'];
  const lines = [header.join(',')];
  for (const control of selectedControls(data, selection)) {
    lines.push(
      [...csvPrefix(data, control), serviceFor(control, selection.provider), control.refs.join(' ')]
        .map(csvCell)
        .join(','),
    );
  }
  return lines.join('\n');
}

/**
 * CSV of the same control set with a column per provider. This is the export
 * people actually want out of a comparison: one row per objective, three
 * clouds side by side, ready to paste into an architecture decision record.
 */
export function comparisonCsv(data: AiCloudControlsData, selection: Selection): string {
  const header = [
    ...CSV_PREFIX_HEADER,
    ...data.providers.map((provider) => `${provider.name} service`),
    'References',
  ];
  const lines = [header.join(',')];
  for (const row of comparisonRows(data, selection)) {
    lines.push(
      [...csvPrefix(data, row.control), ...row.cells.map((cell) => cell.service), row.control.refs.join(' ')]
        .map(csvCell)
        .join(','),
    );
  }
  return lines.join('\n');
}
