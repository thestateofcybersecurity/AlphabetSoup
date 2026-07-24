import { describe, expect, it } from 'vitest';
import dataRaw from '../src/data/skills-matrix.json';
import scorecardRaw from '../src/data/scorecard.json';
import {
  busFactorWarnings,
  coverage,
  growthPlan,
  hiringProfile,
  matrixCsv,
  rating,
  resilientCoverage,
  type Member,
  type SkillsData,
} from '../src/lib/skills-matrix';

const data = dataRaw as SkillsData;
const scorecard = scorecardRaw as { cards: { id: string }[] };

const member = (name: string, ratings: Record<string, number>): Member => ({ id: name, name, ratings });

// Two competencies for focused math tests.
const mini: SkillsData = {
  meta: { title: 't', version: '0', note: '', sources: [] },
  levels: data.levels,
  proficientLevel: 3,
  competencies: [
    { id: 'a', name: 'Alpha', blurb: '', resources: [{ label: 'r', href: '../x/' }] },
    { id: 'b', name: 'Bravo', blurb: '', resources: [] },
  ],
};

describe('rating', () => {
  it('defaults to 0 and clamps to the scale', () => {
    expect(rating(data, member('x', {}), 'cloud-security')).toBe(0);
    expect(rating(data, member('x', { 'cloud-security': 9 }), 'cloud-security')).toBe(4);
    expect(rating(data, member('x', { 'cloud-security': 2 }), 'cloud-security')).toBe(2);
  });
});

describe('coverage and bus factor', () => {
  const team = [member('p1', { a: 4, b: 1 }), member('p2', { a: 3, b: 2 })];
  it('counts proficient people per competency', () => {
    const cov = coverage(mini, team, new Set());
    expect(cov.find((r) => r.competency.id === 'a')!.proficient).toBe(2);
    expect(cov.find((r) => r.competency.id === 'b')!.proficient).toBe(0);
  });
  it('flags a competency with one or zero proficient as a bus-factor risk', () => {
    const cov = coverage(mini, team, new Set());
    expect(cov.find((r) => r.competency.id === 'a')!.busFactor).toBe(false); // 2 proficient
    expect(cov.find((r) => r.competency.id === 'b')!.busFactor).toBe(true); // 0 proficient
  });
  it('orders warnings with priorities first', () => {
    const solo = [member('p1', { a: 4, b: 4 })]; // both bus-factor (1 proficient each)
    const warnings = busFactorWarnings(mini, solo, new Set(['b']));
    expect(warnings[0].competency.id).toBe('b'); // priority first
  });
});

describe('growthPlan', () => {
  it('lists competencies below proficient, priority-first then largest gap', () => {
    const plan = growthPlan(mini, member('p', { a: 1, b: 2 }), new Set(['b']));
    expect(plan.map((g) => g.competency.id)).toEqual(['b', 'a']); // b is priority
    expect(plan.find((g) => g.competency.id === 'a')).toMatchObject({ current: 1, target: 3, gap: 2 });
  });
  it('is empty when the member is proficient everywhere', () => {
    expect(growthPlan(mini, member('p', { a: 3, b: 4 }), new Set())).toHaveLength(0);
  });
});

describe('hiringProfile', () => {
  it('surfaces priority competencies with weak coverage', () => {
    const team = [member('p1', { a: 4, b: 1 })]; // a: 1 proficient, b: 0
    const needs = hiringProfile(mini, team, new Set(['a']));
    // 'a' is a priority with only 1 proficient; 'b' has 0 proficient (bus factor).
    expect(needs.map((n) => n.competency.id)).toContain('a');
    expect(needs.map((n) => n.competency.id)).toContain('b');
    expect(needs[0].competency.id).toBe('a'); // priority first
  });
});

describe('resilientCoverage and matrixCsv', () => {
  it('is the share of competencies with 2+ proficient', () => {
    const team = [member('p1', { a: 3, b: 3 }), member('p2', { a: 3, b: 0 })];
    expect(resilientCoverage(mini, team)).toBe(50); // only 'a' has 2 proficient
  });
  it('builds a CSV with a header row and quoted names', () => {
    const csv = matrixCsv(mini, [member('Doe, Jane', { a: 3, b: 1 })]).split('\n');
    expect(csv[0]).toBe('Member,Alpha,Bravo');
    expect(csv[1]).toBe('"Doe, Jane",3,1');
  });
});

describe('skills-matrix.json data integrity', () => {
  it('has 10 competencies whose ids exactly match the scorecard cards', () => {
    expect(data.competencies).toHaveLength(10);
    const cardIds = new Set(scorecard.cards.map((c) => c.id));
    for (const c of data.competencies) expect(cardIds.has(c.id), `${c.id} is not a scorecard card`).toBe(true);
    expect(cardIds.size).toBe(data.competencies.length);
  });

  it('every competency has a name, blurb, and at least one resource with a valid href', () => {
    for (const c of data.competencies) {
      expect(c.name.trim().length, c.id).toBeGreaterThan(0);
      expect(c.blurb.trim().length, c.id).toBeGreaterThan(0);
      expect(c.resources.length, c.id).toBeGreaterThan(0);
      for (const r of c.resources) {
        expect(r.label.trim().length, c.id).toBeGreaterThan(0);
        expect(r.href, c.id).toMatch(/^(\.\.\/|https:\/\/)/);
      }
    }
  });

  it('has a 5-rung level scale, a proficient level, and no em dashes', () => {
    expect(data.levels).toHaveLength(5);
    expect(data.proficientLevel).toBe(3);
    expect(JSON.stringify(data)).not.toMatch(/—/);
  });
});
