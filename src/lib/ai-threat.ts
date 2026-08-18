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
      return { threat, boundary: byId[trigger].boundary, because: threat.because };
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
