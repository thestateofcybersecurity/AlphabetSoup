import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import threatRaw from '../src/data/ai-threat-model.json';
import aiFrameworks from '../src/data/ai-frameworks.json';
import type { SystemProfile, ThreatModelData, ThreatVerdict } from '../src/lib/ai-threat';
import {
  boundaries,
  candidateThreats,
  diagramLayout,
  flowCandidates,
  importThreatDragon,
  linddunSummary,
  migrateVerdicts,
  registerCsv,
  riskFor,
  summarize,
  threatDragonModel,
  threatModelReport,
  threatPlan,
  validateThreatModel,
  zoneAt,
} from '../src/lib/ai-threat';
import type { SystemGraph } from '../src/lib/ai-threat';

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
    const candidates = flowCandidates(data, profile({ components: ['user-chat'] }));
    const [a, b, c] = candidates.map(({ key }) => key);
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
    const candidates = flowCandidates(data, profile({ components: ['user-chat'], name: 'Bot, "v2"' }));
    const csv = registerCsv(data, profile({ components: ['user-chat'], name: 'Bot, "v2"' }), candidates, {});
    const lines = csv.split('\n');
    expect(lines[0]).toBe('"Bot, ""v2"""');
    expect(lines).toHaveLength(candidates.length + 2);
    expect(lines[1]).toContain('trust boundary');
  });
});

describe('derived diagram', () => {
  it('renders nothing for an undescribed system', () => {
    expect(diagramLayout(data, profile(), [])).toBeNull();
  });

  it('places nodes only for selected components, with agreeing badges', () => {
    const p = profile({ components: ['user-chat', 'rag', 'agent-tools'] });
    const cands = flowCandidates(data, p);
    const layout = diagramLayout(data, p, cands)!;
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
    const cands = flowCandidates(data, tdProfile);
    const verdicts: Record<string, ThreatVerdict> = {
      'T01@user-chat': { status: 'applies', likelihood: 'likely', impact: 'severe', treatment: 'mitigate', owner: 'AppSec' },
      'T02@user-chat': { status: 'not-applicable', note: 'no secrets in prompts' },
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
    expect(threats.length).toBe(flowCandidates(data, tdProfile).length);
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
        'T01@user-chat': { status: 'applies', likelihood: 'likely', impact: 'severe', treatment: 'mitigate' },
        'T02@user-chat': { status: 'applies', likelihood: 'rare', impact: 'limited', treatment: 'mitigate' },
        'T05@user-chat': { status: 'applies', likelihood: 'likely', impact: 'severe', treatment: 'accept' },
        'T04@user-chat': { status: 'not-applicable' },
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
    const cands = flowCandidates(data, profile({ components: ['user-chat'] }));
    const [a, b] = cands.map(({ key }) => key);
    const verdicts: Record<string, ThreatVerdict> = {
      [a]: { status: 'applies', likelihood: 'likely', impact: 'severe', treatment: 'mitigate', residualLikelihood: 'rare', residualImpact: 'material' },
      [b]: { status: 'applies', likelihood: 'possible', impact: 'material', treatment: 'mitigate' },
    };
    const summary = summarize(data, cands, verdicts);
    expect(summary.byResidualRisk.low).toBe(1);
    expect(summary.mitigatedNoResidual).toBe(1);
  });
});

describe('canvas graph enumeration', () => {
  const twoStoreGraph: SystemGraph = {
    nodes: [
      { id: 'app', kind: 'process', label: 'Application', zone: 'app', x: 198, y: 90 },
      { id: 'kb1', kind: 'store', label: 'Public KB', zone: 'app', x: 198, y: 154 },
      { id: 'kb2', kind: 'store', label: 'Customer KB', zone: 'app', x: 198, y: 218 },
    ],
    flows: [
      { id: 'f1', from: 'kb1', to: 'app', kind: 'rag', label: 'Public KB retrieval', dataClass: 'public' },
      { id: 'f2', from: 'kb2', to: 'app', kind: 'rag', label: 'Customer KB retrieval', dataClass: 'regulated' },
      { id: 'f3', from: 'app', to: 'kb1', kind: 'plain', label: 'Cache write' },
    ],
  };

  it('enumerates per flow: two retrieval stores mean two sets of threats', () => {
    const p = profile({ components: [], graph: twoStoreGraph });
    const list = flowCandidates(data, p);
    const t07 = list.filter((i) => i.threat.id === 'T07');
    expect(t07).toHaveLength(2);
    expect(new Set(t07.map((i) => i.key))).toEqual(new Set(['T07@f1', 'T07@f2']));
  });

  it('gates on the per-flow data class, not just the system default', () => {
    const p = profile({ components: [], graph: twoStoreGraph, dataClass: 'public' });
    const list = flowCandidates(data, p);
    // T10 (vector store leakage) needs confidential data: only the regulated flow.
    const t10 = list.filter((i) => i.threat.id === 'T10');
    expect(t10.map((i) => i.flow.id)).toEqual(['f2']);
  });

  it('plain flows carry no threats', () => {
    const p = profile({ components: [], graph: twoStoreGraph });
    expect(flowCandidates(data, p).some((i) => i.flow.id === 'f3')).toBe(false);
  });

  it('lays out custom graphs at their stored positions', () => {
    const p = profile({ components: [], graph: twoStoreGraph });
    const layout = diagramLayout(data, p, flowCandidates(data, p))!;
    const kb2 = layout.nodes.find((n) => n.id === 'kb2')!;
    expect(kb2.y).toBe(218);
    expect(layout.flows).toHaveLength(3);
  });

  it('zoneAt maps x positions to the three columns', () => {
    expect(zoneAt(60)).toBe('users');
    expect(zoneAt(300)).toBe('app');
    expect(zoneAt(600)).toBe('outside');
  });
});

describe('verdict migration', () => {
  it('rewrites bare threat ids to instance keys and keeps judgments', () => {
    const p = profile({ components: ['user-chat'] });
    const migrated = migrateVerdicts(data, p, {
      T01: { status: 'applies', likelihood: 'likely', impact: 'severe' },
      'T02@user-chat': { status: 'not-applicable' },
    });
    expect(migrated['T01@user-chat']?.status).toBe('applies');
    expect(migrated['T02@user-chat']?.status).toBe('not-applicable');
    expect(migrated.T01).toBeUndefined();
  });

  it('leaves already-migrated verdicts untouched', () => {
    const verdicts = { 'T01@user-chat': { status: 'applies' as const } };
    expect(migrateVerdicts(data, profile({ components: ['user-chat'] }), verdicts)).toBe(verdicts);
  });
});

describe('HTML report export', () => {
  const reportFor = (verdicts: Record<string, ThreatVerdict>, name = 'Support bot <v2>') =>
    threatModelReport(
      data,
      profile({ components: ['user-chat', 'rag'], name, owner: 'Parker', reviewer: 'CISO' }),
      flowCandidates(data, profile({ components: ['user-chat', 'rag'] })),
      verdicts,
      'August 19, 2026',
    );

  it('is a standalone document with metadata, diagram, and full register', () => {
    const report = reportFor({});
    expect(report).toContain('<!DOCTYPE html>');
    expect(report).toContain('Support bot &lt;v2&gt;');
    expect(report).toContain('Parker');
    expect(report).toContain('CISO');
    expect(report).toContain('August 19, 2026');
    expect(report).toContain('<svg');
    // One register row per candidate instance.
    const rows = report.split('<tbody>')[1].split('</tbody>')[0].match(/<tr>/g) ?? [];
    expect(rows.length).toBe(flowCandidates(data, profile({ components: ['user-chat', 'rag'] })).length);
    // No external resources: self-contained means attachable anywhere.
    expect(report).not.toMatch(/src="http/);
    expect(report).not.toMatch(/<link/);
  });

  it('is honest about open work and surfaces top risks when rated', () => {
    const incomplete = reportFor({});
    expect(incomplete).toContain('Open work in this model');
    expect(incomplete).toContain('not yet judged');

    const rated = reportFor({
      'T01@user-chat': { status: 'applies', likelihood: 'likely', impact: 'severe', treatment: 'mitigate', owner: 'AppSec' },
    });
    expect(rated).toContain('Highest risks');
    expect(rated).toContain('Direct prompt injection');
    expect(rated).toContain('CRITICAL');
  });

  it('escapes user-controlled text everywhere it lands', () => {
    const hostile = reportFor(
      { 'T01@user-chat': { status: 'not-applicable', note: '<img src=x onerror=alert(1)>' } },
      '<script>bad</script>',
    );
    expect(hostile).not.toContain('<script>bad');
    expect(hostile).not.toContain('<img src=x');
    expect(hostile).toContain('&lt;script&gt;bad');
  });
});

describe('LINDDUN privacy lens', () => {
  it('annotates privacy threats with valid categories only', () => {
    const annotated = data.threats.filter((t) => (t.linddun ?? []).length > 0);
    expect(annotated.length).toBeGreaterThanOrEqual(10);
    // The three privacy-specific threats exist and carry the lens.
    for (const id of ['T26', 'T27', 'T28']) {
      const threat = data.threats.find((t) => t.id === id);
      expect(threat, id).toBeTruthy();
      expect(threat!.linddun!.length, id).toBeGreaterThan(0);
    }
  });

  it('summarizes applying threats per category, omitting empty ones', () => {
    const p = profile({ components: ['user-chat'], dataClass: 'confidential' });
    const list = flowCandidates(data, p);
    const t26 = list.find((i) => i.threat.id === 'T26')!;
    const summary = linddunSummary(list, { [t26.key]: { status: 'applies' } });
    const categories = summary.map((s) => s.category);
    expect(categories).toContain('Linkability');
    expect(categories).toContain('Identifiability');
    expect(categories).not.toContain('Detectability');
    expect(linddunSummary(list, {})).toEqual([]);
  });
});

describe('Threat Dragon import', () => {
  const fixture = JSON.parse(readFileSync(new URL('../e2e/fixtures/td-sample.json', import.meta.url), 'utf8')) as unknown;

  it('rejects files that are not Threat Dragon models', () => {
    expect(() => importThreatDragon({ hello: 'world' })).toThrow(/does not look like/);
    expect(() => importThreatDragon({ summary: {}, detail: { diagrams: [{ cells: [] }] } })).toThrow(/no elements/);
  });

  it('imports topology, metadata, and preserved threats', () => {
    const imported = importThreatDragon(fixture);
    expect(imported.name).toBe('Imported Support Bot');
    expect(imported.owner).toBe('Jordan');
    expect(imported.reviewer).toBe('Riley');
    // isPublicNetwork on a flow raises the exposure inference.
    expect(imported.exposure).toBe('public');
    expect(imported.graph!.nodes.map((n) => n.id).sort()).toEqual(['cell-db', 'cell-user', 'cell-web']);
    expect(imported.graph!.flows).toHaveLength(2);
    // Question-first survives import: flows arrive unclassified.
    expect(imported.graph!.flows.every((f) => f.kind === 'plain')).toBe(true);
    expect(flowCandidates(data, imported)).toEqual([]);
    // Leftmost node lands in the users zone, the rest in later zones.
    expect(imported.graph!.nodes.find((n) => n.id === 'cell-user')!.zone).toBe('users');
    // Both existing threats preserved with their cells named.
    expect(imported.imported).toHaveLength(2);
    expect(imported.imported![0].cellName).toBe('Chat backend');
  });

  it('round-trips imported threats through the Threat Dragon export', () => {
    const imported = importThreatDragon(fixture);
    // Classify one flow so our library enumerates alongside the carried threats.
    imported.graph!.flows[0].kind = 'user-chat';
    const list = flowCandidates(data, imported);
    expect(list.length).toBeGreaterThan(0);
    let n = 0;
    const model = threatDragonModel(data, imported, list, {}, () => `id-${n++}`) as {
      detail: { diagrams: { cells: { data?: { threats?: { title: string }[] } }[] }[] };
    };
    const titles = model.detail.diagrams[0].cells.flatMap((c) => c.data?.threats ?? []).map((t) => t.title);
    expect(titles).toContain('Session fixation on chat tokens');
    expect(titles).toContain('Downgrade to plain HTTP');
    expect(titles.some((t) => t.includes('T01'))).toBe(true);
  });
});
