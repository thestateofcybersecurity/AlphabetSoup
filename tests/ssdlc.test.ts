import { describe, expect, it } from 'vitest';
import dataRaw from '../src/data/ssdlc.json';
import {
  adoptionPlan,
  currentLevel,
  maxLevel,
  overallScore,
  planCsv,
  priorityScore,
  scoreByPhase,
  type Practice,
  type SsdlcData,
} from '../src/lib/ssdlc';

const data = dataRaw as SsdlcData;

const practice = (over: Partial<Practice>): Practice => ({
  id: 'p',
  name: 'P',
  phase: 'build',
  why: 'w',
  leverage: 'high',
  friction: 'low',
  ssdfRef: 'PW.7',
  levels: [
    { label: 'None', detail: 'n' },
    { label: 'Ad hoc', detail: 'a' },
    { label: 'Automated', detail: 'au' },
    { label: 'Enforced', detail: 'e' },
  ],
  engineerNote: 'note',
  ...over,
});

describe('currentLevel', () => {
  it('defaults to 0 and clamps to the ladder', () => {
    const p = practice({});
    expect(currentLevel(p, {})).toBe(0);
    expect(currentLevel(p, { p: 2 })).toBe(2);
    expect(currentLevel(p, { p: 9 })).toBe(maxLevel(p));
    expect(currentLevel(p, { p: -3 })).toBe(0);
  });
});

describe('priorityScore', () => {
  it('rewards high leverage and low friction', () => {
    expect(priorityScore(practice({ leverage: 'high', friction: 'low' }))).toBe(9);
    expect(priorityScore(practice({ leverage: 'high', friction: 'high' }))).toBe(3);
    expect(priorityScore(practice({ leverage: 'low', friction: 'high' }))).toBe(1);
    // A high-leverage/low-friction quick win outranks a high-leverage/high-friction lift.
    expect(priorityScore(practice({ leverage: 'high', friction: 'low' }))).toBeGreaterThan(
      priorityScore(practice({ leverage: 'high', friction: 'high' })),
    );
  });
});

describe('scoreByPhase and overallScore', () => {
  const mini: SsdlcData = {
    ...data,
    phases: [
      { id: 'build', name: 'Build and CI' },
      { id: 'operate', name: 'Operate' },
    ],
    practices: [
      practice({ id: 'a', phase: 'build' }),
      practice({ id: 'b', phase: 'build' }),
      practice({ id: 'c', phase: 'operate' }),
    ],
  };
  it('computes phase percentages against the achievable max', () => {
    const scores = scoreByPhase(mini, { a: 3, b: 0, c: 3 });
    const build = scores.find((s) => s.phase === 'build')!;
    expect(build).toMatchObject({ current: 3, max: 6, pct: 50 });
    const operate = scores.find((s) => s.phase === 'operate')!;
    expect(operate).toMatchObject({ current: 3, max: 3, pct: 100 });
  });
  it('computes overall across all practices', () => {
    expect(overallScore(mini, { a: 3, b: 3, c: 3 })).toBe(100);
    expect(overallScore(mini, {})).toBe(0);
  });
});

describe('adoptionPlan', () => {
  const mini: SsdlcData = {
    ...data,
    practices: [
      practice({ id: 'quick', leverage: 'high', friction: 'low' }), // score 9
      practice({ id: 'lift', leverage: 'high', friction: 'high' }), // score 3
      practice({ id: 'done', leverage: 'high', friction: 'low' }),
    ],
  };
  it('lists one next step per gap, ordered by leverage-to-friction', () => {
    const plan = adoptionPlan(mini, { done: 3 });
    expect(plan.map((i) => i.practice.id)).toEqual(['quick', 'lift']);
    expect(plan[0]).toMatchObject({ fromIndex: 0, toIndex: 1 });
  });
  it('excludes practices already at the top rung', () => {
    const plan = adoptionPlan(mini, { quick: 3, lift: 3, done: 3 });
    expect(plan).toHaveLength(0);
  });
  it('advances only one rung at a time', () => {
    const plan = adoptionPlan(mini, { quick: 1 });
    const q = plan.find((i) => i.practice.id === 'quick')!;
    expect(q.fromIndex).toBe(1);
    expect(q.toIndex).toBe(2);
  });
});

describe('planCsv', () => {
  it('numbers the steps and quotes commas', () => {
    const plan = adoptionPlan(
      { ...data, practices: [practice({ id: 'x', name: 'Scan, always' })] },
      {},
    );
    const rows = planCsv(plan).split('\n');
    expect(rows[0]).toBe('Order,Practice,Phase,Move from,Move to,Leverage,Friction,SSDF');
    expect(rows[1]).toContain('1,"Scan, always",build');
  });
});

describe('ssdlc.json data integrity', () => {
  const RATINGS = new Set(['high', 'medium', 'low']);
  const PHASES = new Set(data.phases.map((p) => p.id));
  const SSDF = /^(PO|PS|PW|RV)\.\d+$/;

  it('has 19 practices with unique ids in valid phases', () => {
    expect(data.practices).toHaveLength(19);
    expect(new Set(data.practices.map((p) => p.id)).size).toBe(19);
    for (const p of data.practices) expect(PHASES.has(p.phase), p.id).toBe(true);
  });

  it('each practice has a 4-rung ladder, valid ratings, and an SSDF ref', () => {
    for (const p of data.practices) {
      expect(p.levels, p.id).toHaveLength(4);
      for (const l of p.levels) {
        expect(l.label.trim().length, p.id).toBeGreaterThan(0);
        expect(l.detail.trim().length, p.id).toBeGreaterThan(0);
      }
      expect(RATINGS.has(p.leverage), p.id).toBe(true);
      expect(RATINGS.has(p.friction), p.id).toBe(true);
      expect(SSDF.test(p.ssdfRef), `${p.id}: ${p.ssdfRef}`).toBe(true);
    }
  });

  it('has no em dashes and names within length', () => {
    for (const p of data.practices) {
      expect(JSON.stringify(p), p.id).not.toMatch(/—/);
      expect(p.name.length, p.id).toBeLessThanOrEqual(60);
    }
  });

  it('every phase in the list has at least one practice', () => {
    for (const phase of data.phases) {
      expect(data.practices.some((p) => p.phase === phase.id), phase.id).toBe(true);
    }
  });
});
