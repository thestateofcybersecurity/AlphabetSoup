import { describe, expect, it } from 'vitest';
import cmmcRaw from '../src/data/assessment-800171.json';
import ceRaw from '../src/data/assessment-cyber-essentials.json';
import { scoreAssessment, TIER_ORDER } from '../src/lib/assessment';
import type { AssessmentData, Answers } from '../src/lib/assessment';

const cmmc = cmmcRaw as AssessmentData;
const ce = ceRaw as AssessmentData;

const allYes = (data: AssessmentData): Answers =>
  Object.fromEntries(data.questions.map((q) => [q.id, 'yes' as const]));

/** The 17 CMMC Level 1 controls; the rest are Level 2. */
const CMMC_L1 = new Set([
  '3.1.1', '3.1.2', '3.1.20', '3.1.22', '3.5.1', '3.5.2', '3.8.3',
  '3.10.1', '3.10.3', '3.10.4', '3.10.5', '3.13.1', '3.13.5',
  '3.14.1', '3.14.2', '3.14.4', '3.14.5',
]);
const FAMILY_COUNTS: Record<string, number> = {
  AC: 22, AT: 3, AU: 9, CM: 9, IA: 11, IR: 3, MA: 6,
  MP: 9, PS: 2, PE: 6, RA: 3, CA: 4, SC: 16, SI: 7,
};

describe('NIST 800-171 / CMMC assessment', () => {
  it('has all 110 requirements across 14 families', () => {
    expect(cmmc.questions).toHaveLength(110);
    expect(cmmc.categories).toHaveLength(14);
    const ids = cmmc.questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(110);
    const per: Record<string, number> = {};
    for (const q of cmmc.questions) per[q.group] = (per[q.group] ?? 0) + 1;
    expect(per).toEqual(FAMILY_COUNTS);
  });

  it('tiers the 17 CMMC Level 1 controls as basic and the rest as intermediate', () => {
    for (const q of cmmc.questions) {
      expect(q.tier).toBe(CMMC_L1.has(q.id) ? 'basic' : 'intermediate');
    }
    expect(cmmc.questions.filter((q) => q.tier === 'basic')).toHaveLength(17);
    // No advanced tier exists in 800-171.
    expect(cmmc.questions.some((q) => q.tier === 'advanced')).toBe(false);
  });

  it('references NIST 800-171 and CMMC on every requirement', () => {
    for (const q of cmmc.questions) {
      expect(q.references[0]).toMatch(/^NIST SP 800-171 3\.\d{1,2}\.\d{1,2}$/);
      expect(q.references.some((r) => r.startsWith('CMMC '))).toBe(true);
      expect(q.why?.trim()).toBeTruthy();
      expect(q.fix?.trim()).toBeTruthy();
    }
  });

  it('scores 100% when every requirement is met', () => {
    expect(scoreAssessment(cmmc, allYes(cmmc)).overallPercent).toBe(100);
  });

  it('reports CMMC progress by tier without inventing an advanced tier', () => {
    // Meet only the Level 1 (basic) controls.
    const l1 = cmmc.questions.filter((q) => q.tier === 'basic').map((q) => q.id);
    const partial = scoreAssessment(cmmc, Object.fromEntries(l1.map((id) => [id, 'yes' as const])));
    expect(partial.tierAttained.basic).toBe(true);
    expect(partial.tierAttained.intermediate).toBe(false);
    // The empty advanced tier must never read as attained.
    expect(partial.tierAttained.advanced).toBe(false);
    expect(partial.attainedTier).toBe('basic');

    // Meet everything: highest attained tier is intermediate (Level 2), not advanced.
    const full = scoreAssessment(cmmc, allYes(cmmc));
    expect(full.attainedTier).toBe('intermediate');
    expect(full.tierAttained.advanced).toBe(false);
  });
});

describe('CISA Cyber Essentials assessment', () => {
  it('covers the six elements as a single-tier starter set', () => {
    expect(ce.categories).toHaveLength(6);
    expect(ce.categories.map((c) => c.id)).toEqual([
      'LEADER', 'STAFF', 'SYSTEMS', 'SURROUNDINGS', 'DATA', 'RESPONSE',
    ]);
    expect(ce.questions.length).toBeGreaterThanOrEqual(40);
    expect(new Set(ce.questions.map((q) => q.tier))).toEqual(new Set(['basic']));
    const ids = ce.questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is single-tier, so no maturity tier reads as attained beyond basic', () => {
    const result = scoreAssessment(ce, allYes(ce));
    expect(result.overallPercent).toBe(100);
    expect(result.attainedTier).toBe('basic');
    for (const tier of TIER_ORDER.filter((t) => t !== 'basic')) {
      expect(result.tierAttained[tier]).toBe(false);
    }
  });
});
