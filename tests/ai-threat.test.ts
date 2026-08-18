import { describe, expect, it } from 'vitest';
import threatRaw from '../src/data/ai-threat-model.json';
import aiFrameworks from '../src/data/ai-frameworks.json';
import type { SystemProfile, ThreatModelData, ThreatVerdict } from '../src/lib/ai-threat';
import {
  boundaries,
  candidateThreats,
  registerCsv,
  riskFor,
  summarize,
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
