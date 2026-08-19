/**
 * AI Threat Modeler: pure logic over src/data/ai-threat-model.json.
 *
 * The discipline this module enforces is question-first: candidate threats are
 * derived only from the system the user described (components, exposure, data
 * class), each carries the reason it was proposed, and nothing is scored until
 * the user judges applicability and picks anchored likelihood and impact. The
 * tool proposes; the modeler concludes.
 */

export type StrideCategory =
  | 'Spoofing'
  | 'Tampering'
  | 'Repudiation'
  | 'Information disclosure'
  | 'Denial of service'
  | 'Elevation of privilege';

export interface ThreatComponent {
  id: string;
  label: string;
  detail: string;
  boundary: string;
}

export interface AnchoredOption {
  id: string;
  label: string;
  detail: string;
}

export interface Threat {
  id: string;
  title: string;
  stride: StrideCategory;
  /** 'system' threats instantiate once, not per matching flow. */
  scope?: 'system' | 'flow';
  appliesWhen: { components: string[]; minData?: string; exposures?: string[] };
  because: string;
  description: string;
  refs: string[];
  mitigations: { text: string; refs: string[] }[];
}

export interface ThreatModelData {
  meta: { title: string; version: string; methodology: string; sources: { name: string; url: string }[] };
  components: ThreatComponent[];
  exposures: AnchoredOption[];
  dataClasses: AnchoredOption[];
  likelihood: AnchoredOption[];
  impact: AnchoredOption[];
  riskMatrix: Record<string, RiskLevel>;
  threats: Threat[];
}

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/** What the user said they are building (question one). */
export interface SystemProfile {
  name: string;
  components: string[];
  exposure: string;
  dataClass: string;
  /** Accountable for the system; a model without one is a sketch. */
  owner?: string;
  /** Who reviews the model; the field that makes it a governance artifact. */
  reviewer?: string;
  /** Custom diagram, when the modeler edits the canvas; absent = derived. */
  graph?: SystemGraph;
}

/** A typed diagram node: the Threat Dragon trio, placed in a trust zone. */
export interface GraphNode {
  id: string;
  kind: 'actor' | 'process' | 'store';
  label: string;
  sub?: string;
  zone: 'users' | 'app' | 'outside';
  x: number;
  y: number;
}

/**
 * A data flow between two nodes. `kind` names the component class whose
 * threats attach to this flow ('plain' carries none), and `dataClass`
 * overrides the system-wide data sensitivity for this flow alone.
 */
export interface GraphFlow {
  id: string;
  from: string;
  to: string;
  kind: string;
  label: string;
  dataClass?: string;
}

export interface SystemGraph {
  nodes: GraphNode[];
  flows: GraphFlow[];
}

/** The user's judgment on one candidate threat (question two). */
export interface ThreatVerdict {
  status: 'applies' | 'mitigated' | 'not-applicable' | 'unreviewed';
  likelihood?: string;
  impact?: string;
  note?: string;
  /** Treatment decision for threats that apply (question three). */
  treatment?: 'mitigate' | 'accept';
  owner?: string;
  /** Re-rating after the treatment lands: the residual risk anchors. */
  residualLikelihood?: string;
  residualImpact?: string;
}

export const RISK_ORDER: RiskLevel[] = ['low', 'medium', 'high', 'critical'];

export function riskRank(level: RiskLevel): number {
  return RISK_ORDER.indexOf(level);
}

/** A candidate threat plus the concrete reason it was proposed for THIS system. */
export interface CandidateThreat {
  threat: Threat;
  boundary: string;
  because: string;
  /** The selected component that surfaced this threat. */
  componentId: string;
}

function dataRank(data: ThreatModelData, id: string): number {
  return data.dataClasses.findIndex((d) => d.id === id);
}

/**
 * The candidate threats for a described system, grouped by trust boundary.
 * Empty until at least one component is selected: no system, no conclusions.
 */
export function candidateThreats(data: ThreatModelData, profile: SystemProfile): CandidateThreat[] {
  if (profile.components.length === 0) return [];
  const selected = new Set(profile.components);
  const byId = Object.fromEntries(data.components.map((c) => [c.id, c]));

  return data.threats
    .filter((threat) => {
      const w = threat.appliesWhen;
      if (!w.components.some((c) => selected.has(c))) return false;
      if (w.minData && dataRank(data, profile.dataClass) < dataRank(data, w.minData)) return false;
      if (w.exposures && !w.exposures.includes(profile.exposure)) return false;
      return true;
    })
    .map((threat) => {
      // Anchor the rationale to the first matching component the user chose,
      // so the card can say which of their answers surfaced this threat.
      const trigger = threat.appliesWhen.components.find((c) => selected.has(c))!;
      return { threat, boundary: byId[trigger].boundary, because: threat.because, componentId: trigger };
    });
}

/** The trust boundaries present in this system, in component order. */
export function boundaries(data: ThreatModelData, profile: SystemProfile): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const component of data.components) {
    if (profile.components.includes(component.id) && !seen.has(component.boundary)) {
      seen.add(component.boundary);
      out.push(component.boundary);
    }
  }
  return out;
}

/** Risk for an anchored likelihood x impact pair; null until both are chosen. */
export function riskFor(data: ThreatModelData, likelihood?: string, impact?: string): RiskLevel | null {
  if (!likelihood || !impact) return null;
  return data.riskMatrix[`${likelihood}|${impact}`] ?? null;
}

export interface ModelSummary {
  total: number;
  reviewed: number;
  applies: number;
  mitigated: number;
  notApplicable: number;
  byRisk: Record<RiskLevel, number>;
  /** Applies-threats missing a treatment decision (question four's nagging). */
  untreated: number;
  /** Applies-threats missing likelihood or impact. */
  unrated: number;
  /** Residual risk after treatment, for applies-threats that re-rated. */
  byResidualRisk: Record<RiskLevel, number>;
  /** Mitigate-decisions that never re-rated the residual risk. */
  mitigatedNoResidual: number;
}

export function summarize(
  data: ThreatModelData,
  instances: FlowInstance[],
  verdicts: Record<string, ThreatVerdict>,
): ModelSummary {
  const summary: ModelSummary = {
    total: instances.length,
    reviewed: 0,
    applies: 0,
    mitigated: 0,
    notApplicable: 0,
    byRisk: { low: 0, medium: 0, high: 0, critical: 0 },
    untreated: 0,
    unrated: 0,
    byResidualRisk: { low: 0, medium: 0, high: 0, critical: 0 },
    mitigatedNoResidual: 0,
  };
  for (const { key } of instances) {
    const verdict = verdicts[key] ?? { status: 'unreviewed' };
    if (verdict.status !== 'unreviewed') summary.reviewed += 1;
    if (verdict.status === 'mitigated') summary.mitigated += 1;
    if (verdict.status === 'not-applicable') summary.notApplicable += 1;
    if (verdict.status === 'applies') {
      summary.applies += 1;
      const risk = riskFor(data, verdict.likelihood, verdict.impact);
      if (risk) summary.byRisk[risk] += 1;
      else summary.unrated += 1;
      if (!verdict.treatment) summary.untreated += 1;
      const residual = riskFor(data, verdict.residualLikelihood, verdict.residualImpact);
      if (residual) summary.byResidualRisk[residual] += 1;
      else if (verdict.treatment === 'mitigate') summary.mitigatedNoResidual += 1;
    }
  }
  return summary;
}

/** The register as CSV, one row per candidate threat with the user's verdict. */
export function registerCsv(
  data: ThreatModelData,
  profile: SystemProfile,
  instances: FlowInstance[],
  verdicts: Record<string, ThreatVerdict>,
): string {
  const escapeCell = (value: string): string => `"${value.replace(/"/g, '""')}"`;
  const rows = [
    ['id', 'threat', 'stride', 'flow', 'trust boundary', 'status', 'likelihood', 'impact', 'risk', 'residual', 'treatment', 'owner', 'note', 'references'],
    ...instances.map(({ threat, flow, boundary, key }) => {
      const v = verdicts[key] ?? { status: 'unreviewed' };
      return [
        threat.id,
        threat.title,
        threat.stride,
        flow.label,
        boundary,
        v.status,
        v.likelihood ?? '',
        v.impact ?? '',
        riskFor(data, v.likelihood, v.impact) ?? '',
        riskFor(data, v.residualLikelihood, v.residualImpact) ?? '',
        v.treatment ?? '',
        v.owner ?? '',
        v.note ?? '',
        threat.refs.join(' '),
      ];
    }),
  ];
  return `${escapeCell(profile.name || 'Untitled system')}\n` + rows.map((row) => row.map(escapeCell).join(',')).join('\n');
}

/** Validate dataset integrity; returns human-readable problems (empty = valid). */
export function validateThreatModel(data: ThreatModelData): string[] {
  const errors: string[] = [];
  const componentIds = new Set(data.components.map((c) => c.id));
  const exposureIds = new Set(data.exposures.map((e) => e.id));
  const dataIds = new Set(data.dataClasses.map((d) => d.id));
  const STRIDE: StrideCategory[] = [
    'Spoofing', 'Tampering', 'Repudiation', 'Information disclosure', 'Denial of service', 'Elevation of privilege',
  ];

  if (data.threats.length < 20) errors.push(`Expected at least 20 threats, found ${data.threats.length}`);

  const ids = new Set<string>();
  for (const threat of data.threats) {
    const where = `[${threat.id}]`;
    if (ids.has(threat.id)) errors.push(`${where} duplicate id`);
    ids.add(threat.id);
    if (!STRIDE.includes(threat.stride)) errors.push(`${where} invalid STRIDE category "${threat.stride}"`);
    if (threat.scope && threat.scope !== 'system' && threat.scope !== 'flow') {
      errors.push(`${where} invalid scope "${threat.scope}"`);
    }
    if (threat.appliesWhen.components.length === 0) errors.push(`${where} appliesWhen.components is empty`);
    for (const c of threat.appliesWhen.components) {
      if (!componentIds.has(c)) errors.push(`${where} unknown component "${c}"`);
    }
    if (threat.appliesWhen.minData && !dataIds.has(threat.appliesWhen.minData)) {
      errors.push(`${where} unknown minData "${threat.appliesWhen.minData}"`);
    }
    for (const e of threat.appliesWhen.exposures ?? []) {
      if (!exposureIds.has(e)) errors.push(`${where} unknown exposure "${e}"`);
    }
    if (threat.description.length < 120) errors.push(`${where} description too short`);
    if (!threat.because.trim()) errors.push(`${where} missing because rationale`);
    if (threat.mitigations.length === 0) errors.push(`${where} needs at least one mitigation`);
    if (threat.refs.length === 0) errors.push(`${where} needs framework references`);
  }

  // Every likelihood x impact pair must resolve in the matrix.
  for (const l of data.likelihood) {
    for (const i of data.impact) {
      const risk = data.riskMatrix[`${l.id}|${i.id}`];
      if (!risk || !RISK_ORDER.includes(risk)) {
        errors.push(`riskMatrix missing or invalid for ${l.id}|${i.id}`);
      }
    }
  }

  // Every component must surface at least one threat, or selecting it is a no-op.
  for (const component of data.components) {
    if (!data.threats.some((t) => t.appliesWhen.components.includes(component.id))) {
      errors.push(`component "${component.id}" surfaces no threats`);
    }
  }

  if (JSON.stringify(data).includes('—')) errors.push('Dataset contains an em dash');
  return errors;
}

// ---------------------------------------------------------------------------
// Data flow diagram: derived from the answers, never drawn from scratch.
// ---------------------------------------------------------------------------

export interface DiagramZone {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DiagramNode {
  id: string;
  label: string;
  sub: string;
  /** Threat Dragon element type this node maps to on export. */
  kind: 'actor' | 'process' | 'store';
  zone: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DiagramFlow {
  id: string;
  from: string;
  to: string;
  /** The component whose threats attach to this flow. */
  componentId: string;
  /** Candidate threats proposed at this crossing. */
  badge: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface DiagramLayout {
  zones: DiagramZone[];
  nodes: DiagramNode[];
  flows: DiagramFlow[];
  width: number;
  height: number;
}

const NODE_H = 46;
const NODE_GAP = 64;
const ZONE_TOP = 64;

/** Fixed trust zone columns; a node's zone is the column that holds it. */
export const ZONE_COLUMNS: { id: GraphNode['zone']; label: string; x: number; w: number }[] = [
  { id: 'users', label: 'Untrusted users', x: 16, w: 140 },
  { id: 'app', label: 'Your application', x: 186, w: 290 },
  { id: 'outside', label: 'Outside your control', x: 506, w: 158 },
];

/** The zone whose column contains an x coordinate. */
export function zoneAt(x: number): GraphNode['zone'] {
  if (x < ZONE_COLUMNS[1].x - 10) return 'users';
  if (x < ZONE_COLUMNS[2].x - 10) return 'app';
  return 'outside';
}

/**
 * The diagram the quick answers imply. Node and flow ids are stable (flow id
 * equals the component id), so verdicts keyed on them survive a switch into
 * the canvas editor and back.
 */
export function defaultGraph(data: ThreatModelData, profile: SystemProfile): SystemGraph {
  const has = (id: string) => profile.components.includes(id);
  const nodes: GraphNode[] = [];
  const place = (zone: GraphNode['zone'], id: string, label: string, sub: string, kind: GraphNode['kind']) => {
    const col = ZONE_COLUMNS.find((z) => z.id === zone)!;
    const index = nodes.filter((n) => n.zone === zone).length;
    nodes.push({ id, kind, label, sub, zone, x: col.x + 12, y: ZONE_TOP + 26 + index * NODE_GAP });
  };

  if (has('user-chat')) place('users', 'users', 'Users', 'free-text input', 'actor');
  if (profile.components.length > 0) place('app', 'app', 'Application', 'orchestration and prompts', 'process');
  if (has('rag')) place('app', 'index', 'Vector index', 'your documents', 'store');
  if (has('self-hosted')) place('app', 'model', 'Self-hosted model', 'weights you run', 'process');
  if (has('training-data')) place('app', 'training', 'Training data', 'shapes the weights', 'store');
  if (has('batch')) place('app', 'pipeline', 'Batch pipeline', 'unattended runs', 'process');
  if (has('output-decisions')) place('app', 'consumer', 'Decision consumer', 'people and systems', 'process');
  if (has('vendor-llm')) place('outside', 'provider', 'Model provider', 'vendor API', 'process');
  if (has('agent-tools')) place('outside', 'tools', 'Tools and APIs', 'the agent acts here', 'process');
  if (has('batch')) place('outside', 'feeds', 'Data feeds', 'upstream sources', 'actor');

  const ids = new Set(nodes.map((n) => n.id));
  const label = (id: string) => data.components.find((c) => c.id === id)?.label ?? id;
  const flows: GraphFlow[] = [];
  const connect = (kind: string, from: string, to: string) => {
    if (ids.has(from) && ids.has(to)) flows.push({ id: kind, from, to, kind, label: label(kind) });
  };
  connect('user-chat', 'users', 'app');
  connect('rag', 'index', 'app');
  connect('vendor-llm', 'app', 'provider');
  connect('self-hosted', 'app', 'model');
  connect('training-data', 'training', has('self-hosted') ? 'model' : 'app');
  connect('agent-tools', 'app', 'tools');
  connect('batch', 'feeds', 'pipeline');
  connect('output-decisions', 'app', 'consumer');
  return { nodes, flows };
}

/** The working graph: the modeler's canvas edits, or the derived default. */
export function graphOf(data: ThreatModelData, profile: SystemProfile): SystemGraph {
  return profile.graph ?? defaultGraph(data, profile);
}

/**
 * A candidate threat attached to one specific flow. Two retrieval stores mean
 * two sets of retrieval threats, each judged on its own.
 */
export interface FlowInstance {
  threat: Threat;
  flow: GraphFlow;
  because: string;
  boundary: string;
  /** Unique verdict key for this threat on this flow. */
  key: string;
}

function flowBoundary(graph: SystemGraph, flow: GraphFlow): string {
  const from = graph.nodes.find((n) => n.id === flow.from);
  const to = graph.nodes.find((n) => n.id === flow.to);
  const zoneLabel = (z?: GraphNode['zone']) => ZONE_COLUMNS.find((c) => c.id === z)?.label ?? 'Unknown';
  if (!from || !to) return 'Unknown boundary';
  if (from.zone === to.zone) return `Inside ${zoneLabel(from.zone).toLowerCase()}`;
  return `${zoneLabel(from.zone)} to ${zoneLabel(to.zone).toLowerCase()}`;
}

/**
 * Per-flow threat enumeration over the working graph: still question-first
 * (an empty graph proposes nothing), still gated on data class (per flow,
 * falling back to the system-wide answer) and exposure.
 */
export function flowCandidates(data: ThreatModelData, profile: SystemProfile): FlowInstance[] {
  const graph = graphOf(data, profile);
  const rank = (id: string) => data.dataClasses.findIndex((d) => d.id === id);
  const out: FlowInstance[] = [];
  const systemSeen = new Set<string>();
  for (const flow of graph.flows) {
    if (flow.kind === 'plain') continue;
    for (const threat of data.threats) {
      const w = threat.appliesWhen;
      if (!w.components.includes(flow.kind)) continue;
      if (w.minData && rank(flow.dataClass ?? profile.dataClass) < rank(w.minData)) continue;
      if (w.exposures && !w.exposures.includes(profile.exposure)) continue;
      // System-scoped threats (ownership, inventory, audit) are about the
      // whole system: one instance, on the first flow that surfaces them.
      if (threat.scope === 'system') {
        if (systemSeen.has(threat.id)) continue;
        systemSeen.add(threat.id);
        out.push({ threat, flow, because: threat.because, boundary: flowBoundary(graph, flow), key: `${threat.id}@system` });
        continue;
      }
      out.push({
        threat,
        flow,
        because: threat.because,
        boundary: flowBoundary(graph, flow),
        key: `${threat.id}@${flow.id}`,
      });
    }
  }
  return out;
}

/**
 * Rewrite verdict keys from the pre-canvas format (bare threat ids) to
 * per-flow instance keys, so models saved before the canvas existed load
 * with their judgments intact.
 */
export function migrateVerdicts(
  data: ThreatModelData,
  profile: SystemProfile,
  verdicts: Record<string, ThreatVerdict>,
): Record<string, ThreatVerdict> {
  if (Object.keys(verdicts).every((k) => k.includes('@'))) return verdicts;
  const instances = flowCandidates(data, profile);
  const migrated: Record<string, ThreatVerdict> = {};
  for (const [key, verdict] of Object.entries(verdicts)) {
    if (key.includes('@')) {
      migrated[key] = verdict;
      continue;
    }
    const instance = instances.find((i) => i.threat.id === key);
    migrated[instance ? instance.key : key] = verdict;
  }
  return migrated;
}

/**
 * Geometry for the working graph: zone columns sized to their members, node
 * rects at their stored positions, flow lines between rect edges, badges
 * counting the candidate threats per flow.
 */
export function diagramLayout(
  data: ThreatModelData,
  profile: SystemProfile,
  instances: FlowInstance[],
): DiagramLayout | null {
  const graph = graphOf(data, profile);
  if (graph.nodes.length === 0) return null;

  const badges: Record<string, number> = {};
  for (const i of instances) badges[i.flow.id] = (badges[i.flow.id] ?? 0) + 1;

  const nodeW = (zone: GraphNode['zone']) => ZONE_COLUMNS.find((z) => z.id === zone)!.w - 24;
  const nodes: DiagramNode[] = graph.nodes.map((n) => ({
    id: n.id, label: n.label, sub: n.sub ?? '', kind: n.kind, zone: n.zone,
    x: n.x, y: n.y, w: nodeW(n.zone), h: NODE_H,
  }));
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

  const flows: DiagramFlow[] = graph.flows.flatMap((flow) => {
    const from = byId[flow.from];
    const to = byId[flow.to];
    if (!from || !to) return [];
    const leftToRight = from.x < to.x;
    const sameColumn = from.zone === to.zone;
    const x1 = sameColumn ? from.x + from.w / 2 : leftToRight ? from.x + from.w : from.x;
    const x2 = sameColumn ? to.x + to.w / 2 : leftToRight ? to.x : to.x + to.w;
    const y1 = sameColumn ? (from.y < to.y ? from.y + from.h : from.y) : from.y + from.h / 2;
    const y2 = sameColumn ? (from.y < to.y ? to.y : to.y + to.h) : to.y + to.h / 2;
    return [{ id: flow.id, from: flow.from, to: flow.to, componentId: flow.kind, badge: badges[flow.id] ?? 0, x1, y1, x2, y2 }];
  });

  const zones: DiagramZone[] = ZONE_COLUMNS
    .filter((col) => nodes.some((n) => n.zone === col.id))
    .map((col) => {
      const members = nodes.filter((n) => n.zone === col.id);
      const bottom = Math.max(...members.map((n) => n.y + n.h));
      return { id: col.id, label: col.label, x: col.x, y: ZONE_TOP, w: col.w, h: bottom - ZONE_TOP + 16 };
    });

  const height = Math.max(...zones.map((z) => z.y + z.h)) + 24;
  return { zones, nodes, flows, width: 680, height };
}

// ---------------------------------------------------------------------------
// Threat Dragon (OWASP) v2 export, so models made here travel to the
// standard open-source tool. Schema mirrored from Threat Dragon 2.3 demo
// models: summary/detail envelope, x6 cells with tm.* data, threats per cell.
// ---------------------------------------------------------------------------

const TD_VERSION = '2.3.0';

function tdStatus(status: ThreatVerdict['status']): string {
  if (status === 'mitigated') return 'Mitigated';
  if (status === 'not-applicable') return 'NotApplicable';
  return 'Open';
}

function tdSeverity(risk: RiskLevel | null): string {
  if (!risk) return '';
  if (risk === 'critical' || risk === 'high') return 'High';
  return risk === 'medium' ? 'Medium' : 'Low';
}

export function threatDragonModel(
  data: ThreatModelData,
  profile: SystemProfile,
  instances: FlowInstance[],
  verdicts: Record<string, ThreatVerdict>,
  id: () => string,
): object {
  const layout = diagramLayout(data, profile, instances);
  if (!layout) throw new Error('Describe the system before exporting');

  const cellIds = new Map<string, string>();
  for (const node of layout.nodes) cellIds.set(node.id, id());

  let number = 0;
  const threatsFor = (flowId: string) =>
    instances
      .filter((i) => i.flow.id === flowId)
      .map(({ threat, because, key }) => {
        const v = verdicts[key] ?? { status: 'unreviewed' as const };
        const mitigation = [
          ...threat.mitigations.map((m) => `- ${m.text}`),
          v.treatment ? `Treatment: ${v.treatment}${v.owner ? `, owner ${v.owner}` : ''}` : '',
          v.note ? `Note: ${v.note}` : '',
        ].filter(Boolean).join('\n');
        number += 1;
        return {
          id: id(),
          title: `${threat.id} ${threat.title}`,
          status: tdStatus(v.status),
          severity: tdSeverity(riskFor(data, v.likelihood, v.impact)),
          type: threat.stride,
          description: `${threat.description}\n\nProposed because ${because}.`,
          mitigation,
          modelType: 'STRIDE',
          number,
          score: '',
        };
      });

  const boundaryCells = layout.zones.map((zone) => ({
    id: id(),
    shape: 'trust-boundary-box',
    position: { x: zone.x, y: zone.y },
    size: { width: zone.w, height: zone.h },
    zIndex: -1,
    data: { type: 'tm.BoundaryBox', name: zone.label, isTrustBoundary: true, hasOpenThreats: false },
  }));

  const nodeCells = layout.nodes.map((node) => ({
    id: cellIds.get(node.id)!,
    shape: node.kind,
    position: { x: node.x, y: node.y },
    size: { width: node.w, height: node.h },
    attrs: { text: { text: node.label } },
    data: {
      type: node.kind === 'actor' ? 'tm.Actor' : node.kind === 'store' ? 'tm.Store' : 'tm.Process',
      name: node.label,
      description: node.sub,
      outOfScope: false,
      reasonOutOfScope: '',
      hasOpenThreats: false,
      threats: [],
    },
  }));

  const graph = graphOf(data, profile);
  const flowCells = layout.flows.map((flow) => {
    const componentLabel = graph.flows.find((f) => f.id === flow.id)?.label ?? flow.componentId;
    const threats = threatsFor(flow.id);
    return {
      id: id(),
      shape: 'flow',
      source: { cell: cellIds.get(flow.from)! },
      target: { cell: cellIds.get(flow.to)! },
      labels: [componentLabel],
      data: {
        type: 'tm.Flow',
        name: componentLabel,
        description: '',
        outOfScope: false,
        reasonOutOfScope: '',
        isBidirectional: false,
        isEncrypted: false,
        isPublicNetwork: profile.exposure === 'public',
        protocol: '',
        hasOpenThreats: threats.some((t) => t.status === 'Open'),
        threats,
      },
    };
  });

  return {
    version: TD_VERSION,
    summary: {
      title: profile.name || 'Untitled AI system',
      owner: profile.owner ?? '',
      description: `AI threat model generated by the Cybersecurity Alphabet Soup AI Threat Modeler (dataset v${data.meta.version}). Exposure: ${profile.exposure}; data class: ${profile.dataClass}.`,
      id: 0,
    },
    detail: {
      contributors: [],
      reviewer: profile.reviewer ?? '',
      diagrams: [
        {
          id: 0,
          version: TD_VERSION,
          title: 'System data flow',
          description: 'Derived from the described components; threats attach to the flows that surfaced them.',
          diagramType: 'STRIDE',
          thumbnail: './public/content/images/thumbnail.stride.jpg',
          cells: [...boundaryCells, ...nodeCells, ...flowCells],
        },
      ],
      diagramTop: 1,
      threatTop: number,
    },
  };
}

// ---------------------------------------------------------------------------
// Roadmap handoff: mitigate-decisions become plan tasks.
// ---------------------------------------------------------------------------

export interface ThreatRoadmapTask {
  id: string;
  label: string;
  group: string;
  detail: string;
  defaultQuarter: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  link?: string;
}

/**
 * One task per threat the modeler decided to mitigate, quartered by rated
 * risk (critical and high land in Q1). Accept-decisions and unreviewed
 * threats stay out: the roadmap plans work, not worries.
 */
export function threatPlan(
  data: ThreatModelData,
  models: { profile: SystemProfile; verdicts: Record<string, ThreatVerdict> }[],
): ThreatRoadmapTask[] {
  const byId = Object.fromEntries(data.threats.map((t) => [t.id, t]));
  const quarterFor = (risk: RiskLevel | null): ThreatRoadmapTask['defaultQuarter'] =>
    risk === 'critical' || risk === 'high' ? 'Q1' : risk === 'medium' ? 'Q2' : 'Q3';
  const tasks: ThreatRoadmapTask[] = [];

  for (const model of models) {
    const system = model.profile.name || 'Untitled AI system';
    for (const [key, verdict] of Object.entries(model.verdicts)) {
      if (verdict.status !== 'applies' || verdict.treatment !== 'mitigate') continue;
      const [threatId, flowId] = key.split('@');
      const threat = byId[threatId];
      if (!threat) continue;
      const flowLabel = model.profile.graph?.flows.find((f) => f.id === flowId)?.label
        ?? data.components.find((c) => c.id === flowId)?.label;
      const risk = riskFor(data, verdict.likelihood, verdict.impact);
      tasks.push({
        id: `threat:${system.toLowerCase().replace(/[^a-z0-9]+/g, '-')}:${key}`,
        label: `Mitigate ${threatId}: ${threat.title}${flowLabel ? ` (${flowLabel})` : ''}`,
        group: system,
        detail:
          `${risk ? `${risk.toUpperCase()} risk. ` : ''}${threat.mitigations.map((m) => m.text).join(' ')}` +
          `${verdict.owner ? ` Owner: ${verdict.owner}.` : ''}`,
        defaultQuarter: quarterFor(risk),
        link: '../tools/ai-threat-model/',
      });
    }
  }
  return tasks.sort((a, b) => a.defaultQuarter.localeCompare(b.defaultQuarter) || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Report export: one self-contained HTML document, no external resources, so
// it opens anywhere, attaches to a ticket, and prints to PDF from any
// browser. Literal light-palette colors, because a document has one look.
// ---------------------------------------------------------------------------

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const REPORT_COLORS: Record<RiskLevel, string> = {
  low: '#397248',
  medium: '#865f23',
  high: '#b0402e',
  critical: '#7a1f1f',
};

function reportSvg(data: ThreatModelData, profile: SystemProfile, instances: FlowInstance[]): string {
  const layout = diagramLayout(data, profile, instances);
  if (!layout) return '';
  const graph = graphOf(data, profile);
  const zones = layout.zones
    .map(
      (z) => `<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="10" fill="none" stroke="#b8ab95" stroke-width="1.5" stroke-dasharray="6 4"/>` +
        `<text x="${z.x + 10}" y="${z.y - 9}" font-size="11" letter-spacing="1" fill="#5c6a72" font-family="ui-monospace, monospace">${escapeHtml(z.label.toUpperCase())}</text>`,
    )
    .join('');
  const flows = layout.flows
    .map((f) => {
      const mx = (f.x1 + f.x2) / 2;
      const my = (f.y1 + f.y2) / 2;
      const badge = f.badge > 0
        ? `<circle cx="${mx}" cy="${my}" r="11" fill="#fff" stroke="#b0402e" stroke-width="1.5"/>` +
          `<text x="${mx}" y="${my + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="#b0402e" font-family="ui-monospace, monospace">${f.badge}</text>`
        : '';
      return `<line x1="${f.x1}" y1="${f.y1}" x2="${f.x2}" y2="${f.y2}" stroke="#5c6a72" stroke-width="1.2" marker-end="url(#rp-arrow)"/>${badge}`;
    })
    .join('');
  const nodes = layout.nodes
    .map(
      (n) => `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="8" fill="#faf6ec" stroke="#c8401f" stroke-width="1"/>` +
        `<text x="${n.x + 10}" y="${n.y + 19}" font-size="13" font-weight="600" fill="#23303a">${escapeHtml(n.label)}</text>` +
        `<text x="${n.x + 10}" y="${n.y + 35}" font-size="11" fill="#5c6a72">${escapeHtml(n.sub || n.kind)}</text>`,
    )
    .join('');
  const flowLabel = (id: string) => graph.flows.find((f) => f.id === id)?.label ?? '';
  const legend = layout.flows.filter((f) => f.badge > 0).length > 0
    ? `<text x="20" y="${layout.height - 6}" font-size="10" fill="#5c6a72">Badges: candidate threats where that flow crosses a trust boundary.</text>`
    : '';
  void flowLabel;
  return `<svg width="100%" viewBox="0 0 ${layout.width} ${layout.height + 14}" role="img" aria-label="Data flow diagram" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><marker id="rp-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">` +
    `<path d="M2 1L8 5L2 9" fill="none" stroke="#5c6a72" stroke-width="1.5" stroke-linecap="round"/></marker></defs>${zones}${flows}${nodes}${legend}</svg>`;
}

/**
 * The full threat model as a standalone HTML report: header and metadata,
 * executive summary with open work called out, the diagram, the register,
 * detail per applying threat, documented judgments (mitigated and
 * not-applicable notes), and the methodology. Print-friendly A4 styling.
 */
export function threatModelReport(
  data: ThreatModelData,
  profile: SystemProfile,
  instances: FlowInstance[],
  verdicts: Record<string, ThreatVerdict>,
  generatedAt: string,
): string {
  const e = escapeHtml;
  const summary = summarize(data, instances, verdicts);
  const name = profile.name || 'Untitled AI system';
  const exposure = data.exposures.find((x) => x.id === profile.exposure)?.label ?? profile.exposure;
  const dataClass = data.dataClasses.find((d) => d.id === profile.dataClass)?.label ?? profile.dataClass;

  const riskBadge = (risk: RiskLevel | null): string =>
    risk ? `<span class="risk" style="color:${REPORT_COLORS[risk]};border-color:${REPORT_COLORS[risk]}">${risk.toUpperCase()}</span>` : '';

  const openWork: string[] = [];
  if (summary.reviewed < summary.total) openWork.push(`${summary.total - summary.reviewed} candidate threats not yet judged`);
  if (summary.unrated > 0) openWork.push(`${summary.unrated} applying threats without a rating`);
  if (summary.untreated > 0) openWork.push(`${summary.untreated} applying threats without a treatment decision`);
  if (summary.mitigatedNoResidual > 0) openWork.push(`${summary.mitigatedNoResidual} mitigate decisions without a residual re-rating`);
  const unclassified = graphOf(data, profile).flows.filter((f) => f.kind === 'plain').length;
  if (unclassified > 0) openWork.push(`${unclassified} unclassified flows on the diagram`);

  const applying = instances.filter(({ key }) => (verdicts[key] ?? { status: 'unreviewed' }).status === 'applies');
  const ranked = [...applying].sort((a, b) => {
    const rank = (i: FlowInstance) => {
      const v = verdicts[i.key]!;
      const r = riskFor(data, v.likelihood, v.impact);
      return r ? riskRank(r) : -1;
    };
    return rank(b) - rank(a);
  });
  const topRisks = ranked
    .filter((i) => {
      const v = verdicts[i.key]!;
      const r = riskFor(data, v.likelihood, v.impact);
      return r === 'critical' || r === 'high';
    })
    .map((i) => `<li>${e(i.threat.id)} ${e(i.threat.title)} <em>(${e(i.flow.label)})</em> ${riskBadge(riskFor(data, verdicts[i.key]!.likelihood, verdicts[i.key]!.impact))}</li>`);

  const registerRows = instances
    .map(({ threat, flow, boundary, key }) => {
      const v = verdicts[key] ?? { status: 'unreviewed' as const };
      const risk = riskFor(data, v.likelihood, v.impact);
      const residual = riskFor(data, v.residualLikelihood, v.residualImpact);
      return `<tr>
        <td>${e(threat.id)}</td><td>${e(threat.title)}</td><td>${e(flow.label)}</td><td>${e(boundary)}</td>
        <td>${e(v.status)}</td><td>${riskBadge(risk)}</td><td>${riskBadge(residual)}</td><td>${e(v.treatment ?? '')}</td><td>${e(v.owner ?? '')}</td>
      </tr>`;
    })
    .join('');

  const detailSections = ranked
    .map((i) => {
      const v = verdicts[i.key]!;
      const risk = riskFor(data, v.likelihood, v.impact);
      const residual = riskFor(data, v.residualLikelihood, v.residualImpact);
      const refs = [...i.threat.refs, ...i.threat.mitigations.flatMap((m) => m.refs)];
      const uniqueRefs = [...new Set(refs)];
      return `<section class="detail">
        <h3>${e(i.threat.id)} ${e(i.threat.title)} <span class="tag">${e(i.threat.stride)}</span> <span class="tag">${e(i.flow.label)}</span></h3>
        <p class="because">Surfaced because ${e(i.because)}.</p>
        <p>${e(i.threat.description)}</p>
        <p><strong>Rating:</strong> ${e(v.likelihood ?? 'unrated')} likelihood, ${e(v.impact ?? 'unrated')} impact ${riskBadge(risk)}
        ${v.treatment ? ` &middot; <strong>Treatment:</strong> ${e(v.treatment)}${v.owner ? `, owner ${e(v.owner)}` : ''}` : ''}
        ${residual ? ` &middot; <strong>Residual:</strong> ${riskBadge(residual)}` : ''}</p>
        <p><strong>Mitigations:</strong></p>
        <ul>${i.threat.mitigations.map((m) => `<li>${e(m.text)}</li>`).join('')}</ul>
        <p class="refs">References: ${uniqueRefs.map((r) => `<a href="https://www.cybersecurityalphabetsoup.com/frameworks/ai/?q=${encodeURIComponent(r)}">${e(r)}</a>`).join(', ')}</p>
      </section>`;
    })
    .join('');

  const judged = instances
    .filter(({ key }) => {
      const s = (verdicts[key] ?? { status: 'unreviewed' }).status;
      return s === 'mitigated' || s === 'not-applicable';
    })
    .map(({ threat, flow, key }) => {
      const v = verdicts[key]!;
      return `<li><strong>${e(threat.id)} ${e(threat.title)}</strong> <em>(${e(flow.label)})</em>: ${v.status === 'mitigated' ? 'already mitigated' : 'not applicable'}${v.note ? ` &mdash;&#8288;` : ''}${v.note ? ` ${e(v.note)}` : ''}</li>`;
    });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>AI Threat Model Report: ${e(name)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0 auto; max-width: 880px; padding: 40px 32px; font-family: Georgia, 'Times New Roman', serif; color: #23303a; background: #fff; line-height: 1.55; }
  header { border-bottom: 3px solid #23303a; padding-bottom: 18px; margin-bottom: 24px; }
  h1 { font-size: 1.9rem; margin: 0 0 4px; }
  h2 { font-size: 1.2rem; border-bottom: 1px solid #d8ccb6; padding-bottom: 4px; margin: 30px 0 12px; }
  h3 { font-size: 1.02rem; margin: 0 0 6px; }
  .sub { color: #5c6a72; margin: 0; }
  .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 6px 20px; margin: 14px 0 0; font-size: 0.92rem; }
  .meta div span { display: block; font-family: ui-monospace, monospace; font-size: 0.68rem; letter-spacing: 0.1em; text-transform: uppercase; color: #5c6a72; }
  .risk { font-family: ui-monospace, monospace; font-size: 0.7rem; font-weight: 700; border: 1.5px solid; border-radius: 6px; padding: 1px 7px; white-space: nowrap; }
  .open { border: 1.5px solid #b0402e; border-radius: 10px; padding: 10px 16px; margin: 12px 0; }
  .open ul { margin: 6px 0; }
  .complete { border: 1.5px solid #397248; border-radius: 10px; padding: 10px 16px; margin: 12px 0; }
  .tiles { display: flex; gap: 14px; flex-wrap: wrap; margin: 12px 0; }
  .tile { border: 1px solid #d8ccb6; border-radius: 10px; padding: 8px 16px; text-align: center; }
  .tile b { display: block; font-size: 1.4rem; }
  .tile span { font-family: ui-monospace, monospace; font-size: 0.66rem; letter-spacing: 0.08em; text-transform: uppercase; color: #5c6a72; }
  table { width: 100%; border-collapse: collapse; font-size: 0.82rem; margin: 10px 0; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e4dac6; vertical-align: top; }
  th { font-family: ui-monospace, monospace; font-size: 0.64rem; letter-spacing: 0.1em; text-transform: uppercase; color: #5c6a72; }
  .detail { border: 1px solid #d8ccb6; border-radius: 10px; padding: 14px 18px; margin: 0 0 12px; break-inside: avoid; }
  .detail .because { font-style: italic; color: #993c1d; margin: 0 0 8px; font-size: 0.92rem; }
  .tag { font-family: ui-monospace, monospace; font-size: 0.62rem; letter-spacing: 0.06em; text-transform: uppercase; border: 1px solid #d8ccb6; border-radius: 999px; padding: 1px 8px; color: #5c6a72; font-weight: 400; }
  .refs { font-size: 0.85rem; }
  .refs a { color: #993c1d; }
  footer { border-top: 1px solid #d8ccb6; margin-top: 30px; padding-top: 12px; font-size: 0.82rem; color: #5c6a72; }
  @media print { body { padding: 0; } .detail, tr { break-inside: avoid; } }
</style>
</head>
<body>
<header>
  <h1>AI Threat Model: ${e(name)}</h1>
  <p class="sub">Question-first threat model, STRIDE per trust boundary, produced with the Cybersecurity Alphabet Soup AI Threat Modeler.</p>
  <div class="meta">
    <div><span>Owner</span>${e(profile.owner || 'Not named')}</div>
    <div><span>Reviewer</span>${e(profile.reviewer || 'Not named')}</div>
    <div><span>Exposure</span>${e(exposure)}</div>
    <div><span>Data sensitivity</span>${e(dataClass)}</div>
    <div><span>Generated</span>${e(generatedAt)}</div>
    <div><span>Threat library</span>v${e(data.meta.version)}</div>
  </div>
</header>

<h2>Executive summary</h2>
<div class="tiles">
  <div class="tile"><b>${summary.total}</b><span>candidates</span></div>
  <div class="tile"><b>${summary.applies}</b><span>apply</span></div>
  <div class="tile"><b style="color:${REPORT_COLORS.critical}">${summary.byRisk.critical}</b><span>critical</span></div>
  <div class="tile"><b style="color:${REPORT_COLORS.high}">${summary.byRisk.high}</b><span>high</span></div>
  <div class="tile"><b style="color:${REPORT_COLORS.medium}">${summary.byRisk.medium}</b><span>medium</span></div>
  <div class="tile"><b style="color:${REPORT_COLORS.low}">${summary.byRisk.low}</b><span>low</span></div>
</div>
${topRisks.length ? `<p><strong>Highest risks:</strong></p><ul>${topRisks.join('')}</ul>` : '<p>No threats are currently rated critical or high.</p>'}
${openWork.length
    ? `<div class="open"><strong>Open work in this model:</strong><ul>${openWork.map((w) => `<li>${e(w)}</li>`).join('')}</ul>This report reflects a model in progress; treat absent judgments as unknowns, not as safety.</div>`
    : '<div class="complete">Every candidate threat has been judged, every applying threat rated and given a treatment decision. This model is complete as of the generation date.</div>'}

<h2>System and trust boundaries</h2>
${reportSvg(data, profile, instances)}

<h2>Threat register</h2>
<table>
  <thead><tr><th>ID</th><th>Threat</th><th>Flow</th><th>Boundary</th><th>Status</th><th>Risk</th><th>Residual</th><th>Treatment</th><th>Owner</th></tr></thead>
  <tbody>${registerRows}</tbody>
</table>

${detailSections ? `<h2>Applying threats in detail</h2>${detailSections}` : ''}

${judged.length ? `<h2>Documented judgments</h2><ul>${judged.join('')}</ul>` : ''}

<h2>Methodology</h2>
<p>${e(data.meta.methodology)}</p>
<p>Sources: ${data.meta.sources.map((s) => `<a href="${e(s.url)}">${e(s.name)}</a>`).join(', ')}.</p>

<footer>
  Generated ${e(generatedAt)} by the <a href="https://www.cybersecurityalphabetsoup.com/tools/ai-threat-model/">AI Threat Modeler</a> at cybersecurityalphabetsoup.com.
  A threat model is a snapshot: re-run it on material change and at least annually.
</footer>
</body>
</html>
`;
}
