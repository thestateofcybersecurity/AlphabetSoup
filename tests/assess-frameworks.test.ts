import { describe, expect, it } from 'vitest';
import cisRaw from '../src/data/cis.json';
import igsRaw from '../src/data/cis-igs.json';
import csfRaw from '../src/data/nist-csf.json';
import {
  cisControlsAssessment,
  cisIg1Assessment,
  csfAssessment,
  scoreAssessment,
} from '../src/lib/assessment';
import { gapsPlan } from '../src/lib/roadmap';
import type { Answers } from '../src/lib/assessment';
import type { CisData, CsfData } from '../src/lib/frameworks';

const cis = cisRaw as CisData;
const igs = igsRaw as Record<string, number>;
const csf = csfRaw as CsfData;

const allYes = (ids: string[]): Answers => Object.fromEntries(ids.map((id) => [id, 'yes' as const]));

describe('NIST CSF 2.0 generated assessment', () => {
  const data = csfAssessment(csf);

  it('covers every subcategory exactly once', () => {
    expect(data.questions).toHaveLength(Object.keys(csf).length);
    expect(data.questions).toHaveLength(106);
    const ids = data.questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('groups by the six functions in canonical order', () => {
    expect(data.categories.map((c) => c.id)).toEqual(['GV', 'ID', 'PR', 'DE', 'RS', 'RC']);
  });

  it('is single-tier and references a resolvable CSF subcategory', () => {
    expect(new Set(data.questions.map((q) => q.tier))).toEqual(new Set(['basic']));
    for (const q of data.questions) {
      expect(q.group).toBe(csf[q.id].functionCode);
      expect(q.references[0]).toBe(`NIST CSF ${q.id}`);
      expect(q.text).toContain(csf[q.id].text);
    }
  });

  it('scores 100% when every outcome is achieved', () => {
    const result = scoreAssessment(data, allYes(data.questions.map((q) => q.id)));
    expect(result.overallPercent).toBe(100);
    expect(result.groups).toHaveLength(6);
  });

  it('feeds the roadmap: unmet outcomes become tasks with framework links', () => {
    const answers: Answers = { ...allYes(data.questions.map((q) => q.id)) };
    const target = data.questions[0].id;
    answers[target] = 'no';
    const tasks = gapsPlan(data, answers);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].link).toContain('frameworks/nist-csf/');
  });
});

describe('CIS Controls v8 generated assessment', () => {
  const data = cisControlsAssessment(cis, igs);

  it('covers all 153 safeguards across 18 controls', () => {
    expect(data.questions).toHaveLength(153);
    expect(data.categories).toHaveLength(18);
  });

  it('maps each safeguard Implementation Group to a maturity tier', () => {
    for (const q of data.questions) {
      const expected = igs[q.id] === 1 ? 'basic' : igs[q.id] === 2 ? 'intermediate' : 'advanced';
      expect(q.tier).toBe(expected);
    }
    const counts = { basic: 0, intermediate: 0, advanced: 0 } as Record<string, number>;
    for (const q of data.questions) counts[q.tier] += 1;
    expect(counts).toEqual({ basic: 56, intermediate: 74, advanced: 23 });
  });

  it('bounds by maxIg cumulatively, and IG1 matches the essentials module', () => {
    expect(cisControlsAssessment(cis, igs, 1).questions).toHaveLength(56);
    expect(cisControlsAssessment(cis, igs, 2).questions).toHaveLength(130);
    const ig1 = cisIg1Assessment(cis, igs);
    expect(ig1.questions.map((q) => q.id)).toEqual(
      cisControlsAssessment(cis, igs, 1).questions.map((q) => q.id),
    );
    expect(new Set(ig1.questions.map((q) => q.tier))).toEqual(new Set(['basic']));
  });

  it('tier attainment reads as IG progress when IG1 is fully met', () => {
    const ig1Ids = data.questions.filter((q) => q.tier === 'basic').map((q) => q.id);
    const result = scoreAssessment(data, allYes(ig1Ids));
    expect(result.tierAttained.basic).toBe(true);
    expect(result.tierAttained.intermediate).toBe(false);
    expect(result.attainedTier).toBe('basic');
  });
});
