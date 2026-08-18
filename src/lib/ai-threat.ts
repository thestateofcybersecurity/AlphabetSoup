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
  candidates: CandidateThreat[],
  verdicts: Record<string, ThreatVerdict>,
): ModelSummary {
  const summary: ModelSummary = {
    total: candidates.length,
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
  for (const { threat } of candidates) {
    const verdict = verdicts[threat.id] ?? { status: 'unreviewed' };
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
  candidates: CandidateThreat[],
  verdicts: Record<string, ThreatVerdict>,
): string {
  const escapeCell = (value: string): string => `"${value.replace(/"/g, '""')}"`;
  const rows = [
    ['id', 'threat', 'stride', 'trust boundary', 'status', 'likelihood', 'impact', 'risk', 'treatment', 'owner', 'note', 'references'],
    ...candidates.map(({ threat, boundary }) => {
      const v = verdicts[threat.id] ?? { status: 'unreviewed' };
      return [
        threat.id,
        threat.title,
        threat.stride,
        boundary,
        v.status,
        v.likelihood ?? '',
        v.impact ?? '',
        riskFor(data, v.likelihood, v.impact) ?? '',
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

/**
 * A deterministic three-zone data flow diagram for the described system.
 * Nodes exist only for selected components; flows carry the count of candidate
 * threats proposed where they run, so the picture and the threat list agree.
 */
export function diagramLayout(
  profile: SystemProfile,
  candidates: CandidateThreat[],
): DiagramLayout | null {
  const has = (id: string) => profile.components.includes(id);
  if (profile.components.length === 0) return null;

  const counts: Record<string, number> = {};
  for (const c of candidates) counts[c.componentId] = (counts[c.componentId] ?? 0) + 1;

  const zoneDefs = [
    { id: 'users', label: 'Untrusted users', x: 16, w: 140 },
    { id: 'app', label: 'Your application', x: 186, w: 290 },
    { id: 'outside', label: 'Outside your control', x: 506, w: 158 },
  ];

  const nodes: DiagramNode[] = [];
  const place = (zone: string, id: string, label: string, sub: string, kind: DiagramNode['kind']) => {
    const def = zoneDefs.find((z) => z.id === zone)!;
    const index = nodes.filter((n) => n.zone === zone).length;
    nodes.push({
      id, label, sub, kind, zone,
      x: def.x + 12, y: ZONE_TOP + 26 + index * NODE_GAP, w: def.w - 24, h: NODE_H,
    });
  };

  if (has('user-chat')) place('users', 'users', 'Users', 'free-text input', 'actor');
  place('app', 'app', 'Application', 'orchestration and prompts', 'process');
  if (has('rag')) place('app', 'index', 'Vector index', 'your documents', 'store');
  if (has('self-hosted')) place('app', 'model', 'Self-hosted model', 'weights you run', 'process');
  if (has('training-data')) place('app', 'training', 'Training data', 'shapes the weights', 'store');
  if (has('batch')) place('app', 'pipeline', 'Batch pipeline', 'unattended runs', 'process');
  if (has('output-decisions')) place('app', 'consumer', 'Decision consumer', 'people and systems', 'process');
  if (has('vendor-llm')) place('outside', 'provider', 'Model provider', 'vendor API', 'process');
  if (has('agent-tools')) place('outside', 'tools', 'Tools and APIs', 'the agent acts here', 'process');
  if (has('batch')) place('outside', 'feeds', 'Data feeds', 'upstream sources', 'actor');

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const flows: DiagramFlow[] = [];
  const connect = (componentId: string, fromId: string, toId: string) => {
    const from = byId[fromId];
    const to = byId[toId];
    if (!from || !to) return;
    const leftToRight = from.x < to.x;
    const sameColumn = from.zone === to.zone;
    const x1 = sameColumn ? from.x + from.w / 2 : leftToRight ? from.x + from.w : from.x;
    const x2 = sameColumn ? to.x + to.w / 2 : leftToRight ? to.x : to.x + to.w;
    const y1 = sameColumn ? (from.y < to.y ? from.y + from.h : from.y) : from.y + from.h / 2;
    const y2 = sameColumn ? (from.y < to.y ? to.y : to.y + to.h) : to.y + to.h / 2;
    flows.push({
      id: `flow-${componentId}`, from: fromId, to: toId, componentId,
      badge: counts[componentId] ?? 0, x1, y1, x2, y2,
    });
  };

  connect('user-chat', 'users', 'app');
  connect('rag', 'index', 'app');
  connect('vendor-llm', 'app', 'provider');
  connect('self-hosted', 'app', 'model');
  connect('training-data', 'training', has('self-hosted') ? 'model' : 'app');
  connect('agent-tools', 'app', 'tools');
  connect('batch', 'feeds', 'pipeline');
  connect('output-decisions', 'app', 'consumer');

  const zones: DiagramZone[] = zoneDefs
    .filter((def) => nodes.some((n) => n.zone === def.id))
    .map((def) => {
      const members = nodes.filter((n) => n.zone === def.id);
      const bottom = Math.max(...members.map((n) => n.y + n.h));
      return { id: def.id, label: def.label, x: def.x, y: ZONE_TOP, w: def.w, h: bottom - ZONE_TOP + 16 };
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
  candidates: CandidateThreat[],
  verdicts: Record<string, ThreatVerdict>,
  id: () => string,
): object {
  const layout = diagramLayout(profile, candidates);
  if (!layout) throw new Error('Describe the system before exporting');

  const cellIds = new Map<string, string>();
  for (const node of layout.nodes) cellIds.set(node.id, id());

  let number = 0;
  const threatsFor = (componentId: string) =>
    candidates
      .filter((c) => c.componentId === componentId)
      .map(({ threat, because }) => {
        const v = verdicts[threat.id] ?? { status: 'unreviewed' as const };
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

  const flowCells = layout.flows.map((flow) => {
    const componentLabel = data.components.find((c) => c.id === flow.componentId)?.label ?? flow.componentId;
    const threats = threatsFor(flow.componentId);
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
    for (const [threatId, verdict] of Object.entries(model.verdicts)) {
      if (verdict.status !== 'applies' || verdict.treatment !== 'mitigate') continue;
      const threat = byId[threatId];
      if (!threat) continue;
      const risk = riskFor(data, verdict.likelihood, verdict.impact);
      tasks.push({
        id: `threat:${system.toLowerCase().replace(/[^a-z0-9]+/g, '-')}:${threatId}`,
        label: `Mitigate ${threatId}: ${threat.title}`,
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
