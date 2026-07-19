import { describe, expect, it } from 'vitest';
import raw from '../src/data/assessment.json';
import {
  cisControlFromReference,
  concerns,
  readinessBand,
  scoreAssessment,
} from '../src/lib/assessment';
import type { AssessmentData, Answers } from '../src/lib/assessment';

const data = raw as AssessmentData;

/** A tiny three-goal, mixed-tier fixture for exercising the scoring rules. */
const fixture: AssessmentData = {
  categories: [
    { id: 'A', name: 'Alpha' },
    { id: 'B', name: 'Bravo' },
  ],
  questions: [
    { id: 'a1', text: 'q', tier: 'basic', group: 'A', references: ['r'] },
    { id: 'a2', text: 'q', tier: 'basic', group: 'A', references: ['r'] },
    { id: 'b1', text: 'q', tier: 'intermediate', group: 'B', references: ['r'] },
    { id: 'b2', text: 'q', tier: 'advanced', group: 'B', references: ['r'] },
  ],
};

describe('assessment dataset', () => {
  it('has 48 unique yes/no questions in 10 categories', () => {
    expect(data.questions).toHaveLength(48);
    expect(data.categories).toHaveLength(10);
    const ids = data.questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groupIds = new Set(data.categories.map((c) => c.id));
    for (const question of data.questions) {
      expect(groupIds.has(question.group)).toBe(true);
      expect(['basic', 'intermediate', 'advanced']).toContain(question.tier);
      expect(question.text.trim().length).toBeGreaterThan(10);
      expect(question.references.length).toBeGreaterThan(0);
    }
  });
});

describe('scoreAssessment', () => {
  it('scores all-yes as 100 across the board', () => {
    const answers: Answers = Object.fromEntries(data.questions.map((q) => [q.id, 'yes'])) as Answers;
    const result = scoreAssessment(data, answers);
    expect(result.overallPercent).toBe(100);
    expect(result.tierPercents.basic).toBe(100);
    expect(result.groups.every((g) => g.percent === 100)).toBe(true);
    expect(result.answered).toBe(48);
  });

  it('scores all-no as 0 and unanswered as no', () => {
    const result = scoreAssessment(data, {});
    expect(result.overallPercent).toBe(0);
    expect(result.answered).toBe(0);
  });

  it('computes per-group percentages', () => {
    const db = data.questions.filter((q) => q.group === 'DB');
    const answers: Answers = { [db[0].id]: 'yes', [db[1].id]: 'no' } as Answers;
    const result = scoreAssessment(data, answers);
    const dbScore = result.groups.find((g) => g.id === 'DB')!;
    expect(dbScore.total).toBe(2);
    expect(dbScore.percent).toBe(50);
  });

  it('excludes not-applicable answers from the denominator', () => {
    // A: one yes, one na -> applicable 1, satisfied 1 -> 100%
    const result = scoreAssessment(fixture, { a1: 'yes', a2: 'na' });
    const a = result.groups.find((g) => g.id === 'A')!;
    expect(a.total).toBe(1);
    expect(a.na).toBe(1);
    expect(a.percent).toBe(100);
    expect(result.distribution.na).toBe(1);
    expect(result.distribution.unanswered).toBe(2);
  });

  it('counts alternate (compensating control) as satisfied', () => {
    const result = scoreAssessment(fixture, { a1: 'yes', a2: 'alt', b1: 'no', b2: 'no' });
    expect(result.groups.find((g) => g.id === 'A')!.percent).toBe(100);
    expect(result.distribution.alt).toBe(1);
  });

  it('gates tier attainment cumulatively', () => {
    // basic fully satisfied, intermediate not answered
    const basicOnly = scoreAssessment(fixture, { a1: 'yes', a2: 'yes' });
    expect(basicOnly.tierAttained.basic).toBe(true);
    expect(basicOnly.tierAttained.intermediate).toBe(false);
    expect(basicOnly.attainedTier).toBe('basic');

    // everything satisfied (b1/b2 alt+na count) -> advanced attained
    const all = scoreAssessment(fixture, { a1: 'yes', a2: 'yes', b1: 'alt', b2: 'na' });
    expect(all.attainedTier).toBe('advanced');

    // a basic gap blocks all attainment even if higher tiers pass
    const gap = scoreAssessment(fixture, { a1: 'no', a2: 'yes', b1: 'yes', b2: 'yes' });
    expect(gap.attainedTier).toBeNull();
  });

  it('flags all-N/A (no applicable answers) as insufficient, not "advanced"', () => {
    const allNa = scoreAssessment(fixture, { a1: 'na', a2: 'na', b1: 'na', b2: 'na' });
    expect(allNa.insufficient).toBe(true);
    expect(allNa.applicable).toBe(0);
    expect(allNa.attainedTier).toBeNull();
    expect(allNa.tierAttained.advanced).toBe(false);
    // A real answer clears the insufficient flag.
    expect(scoreAssessment(fixture, { a1: 'yes' }).insufficient).toBe(false);
  });
});

describe('concerns', () => {
  it('ranks deficient goals worst-first and orders gaps basic-first', () => {
    const { goals, questions } = concerns(fixture, { a1: 'yes', a2: 'no', b1: 'no', b2: 'no' });
    // B is 0% (both no), A is 50% -> B ranked first
    expect(goals[0].id).toBe('B');
    expect(goals[1].id).toBe('A');
    // deficient questions: a2(basic), b1(intermediate), b2(advanced) in that order
    expect(questions.map((q) => q.id)).toEqual(['a2', 'b1', 'b2']);
  });

  it('drops not-applicable questions from the gap list', () => {
    const { questions } = concerns(fixture, { a1: 'na', a2: 'yes', b1: 'yes', b2: 'yes' });
    expect(questions).toHaveLength(0);
  });
});

describe('readinessBand', () => {
  it('maps score ranges to bands', () => {
    expect(readinessBand(90).label).toBe('Well prepared');
    expect(readinessBand(70).label).toBe('On the way');
    expect(readinessBand(40).label).toBe('Exposed');
    expect(readinessBand(10).label).toBe('High risk');
  });
});

describe('cisControlFromReference', () => {
  it('parses CIS control numbers from reference strings', () => {
    expect(cisControlFromReference('CIS Control 11 - Data Recovery')).toBe(11);
    expect(cisControlFromReference('NIST SP 800-53 Rev. 5: CP-9')).toBeNull();
    expect(cisControlFromReference('CIS Control 99 - Bogus')).toBeNull();
  });

  it('finds CIS references in the real dataset', () => {
    const found = data.questions.some((q) => q.references.some((r) => cisControlFromReference(r)));
    expect(found).toBe(true);
  });
});
