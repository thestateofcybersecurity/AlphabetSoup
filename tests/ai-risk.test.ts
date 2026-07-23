import { describe, expect, it } from 'vitest';
import rubricRaw from '../src/data/ai-risk-tiering.json';
import aiFrameworks from '../src/data/ai-frameworks.json';
import type { Answers, Rubric } from '../src/lib/ai-risk';
import { controlsForTier, isComplete, scoreUseCase, validateRubric } from '../src/lib/ai-risk';

const rubric = rubricRaw as Rubric;

function answersAt(pointTarget: number): Answers {
  return Object.fromEntries(
    rubric.questions.map((q) => [q.id, q.options.find((o) => o.points === pointTarget)!.value]),
  );
}

describe('ai-risk rubric integrity', () => {
  it('passes structural validation', () => {
    expect(validateRubric(rubric)).toEqual([]);
  });

  it('has eight questions with four anchored options each', () => {
    expect(rubric.questions).toHaveLength(8);
    for (const question of rubric.questions) {
      expect(question.options).toHaveLength(4);
      expect(question.help.length).toBeGreaterThan(20);
      for (const option of question.options) {
        expect(option.detail.length).toBeGreaterThan(20);
      }
    }
  });

  it('references only codes that exist in the AI frameworks dataset', () => {
    const known = new Set((aiFrameworks as { code: string }[]).map((entry) => entry.code));
    for (const tier of rubric.tiers) {
      for (const control of tier.controls) {
        expect(control.refs.length).toBeGreaterThan(0);
        for (const ref of control.refs) {
          expect(known, `unknown framework code "${ref}" in tier ${tier.id}`).toContain(ref);
        }
      }
    }
  });

  it('gives every tier a review path, controls, and a policy snippet', () => {
    for (const tier of rubric.tiers) {
      expect(tier.reviewPath.steps.length).toBeGreaterThanOrEqual(3);
      expect(tier.controls.length).toBeGreaterThanOrEqual(4);
      expect(tier.policySnippet).toContain('RISK');
    }
  });
});

describe('ai-risk scoring', () => {
  it('requires all questions answered', () => {
    expect(isComplete(rubric, {})).toBe(false);
    expect(isComplete(rubric, answersAt(0))).toBe(true);
    expect(() => scoreUseCase(rubric, {})).toThrow(/Missing answer/);
  });

  it('scores all-lowest answers as low with no gates', () => {
    const result = scoreUseCase(rubric, answersAt(0));
    expect(result.score).toBe(0);
    expect(result.maxScore).toBe(rubric.meta.maxScore);
    expect(result.tier.id).toBe('low');
    expect(result.gateReasons).toEqual([]);
  });

  it('scores all-highest answers as high', () => {
    const result = scoreUseCase(rubric, answersAt(3));
    expect(result.score).toBe(rubric.meta.maxScore);
    expect(result.tier.id).toBe('high');
  });

  it('is deterministic: same answers, same tier', () => {
    const answers = answersAt(1);
    expect(scoreUseCase(rubric, answers)).toEqual(scoreUseCase(rubric, answers));
  });

  it('gates force the tier up even when the score stays low', () => {
    // Everything harmless except regulated data: score 3/24 but High by gate.
    const answers = answersAt(0);
    answers.data = 'regulated';
    const result = scoreUseCase(rubric, answers);
    expect(result.scoreTier.id).toBe('low');
    expect(result.tier.id).toBe('high');
    expect(result.gateReasons.length).toBeGreaterThan(0);
    expect(result.gateReasons[0]).toMatch(/High tier/);
  });

  it('medium gates lift low scores to medium', () => {
    // Shadow AI on otherwise harmless answers rules out the pre-approved path.
    const answers = answersAt(0);
    answers.model = 'unknown';
    const result = scoreUseCase(rubric, answers);
    expect(result.tier.id).toBe('medium');
  });

  it('gates never lower a tier the score already earned', () => {
    // High score with only a medium gate stays high.
    const answers = answersAt(3);
    answers.data = 'confidential';
    answers.autonomy = 'gated';
    answers.consequence = 'customer';
    answers.access = 'write_nonprod';
    const result = scoreUseCase(rubric, answers);
    expect(result.score).toBe(20);
    expect(result.tier.id).toBe('high');
  });

  it('controls are cumulative up the tiers', () => {
    expect(controlsForTier(rubric, 'low')).toHaveLength(1);
    expect(controlsForTier(rubric, 'medium')).toHaveLength(2);
    expect(controlsForTier(rubric, 'high')).toHaveLength(3);
  });
});
