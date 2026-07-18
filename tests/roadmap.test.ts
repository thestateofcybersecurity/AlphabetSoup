import { describe, expect, it } from 'vitest';
import csfRaw from '../src/data/nist-csf.json';
import cisRaw from '../src/data/cis.json';
import igsRaw from '../src/data/cis-igs.json';
import vcisoRaw from '../src/data/vciso-tasks.json';
import type { CisData, CsfData } from '../src/lib/frameworks';
import {
  cisPlan,
  csfPlan,
  nextStatus,
  planProgress,
  planToCsv,
  totalHours,
  vcisoPlan,
} from '../src/lib/roadmap';
import type { VcisoTask } from '../src/lib/roadmap';

const csf = csfRaw as CsfData;
const cis = cisRaw as CisData;
const igs = igsRaw as Record<string, number>;
const vciso = vcisoRaw as VcisoTask[];

describe('roadmap datasets', () => {
  it('IG map covers all 153 safeguards with official IG1 count', () => {
    expect(Object.keys(igs)).toHaveLength(153);
    expect(Object.values(igs).filter((v) => v === 1)).toHaveLength(56);
    for (const id of Object.keys(igs)) expect(cis[id]).toBeDefined();
  });

  it('vCISO template has 89 tasks with valid packages and quarters', () => {
    expect(vciso).toHaveLength(89);
    for (const task of vciso) {
      expect(['Small', 'Medium', 'Large']).toContain(task.package);
      expect(task.hours).toBeGreaterThan(0);
    }
  });
});

describe('plan builders', () => {
  it('CSF plan has one task per category (22) grouped by function', () => {
    const plan = csfPlan(csf);
    expect(plan).toHaveLength(22);
    expect(plan[0].id).toBe('GV.OC');
    expect(plan[0].group).toBe('Govern');
    expect(plan.find((t) => t.id === 'GV.SC')?.detail).toBe('10 subcategories');
    expect(plan.every((t) => t.link?.includes('nist-csf'))).toBe(true);
  });

  it('CIS plan scopes safeguard counts by implementation group', () => {
    const ig1 = cisPlan(cis, igs, 1);
    const ig3 = cisPlan(cis, igs, 3);
    expect(ig3).toHaveLength(18);
    expect(ig1.length).toBeLessThanOrEqual(18);
    const c1ig1 = ig1.find((t) => t.id === '1')!;
    const c1ig3 = ig3.find((t) => t.id === '1')!;
    expect(c1ig3.detail).toContain('5 of 5');
    const ig1Total = ig1.reduce((sum, t) => sum + Number(t.detail.split(' ')[0]), 0);
    expect(ig1Total).toBe(56);
    expect(c1ig1.defaultQuarter).toBe('Q1');
  });

  it('vCISO packages are cumulative', () => {
    const small = vcisoPlan(vciso, 'Small');
    const medium = vcisoPlan(vciso, 'Medium');
    const large = vcisoPlan(vciso, 'Large');
    expect(small.length).toBeLessThanOrEqual(medium.length);
    expect(medium.length).toBeLessThanOrEqual(large.length);
    expect(large).toHaveLength(89);
    expect(totalHours(large)).toBeGreaterThan(totalHours(small));
  });
});

describe('plan state helpers', () => {
  it('cycles status and reports progress', () => {
    expect(nextStatus('planned')).toBe('in-progress');
    expect(nextStatus('done')).toBe('planned');
    const plan = csfPlan(csf);
    const state = { [plan[0].id]: { quarter: plan[0].defaultQuarter, status: 'done' as const } };
    expect(planProgress(plan, state)).toEqual({ done: 1, total: 22 });
  });

  it('exports CSV with quoting', () => {
    const csv = planToCsv(
      [{ id: 'x', label: 'Task, with "comma"', group: 'g', detail: '', defaultQuarter: 'Q1' }],
      {},
    );
    expect(csv).toContain('"Task, with ""comma"""');
    expect(csv.split('\n')[0]).toBe('id,task,group,quarter,status,hours');
  });
});
