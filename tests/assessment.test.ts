import { describe, expect, it } from 'vitest';
import raw from '../src/data/assessment.json';
import {
  cisControlFromReference,
  readinessBand,
  scoreAssessment,
} from '../src/lib/assessment';
import type { AssessmentData, Answers } from '../src/lib/assessment';

const data = raw as AssessmentData;

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
