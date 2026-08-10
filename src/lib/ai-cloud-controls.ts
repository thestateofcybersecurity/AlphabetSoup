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
  meta: { title: string; version: string; note: string; sources: { name: string; url: string }[] };
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

/** Resolve a control to the native service for the selected provider. */
export function serviceFor(control: Control, provider: ProviderId): string {
  return control.services[provider];
}

export function providerName(data: AiCloudControlsData, provider: ProviderId): string {
  return data.providers.find((p) => p.id === provider)?.name ?? provider;
}

/** CSV of the resolved control set for export. */
export function controlsCsv(data: AiCloudControlsData, selection: Selection): string {
  const layerName = new Map(data.layers.map((l) => [l.id, l.name]));
  const tierName = new Map(data.tiers.map((t) => [t.id, t.name]));
  const phaseName = new Map(data.phases.map((p) => [p.id, p.name]));
  const header = ['Layer', 'Phase', 'Introduced at tier', 'Control objective', `${providerName(data, selection.provider)} service`, 'References'];
  const cell = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [header.join(',')];
  for (const c of selectedControls(data, selection)) {
    lines.push(
      [
        layerName.get(c.layer) ?? c.layer,
        phaseName.get(c.phase) ?? c.phase,
        tierName.get(c.tier) ?? c.tier,
        c.objective,
        serviceFor(c, selection.provider),
        c.refs.join(' '),
      ]
        .map(cell)
        .join(','),
    );
  }
  return lines.join('\n');
}
