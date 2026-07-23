import { describe, expect, it } from 'vitest';
import dataRaw from '../src/data/automation-roi.json';
import {
  backlogCsv,
  capacityModel,
  rankBacklog,
  scoreTask,
  type AutomationData,
  type Task,
} from '../src/lib/automation-roi';

const data = dataRaw as AutomationData;

const task = (over: Partial<Task>): Task => ({
  id: 't',
  name: 'T',
  category: 'reporting',
  volume: 4,
  minutes: 180,
  sensitivity: 'low',
  ...over,
});

describe('scoreTask', () => {
  it('computes hours from volume, minutes, and the discount factors', () => {
    // reporting automatable 0.9, low sensitivity autoRetain 1.0 => fraction 0.9.
    const s = scoreTask(data, task({ volume: 4, minutes: 180 }))!;
    expect(s.rawHours).toBe(12); // 4 * 180 / 60
    expect(s.automatableFraction).toBe(0.9);
    expect(s.hoursSaved).toBe(10.8); // 12 * 0.9
  });

  it('discounts more when error sensitivity is high', () => {
    const low = scoreTask(data, task({ sensitivity: 'low' }))!;
    const high = scoreTask(data, task({ sensitivity: 'high' }))!;
    expect(high.hoursSaved).toBeLessThan(low.hoursSaved);
  });

  it('routes high-sensitivity triage work to an AI-assisted pattern with a human gate', () => {
    const s = scoreTask(data, task({ category: 'alert-triage', sensitivity: 'high' }))!;
    expect(s.pattern.id).toBe('ai-triage');
    expect(s.humanGate).toBe(true);
  });

  it('uses the category default pattern otherwise', () => {
    const s = scoreTask(data, task({ category: 'reporting', sensitivity: 'low' }))!;
    expect(s.pattern.id).toBe('scheduled-script');
    expect(s.humanGate).toBe(false);
  });

  it('returns null for an unknown category or sensitivity', () => {
    expect(scoreTask(data, task({ category: 'nope' }))).toBeNull();
    expect(scoreTask(data, task({ sensitivity: 'nope' }))).toBeNull();
  });
});

describe('rankBacklog', () => {
  it('orders by hours saved and drops unscorable rows', () => {
    const tasks = [
      task({ id: 'a', name: 'Small', category: 'reporting', volume: 1, minutes: 30 }),
      task({ id: 'b', name: 'Big', category: 'evidence', volume: 60, minutes: 20, sensitivity: 'low' }),
      task({ id: 'c', name: 'Broken', category: 'nope' }),
    ];
    const ranked = rankBacklog(data, tasks);
    expect(ranked.map((s) => s.task.id)).toEqual(['b', 'a']);
  });
});

describe('capacityModel', () => {
  it('sums hours and converts to FTE using the configured month length', () => {
    const scored = rankBacklog(data, [
      task({ category: 'reporting', volume: 4, minutes: 180, sensitivity: 'low' }), // 12 raw, 10.8 saved
    ]);
    const cap = capacityModel(data, scored);
    expect(cap.currentHours).toBe(12);
    expect(cap.savedHours).toBe(10.8);
    expect(cap.fteHours).toBe(data.meta.fteHoursPerMonth);
    expect(cap.savedFte).toBeCloseTo(10.8 / data.meta.fteHoursPerMonth, 2);
  });
});

describe('backlogCsv', () => {
  it('numbers rows and quotes commas', () => {
    const scored = rankBacklog(data, [task({ name: 'Report, weekly', category: 'reporting', volume: 4, minutes: 60 })]);
    const rows = backlogCsv(scored).split('\n');
    expect(rows[0]).toBe('Rank,Task,Category,Volume/mo,Min each,Sensitivity,Hours now,Hours saved,Pattern');
    expect(rows[1]).toContain('1,"Report, weekly"');
  });
});

describe('automation-roi.json data integrity', () => {
  it('every category references a real pattern and has a valid automatable factor', () => {
    const patternIds = new Set(data.patterns.map((p) => p.id));
    for (const c of data.categories) {
      expect(patternIds.has(c.defaultPattern), c.id).toBe(true);
      expect(c.automatable).toBeGreaterThan(0);
      expect(c.automatable).toBeLessThanOrEqual(1);
    }
  });

  it('sensitivities have retain factors in range and patterns have skeletons', () => {
    for (const s of data.sensitivities) {
      expect(s.autoRetain).toBeGreaterThan(0);
      expect(s.autoRetain).toBeLessThanOrEqual(1);
    }
    for (const p of data.patterns) {
      expect(p.skeleton.length, p.id).toBeGreaterThanOrEqual(3);
      expect(p.blurb.trim().length, p.id).toBeGreaterThan(0);
    }
  });

  it('has no em dashes anywhere', () => {
    expect(JSON.stringify(data)).not.toMatch(/—/);
  });
});
