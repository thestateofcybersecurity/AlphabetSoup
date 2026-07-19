import { describe, expect, it } from 'vitest';
import cmmcRaw from '../src/data/assessment-800171.json';
import ceRaw from '../src/data/assessment-cyber-essentials.json';
import ztmmRaw from '../src/data/assessment-ztmm.json';
import ssdfRaw from '../src/data/assessment-ssdf.json';
import pciRaw from '../src/data/assessment-pci-dss.json';
import { scoreAssessment, TIER_ORDER } from '../src/lib/assessment';
import type { AssessmentData, Answers } from '../src/lib/assessment';

const cmmc = cmmcRaw as AssessmentData;
const ce = ceRaw as AssessmentData;
const ztmm = ztmmRaw as AssessmentData;
const ssdf = ssdfRaw as AssessmentData;
const pci = pciRaw as AssessmentData;

const allYes = (data: AssessmentData): Answers =>
  Object.fromEntries(data.questions.map((q) => [q.id, 'yes' as const]));
const yesFor = (ids: string[]): Answers => Object.fromEntries(ids.map((id) => [id, 'yes' as const]));
const idsWhere = (data: AssessmentData, tier: string): string[] =>
  data.questions.filter((q) => q.tier === tier).map((q) => q.id);

/** The 17 CMMC Level 1 controls; Level 2 adds the rest of 800-171; Level 3 adds the 800-172 enhancements. */
const CMMC_L1 = new Set([
  '3.1.1', '3.1.2', '3.1.20', '3.1.22', '3.5.1', '3.5.2', '3.8.3',
  '3.10.1', '3.10.3', '3.10.4', '3.10.5', '3.13.1', '3.13.5',
  '3.14.1', '3.14.2', '3.14.4', '3.14.5',
]);
const BASE_FAMILY_COUNTS: Record<string, number> = {
  AC: 22, AT: 3, AU: 9, CM: 9, IA: 11, IR: 3, MA: 6,
  MP: 9, PS: 2, PE: 6, RA: 3, CA: 4, SC: 16, SI: 7,
};

describe('NIST 800-171 / CMMC assessment', () => {
  it('spans the full L1/L2/L3 ladder: 110 base requirements plus 24 Level 3 enhancements', () => {
    expect(cmmc.questions).toHaveLength(134);
    expect(cmmc.categories).toHaveLength(14);
    expect(new Set(cmmc.questions.map((q) => q.id)).size).toBe(134);

    const base = cmmc.questions.filter((q) => q.tier !== 'advanced');
    const per: Record<string, number> = {};
    for (const q of base) per[q.group] = (per[q.group] ?? 0) + 1;
    expect(per).toEqual(BASE_FAMILY_COUNTS);
  });

  it('tiers by CMMC level: 17 Level 1 basic, 93 Level 2 intermediate, 24 Level 3 advanced', () => {
    const byTier: Record<string, number> = { basic: 0, intermediate: 0, advanced: 0 };
    for (const q of cmmc.questions) byTier[q.tier] += 1;
    expect(byTier).toEqual({ basic: 17, intermediate: 93, advanced: 24 });

    for (const q of cmmc.questions.filter((x) => x.tier !== 'advanced')) {
      expect(q.tier).toBe(CMMC_L1.has(q.id) ? 'basic' : 'intermediate');
    }
    // Level 3 enhancements come from 800-172 and carry the "e" suffix.
    for (const q of cmmc.questions.filter((x) => x.tier === 'advanced')) {
      expect(q.id).toMatch(/e$/);
      expect(q.references[0]).toMatch(/^NIST SP 800-172 /);
      expect(q.references.some((r) => r.startsWith('CMMC L3'))).toBe(true);
    }
  });

  it('references and guidance are present on every requirement', () => {
    for (const q of cmmc.questions) {
      expect(q.references[0]).toMatch(/^NIST SP 800-17[12] /);
      expect(q.references.some((r) => r.startsWith('CMMC '))).toBe(true);
      expect(q.why?.trim()).toBeTruthy();
      expect(q.fix?.trim()).toBeTruthy();
    }
  });

  it('cumulative tier attainment tracks CMMC level', () => {
    const l1 = scoreAssessment(cmmc, yesFor(idsWhere(cmmc, 'basic')));
    expect(l1.attainedTier).toBe('basic');
    expect(l1.tierAttained.intermediate).toBe(false);

    const l2 = scoreAssessment(cmmc, yesFor([...idsWhere(cmmc, 'basic'), ...idsWhere(cmmc, 'intermediate')]));
    expect(l2.attainedTier).toBe('intermediate');
    expect(l2.tierAttained.advanced).toBe(false);

    const l3 = scoreAssessment(cmmc, allYes(cmmc));
    expect(l3.overallPercent).toBe(100);
    expect(l3.attainedTier).toBe('advanced');
  });
});

describe('empty-tier attainment guard (regression)', () => {
  // A two-tier module must never report the empty top tier as attained.
  const twoTier: AssessmentData = {
    categories: [{ id: 'G', name: 'Group' }],
    questions: [
      { id: 'b1', text: 'q', tier: 'basic', group: 'G', references: [] },
      { id: 'i1', text: 'q', tier: 'intermediate', group: 'G', references: [] },
    ],
  };
  it('does not treat an absent advanced tier as reached', () => {
    const result = scoreAssessment(twoTier, { b1: 'yes', i1: 'yes' });
    expect(result.attainedTier).toBe('intermediate');
    expect(result.tierAttained.advanced).toBe(false);
  });
});

describe('CISA Cyber Essentials assessment', () => {
  it('covers the six elements as a single-tier starter set', () => {
    expect(ce.categories.map((c) => c.id)).toEqual([
      'LEADER', 'STAFF', 'SYSTEMS', 'SURROUNDINGS', 'DATA', 'RESPONSE',
    ]);
    expect(ce.questions.length).toBeGreaterThanOrEqual(40);
    expect(new Set(ce.questions.map((q) => q.tier))).toEqual(new Set(['basic']));
    expect(new Set(ce.questions.map((q) => q.id)).size).toBe(ce.questions.length);
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

describe('CISA Zero Trust Maturity Model assessment', () => {
  it('spans the five pillars and three cross-cutting capabilities', () => {
    expect(ztmm.categories.map((c) => c.id)).toEqual([
      'IDENTITY', 'DEVICES', 'NETWORKS', 'APPS', 'DATA', 'VISIBILITY', 'AUTOMATION', 'GOVERNANCE',
    ]);
    expect(ztmm.questions.length).toBeGreaterThanOrEqual(48);
    expect(new Set(ztmm.questions.map((q) => q.id)).size).toBe(ztmm.questions.length);
    for (const q of ztmm.questions) expect(q.group).toBe(q.id.split('-')[1]);
  });

  it('uses all three maturity-stage tiers and attains Optimal only when fully met', () => {
    expect(new Set(ztmm.questions.map((q) => q.tier))).toEqual(new Set(['basic', 'intermediate', 'advanced']));
    const result = scoreAssessment(ztmm, allYes(ztmm));
    expect(result.overallPercent).toBe(100);
    expect(result.attainedTier).toBe('advanced');
  });
});

describe('NIST SSDF assessment', () => {
  it('has 42 single-tier tasks across the four SSDF groups', () => {
    expect(ssdf.categories.map((c) => c.id)).toEqual(['PO', 'PS', 'PW', 'RV']);
    expect(ssdf.questions).toHaveLength(42);
    expect(new Set(ssdf.questions.map((q) => q.tier))).toEqual(new Set(['basic']));
    for (const q of ssdf.questions) {
      expect(q.group).toBe(q.id.split('.')[0]);
      expect(q.references[0]).toMatch(/^NIST SSDF /);
    }
  });
});

describe('PCI DSS assessment', () => {
  it('covers the 12 requirements as an original-worded single-tier set', () => {
    expect(pci.categories.map((c) => c.id)).toEqual(
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
    );
    expect(pci.questions.length).toBeGreaterThanOrEqual(40);
    expect(new Set(pci.questions.map((q) => q.tier))).toEqual(new Set(['basic']));
    for (const q of pci.questions) {
      expect(q.group).toBe(q.id.split('-')[1]);
      expect(q.references[0]).toMatch(/^PCI DSS v4\.0 Requirement /);
    }
  });
});
