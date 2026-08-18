import { describe, expect, it } from 'vitest';
import threatRaw from '../src/data/ai-threat-model.json';
import aiFrameworks from '../src/data/ai-frameworks.json';
import type { SystemProfile, ThreatModelData, ThreatVerdict } from '../src/lib/ai-threat';
import {
  boundaries,
  candidateThreats,
  diagramLayout,
  registerCsv,
  riskFor,
  summarize,
  threatDragonModel,
  threatPlan,
  validateThreatModel,
} from '../src/lib/ai-threat';

const data = threatRaw as ThreatModelData;

const profile = (over: Partial<SystemProfile> = {}): SystemProfile => ({
  name: 'Test system',
  components: [],
  exposure: 'internal',
  dataClass: 'internal',
  ...over,
});

describe('ai threat model dataset', () => {
  it('passes structural validation', () => {
    expect(validateThreatModel(data)).toEqual([]);
  });

  it('references only codes that exist in the AI frameworks dataset', () => {
    const known = new Set((aiFrameworks as { code: string }[]).map((entry) => entry.code));
    for (const threat of data.threats) {
      for (const ref of [...threat.refs, ...threat.mitigations.flatMap((m) => m.refs)]) {
        expect(known, `unknown code "${ref}" in ${threat.id}`).toContain(ref);
      }
    }
  });

  it('covers every STRIDE category across the library', () => {
    const seen = new Set(data.threats.map((t) => t.stride));
    for (const category of [
      'Spoofing', 'Tampering', 'Repudiation', 'Information disclosure', 'Denial of service', 'Elevation of privilege',
    ]) {
      expect(seen, category).toContain(category);
    }
  });
});

describe('question-first behavior', () => {
  it('proposes nothing until the system is described', () => {
    expect(candidateThreats(data, profile())).toEqual([]);
    expect(boundaries(data, profile())).toEqual([]);
  });

  it('only proposes threats for elements the system actually has', () => {
    const chatOnly = candidateThreats(data, profile({ components: ['user-chat'] }));
    expect(chatOnly.length).toBeGreaterThan(0);
    for (const { threat } of chatOnly) {
      expect(threat.appliesWhen.components, threat.id).toContain('user-chat');
    }
    // No RAG in the system means no retrieval threats proposed.
    expect(chatOnly.some(({ threat }) => threat.id === 'T07')).toBe(false);
  });

  it('every candidate carries the reason it was proposed', () => {
    for (const candidate of candidateThreats(data, profile({ components: ['rag', 'agent-tools'] }))) {
      expect(candidate.because.length, candidate.threat.id).toBeGreaterThan(20);
      expect(candidate.boundary.length, candidate.threat.id).toBeGreaterThan(5);
    }
  });

  it('gates data-sensitive threats on the declared data class', () => {
    const publicData = candidateThreats(data, profile({ components: ['rag'], dataClass: 'public' }));
    const regulated = candidateThreats(data, profile({ components: ['rag'], dataClass: 'regulated' }));
    expect(publicData.some(({ threat }) => threat.id === 'T10')).toBe(false);
    expect(regulated.some(({ threat }) => threat.id === 'T10')).toBe(true);
  });

  it('gates exposure-dependent threats on the declared audience', () => {
    const internal = candidateThreats(data, profile({ components: ['user-chat'] }));
    const publicFacing = candidateThreats(data, profile({ components: ['user-chat'], exposure: 'public' }));
    expect(internal.some(({ threat }) => threat.id === 'T06')).toBe(false);
    expect(publicFacing.some(({ threat }) => threat.id === 'T06')).toBe(true);
  });
});

describe('rating and summary', () => {
  it('computes risk only when both anchors are chosen', () => {
    expect(riskFor(data)).toBeNull();
    expect(riskFor(data, 'likely')).toBeNull();
    expect(riskFor(data, 'likely', 'severe')).toBe('critical');
    expect(riskFor(data, 'rare', 'limited')).toBe('low');
  });

  it('summarizes verdicts and flags incomplete work', () => {
    const candidates = candidateThreats(data, profile({ components: ['user-chat'] }));
    const [a, b, c] = candidates.map(({ threat }) => threat.id);
    const verdicts: Record<string, ThreatVerdict> = {
      [a]: { status: 'applies', likelihood: 'likely', impact: 'material', treatment: 'mitigate', owner: 'AppSec' },
      [b]: { status: 'applies' },
      [c]: { status: 'not-applicable', note: 'input is structured, not free text' },
    };
    const summary = summarize(data, candidates, verdicts);
    expect(summary.total).toBe(candidates.length);
    expect(summary.reviewed).toBe(3);
    expect(summary.applies).toBe(2);
    expect(summary.byRisk.high).toBe(1);
    expect(summary.unrated).toBe(1);
    expect(summary.untreated).toBe(1);
  });

  it('exports a register row per candidate with quoting intact', () => {
    const candidates = candidateThreats(data, profile({ components: ['user-chat'], name: 'Bot, "v2"' }));
    const csv = registerCsv(data, profile({ components: ['user-chat'], name: 'Bot, "v2"' }), candidates, {});
    const lines = csv.split('\n');
    expect(lines[0]).toBe('"Bot, ""v2"""');
    expect(lines).toHaveLength(candidates.length + 2);
    expect(lines[1]).toContain('trust boundary');
  });
});

describe('derived diagram', () => {
  it('renders nothing for an undescribed system', () => {
    expect(diagramLayout(profile(), [])).toBeNull();
  });

  it('places nodes only for selected components, with agreeing badges', () => {
    const p = profile({ components: ['user-chat', 'rag', 'agent-tools'] });
    const cands = candidateThreats(data, p);
    const layout = diagramLayout(p, cands)!;
    const nodeIds = layout.nodes.map((n) => n.id);
    expect(nodeIds).toContain('users');
    expect(nodeIds).toContain('index');
    expect(nodeIds).toContain('tools');
    expect(nodeIds).not.toContain('provider');
    // Badge totals equal the candidate count: the picture and the list agree.
    const badgeTotal = layout.flows.reduce((sum, f) => sum + f.badge, 0);
    expect(badgeTotal).toBe(cands.length);
    // Every flow connects nodes that exist.
    for (const flow of layout.flows) {
      expect(nodeIds).toContain(flow.from);
      expect(nodeIds).toContain(flow.to);
    }
  });
});

describe('Threat Dragon export', () => {
  const tdProfile = profile({ components: ['user-chat', 'vendor-llm'], name: 'Support bot', owner: 'Parker', reviewer: 'CISO' });

  const exportModel = () => {
    let n = 0;
    const cands = candidateThreats(data, tdProfile);
    const verdicts: Record<string, ThreatVerdict> = {
      T01: { status: 'applies', likelihood: 'likely', impact: 'severe', treatment: 'mitigate', owner: 'AppSec' },
      T02: { status: 'not-applicable', note: 'no secrets in prompts' },
    };
    return threatDragonModel(data, tdProfile, cands, verdicts, () => `id-${n++}`) as {
      version: string;
      summary: { title: string; owner: string };
      detail: { reviewer: string; threatTop: number; diagrams: { diagramType: string; cells: { shape: string; source?: { cell: string }; target?: { cell: string }; id: string; data?: { threats?: { status: string; severity: string; type: string }[] } }[] }[] };
    };
  };

  it('produces a valid v2 envelope with metadata carried over', () => {
    const model = exportModel();
    expect(model.version).toBe('2.3.0');
    expect(model.summary.title).toBe('Support bot');
    expect(model.summary.owner).toBe('Parker');
    expect(model.detail.reviewer).toBe('CISO');
    expect(model.detail.diagrams[0].diagramType).toBe('STRIDE');
  });

  it('attaches every candidate threat to a flow with valid statuses', () => {
    const model = exportModel();
    const cells = model.detail.diagrams[0].cells;
    const threats = cells.flatMap((c) => c.data?.threats ?? []);
    expect(threats.length).toBe(candidateThreats(data, tdProfile).length);
    expect(model.detail.threatTop).toBe(threats.length);
    for (const threat of threats) {
      expect(['Open', 'Mitigated', 'NotApplicable']).toContain(threat.status);
      expect(['', 'Low', 'Medium', 'High']).toContain(threat.severity);
    }
    // Flow endpoints reference real node cells.
    const nodeIds = new Set(cells.filter((c) => c.shape !== 'flow' && c.shape !== 'trust-boundary-box').map((c) => c.id));
    for (const flow of cells.filter((c) => c.shape === 'flow')) {
      expect(nodeIds).toContain(flow.source!.cell);
      expect(nodeIds).toContain(flow.target!.cell);
    }
  });
});

describe('roadmap handoff and residual risk', () => {
  it('creates tasks only for mitigate decisions, quartered by risk', () => {
    const models = [{
      profile: profile({ components: ['user-chat'], name: 'Bot A' }),
      verdicts: {
        T01: { status: 'applies', likelihood: 'likely', impact: 'severe', treatment: 'mitigate' },
        T02: { status: 'applies', likelihood: 'rare', impact: 'limited', treatment: 'mitigate' },
        T05: { status: 'applies', likelihood: 'likely', impact: 'severe', treatment: 'accept' },
        T04: { status: 'not-applicable' },
      } as Record<string, ThreatVerdict>,
    }];
    const tasks = threatPlan(data, models);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].defaultQuarter).toBe('Q1');
    expect(tasks[0].label).toContain('T01');
    expect(tasks[1].defaultQuarter).toBe('Q3');
    expect(tasks.every((t) => t.group === 'Bot A')).toBe(true);
  });

  it('summarizes residual risk and flags unrated mitigations', () => {
    const cands = candidateThreats(data, profile({ components: ['user-chat'] }));
    const [a, b] = cands.map(({ threat }) => threat.id);
    const verdicts: Record<string, ThreatVerdict> = {
      [a]: { status: 'applies', likelihood: 'likely', impact: 'severe', treatment: 'mitigate', residualLikelihood: 'rare', residualImpact: 'material' },
      [b]: { status: 'applies', likelihood: 'possible', impact: 'material', treatment: 'mitigate' },
    };
    const summary = summarize(data, cands, verdicts);
    expect(summary.byResidualRisk.low).toBe(1);
    expect(summary.mitigatedNoResidual).toBe(1);
  });
});
