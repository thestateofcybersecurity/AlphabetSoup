import { describe, expect, it } from 'vitest';
import assessRaw from '../src/data/assessment.json';
import cisRaw from '../src/data/cis.json';
import igsRaw from '../src/data/cis-igs.json';
import type { AssessmentData, Answers } from '../src/lib/assessment';
import {
  cisIg1Assessment,
  cisSafeguardFromReference,
  scoreAssessment,
  sentenceCase,
} from '../src/lib/assessment';
import { gapsPlan } from '../src/lib/roadmap';
import { missedBank, recordRound } from '../src/lib/quiz';
import type { CisData } from '../src/lib/frameworks';

const assessment = assessRaw as AssessmentData;
const cis = cisRaw as CisData;
const igs = igsRaw as Record<string, number>;

describe('gapsPlan (assess -> roadmap handoff)', () => {
  it('creates one task per non-yes answer with tier-based quarters', () => {
    const answers: Answers = {};
    for (const question of assessment.questions) answers[question.id] = 'yes';
    const firstBasic = assessment.questions.find((q) => q.tier === 'basic')!;
    const firstAdvanced = assessment.questions.find((q) => q.tier === 'advanced')!;
    answers[firstBasic.id] = 'no';
    delete answers[firstAdvanced.id]; // unanswered counts as a gap

    const plan = gapsPlan(assessment, answers);
    expect(plan).toHaveLength(2);
    const basicTask = plan.find((t) => t.id === firstBasic.id)!;
    expect(basicTask.defaultQuarter).toBe('Q1');
    expect(basicTask.label).toBe(firstBasic.text);
    expect(plan.find((t) => t.id === firstAdvanced.id)!.defaultQuarter).toBe('Q3');
  });

  it('links tasks with CIS references into the CIS section', () => {
    const plan = gapsPlan(assessment, {});
    expect(plan).toHaveLength(48);
    expect(plan.some((t) => t.link?.includes('frameworks/cis'))).toBe(true);
  });
});

describe('quiz progress', () => {
  it('records full rounds and builds a missed bank', () => {
    let progress = {};
    progress = recordRound(progress, 'cissp', {
      percent: 60,
      missedQuestions: ['q1', 'q2'],
      correctQuestions: ['q3'],
    });
    progress = recordRound(progress, 'cissp', {
      percent: 80,
      missedQuestions: ['q1'],
      correctQuestions: ['q2'],
    });
    const deck = (progress as Record<string, { attempts: number; best: number }>)['cissp'];
    expect(deck.attempts).toBe(2);
    expect(deck.best).toBe(80);
    expect(missedBank(progress, 'cissp')).toEqual(['q1']);
  });

  it('review rounds clear misses without counting as attempts', () => {
    let progress = recordRound({}, 'gsec', {
      percent: 50,
      missedQuestions: ['a', 'b'],
      correctQuestions: [],
    });
    progress = recordRound(progress, 'gsec', {
      missedQuestions: [],
      correctQuestions: ['a', 'b'],
    });
    const deck = (progress as Record<string, { attempts: number; best: number }>)['gsec'];
    expect(deck.attempts).toBe(1);
    expect(missedBank(progress, 'gsec')).toEqual([]);
  });
});

describe('CIS IG1 assessment', () => {
  const ig1 = cisIg1Assessment(cis, igs);

  it('covers all 56 IG1 safeguards with sensible questions', () => {
    expect(ig1.questions).toHaveLength(56);
    expect(ig1.questions[0].id).toBe('1.1');
    expect(ig1.questions[0].text).toMatch(/^Do you .*\?$/);
    expect(ig1.questions.every((q) => q.tier === 'basic')).toBe(true);
  });

  it('scores through the standard engine', () => {
    const answers: Answers = { '1.1': 'yes' } as Answers;
    const result = scoreAssessment(ig1, answers);
    expect(result.total).toBe(56);
    expect(result.overallPercent).toBe(2);
    expect(result.groups[0].name).toContain('Control 1');
  });

  it('references resolve to safeguard ids', () => {
    expect(cisSafeguardFromReference(ig1.questions[0].references[0])).toBe('1.1');
    expect(cisSafeguardFromReference('NIST SP 800-53')).toBeNull();
  });
});

describe('sentenceCase', () => {
  it('lowercases title case but preserves acronyms and digits', () => {
    expect(sentenceCase('Establish and Maintain a Software Inventory')).toBe(
      'establish and maintain a software inventory',
    );
    expect(sentenceCase('Use DNS Filtering Services')).toBe('use DNS filtering services');
    expect(sentenceCase('Deploy WPA2 or Better')).toBe('deploy WPA2 or better');
  });
});
