import { describe, expect, it } from 'vitest';
import csfRaw from '../src/data/nist-csf.json';
import cisRaw from '../src/data/cis.json';
import igsRaw from '../src/data/cis-igs.json';
import vcisoRaw from '../src/data/vciso-tasks.json';
import type { CisData, CsfData } from '../src/lib/frameworks';
import programRaw from '../src/data/security-program.json';
import kpiRaw from '../src/data/roadmap-kpis.json';
import {
  cisPlan,
  csfPlan,
  gapsPlan,
  nextStatus,
  planLoad,
  planProgress,
  planToCsv,
  programMaturity,
  programPlan,
  quarterDateRange,
  statusCounts,
  totalHours,
  vcisoPlan,
} from '../src/lib/roadmap';
import type { GoalDepth, ProgramGoal } from '../src/lib/roadmap';

const program = programRaw as { goals: ProgramGoal[] };
const kpi = kpiRaw as { csf: Record<string, GoalDepth>; cis: Record<string, GoalDepth> };
import type { VcisoTask } from '../src/lib/roadmap';
import type { AssessmentData } from '../src/lib/assessment';

const miniAssessment: AssessmentData = {
  categories: [{ id: 'DB', name: 'Backups' }],
  questions: [
    { id: 'q1', text: 'Backups daily?', tier: 'basic', group: 'DB', references: ['CIS Control 11'] },
    { id: 'q2', text: 'Backups tested?', tier: 'intermediate', group: 'DB', references: ['NIST CSF PR.DS-11'] },
    { id: 'q3', text: 'Offline copy?', tier: 'advanced', group: 'DB', references: [] },
  ],
};

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

  it('exports CSV with quoting, owner, date, and notes columns', () => {
    const csv = planToCsv(
      [{ id: 'x', label: 'Task, with "comma"', group: 'g', detail: '', defaultQuarter: 'Q1' }],
      { x: { quarter: 'Q2', status: 'in-progress', owner: 'Dana', date: '2026-03-01', note: 'kickoff' } },
    );
    expect(csv).toContain('"Task, with ""comma"""');
    expect(csv.split('\n')[0]).toBe(
      'id,task,group,quarter,status,owner,target_date,notes,standards,kpis,hours',
    );
    expect(csv).toContain('Dana,2026-03-01,kickoff');
  });
});

describe('security program', () => {
  it('has a comprehensive, well-formed set of goals', () => {
    expect(program.goals.length).toBeGreaterThanOrEqual(15);
    const phases = new Set(program.goals.map((g) => g.phase));
    expect(phases).toEqual(new Set(['Q1', 'Q2', 'Q3', 'Q4']));
    for (const goal of program.goals) {
      expect(goal.title.length).toBeGreaterThan(5);
      expect(goal.objective.length).toBeGreaterThan(10);
      expect(goal.kpis.length).toBeGreaterThanOrEqual(2);
      expect(goal.milestones.length).toBeGreaterThanOrEqual(3);
      expect(goal.standards.length).toBeGreaterThanOrEqual(1);
      // No em dashes anywhere in the content.
      expect(JSON.stringify(goal)).not.toContain('—');
    }
  });

  it('programPlan carries depth fields and links to a framework page', () => {
    const plan = programPlan(program);
    expect(plan).toHaveLength(program.goals.length);
    const withKpis = plan.filter((t) => (t.kpis?.length ?? 0) >= 2);
    expect(withKpis.length).toBe(plan.length);
    const linked = plan.filter((t) => /frameworks\/(nist-csf|cis)/.test(t.link ?? ''));
    expect(linked.length).toBeGreaterThan(plan.length / 2);
    // Depth flows into the CSV export.
    const csv = planToCsv(plan, {});
    expect(csv).toContain('NIST CSF');
    expect(csv.toLowerCase()).toContain('target');
  });
});

describe('assessment gaps', () => {
  it('treats only unanswered and no as gaps (na and alt are not)', () => {
    const plan = gapsPlan(miniAssessment, { q1: 'yes', q2: 'na', q3: 'no' });
    // q1 satisfied, q2 na (not applicable) -> only q3 is a gap
    expect(plan.map((t) => t.id)).toEqual(['q3']);
    const altPlan = gapsPlan(miniAssessment, { q1: 'alt', q2: 'no', q3: 'no' });
    expect(altPlan.map((t) => t.id)).toEqual(['q2', 'q3']); // alt is satisfied, not a gap
  });

  it('links gaps to CIS or CSF pages by their references', () => {
    const plan = gapsPlan(miniAssessment, {});
    expect(plan.find((t) => t.id === 'q1')?.link).toContain('frameworks/cis');
    expect(plan.find((t) => t.id === 'q2')?.link).toContain('frameworks/nist-csf');
    expect(plan.find((t) => t.id === 'q3')?.link).toBeUndefined();
  });
});

describe('load and schedule helpers', () => {
  it('aggregates task count and hours per quarter', () => {
    const tasks = vcisoPlan(vciso, 'Large');
    const load = planLoad(tasks, {});
    const total = Object.values(load).reduce((s, l) => s + l.count, 0);
    expect(total).toBe(89);
    const hours = Object.values(load).reduce((s, l) => s + l.hours, 0);
    expect(Math.round(hours)).toBe(Math.round(totalHours(tasks)));
  });

  it('counts task status', () => {
    const tasks = csfPlan(csf);
    const state = { [tasks[0].id]: { quarter: tasks[0].defaultQuarter, status: 'done' as const } };
    const counts = statusCounts(tasks, state);
    expect(counts.done).toBe(1);
    expect(counts.planned).toBe(21);
  });

  it('maps quarters to a calendar range from a start month', () => {
    expect(quarterDateRange('2026-01', 'Q1')).toBe('Jan 2026 to Mar 2026');
    expect(quarterDateRange('2026-01', 'Q4')).toBe('Oct 2026 to Dec 2026');
    expect(quarterDateRange('2026-11', 'Q2')).toBe('Feb 2027 to Apr 2027');
    expect(quarterDateRange('2026-01', 'Onboarding')).toBe('Setup');
  });

  it('rolls plan status up into a maturity level', () => {
    const tasks = csfPlan(csf);
    expect(programMaturity(tasks, {})).toEqual({ percent: 0, level: 'Initial' });
    const allDone = Object.fromEntries(
      tasks.map((t) => [t.id, { quarter: t.defaultQuarter, status: 'done' as const }]),
    );
    expect(programMaturity(tasks, allDone)).toEqual({ percent: 100, level: 'Optimizing' });
    // Half in progress -> 25% -> Developing.
    const half = Object.fromEntries(
      tasks.slice(0, 11).map((t) => [t.id, { quarter: t.defaultQuarter, status: 'in-progress' as const }]),
    );
    const m = programMaturity(tasks, half);
    expect(m.percent).toBe(25);
    expect(m.level).toBe('Developing');
  });
});

describe('framework KPI depth', () => {
  it('has objective, KPIs, and standards for every CIS control and CSF category', () => {
    for (let n = 1; n <= 18; n++) {
      const d = kpi.cis[String(n)];
      expect(d.objective!.length).toBeGreaterThan(10);
      expect(d.kpis!.length).toBeGreaterThanOrEqual(2);
      expect(d.standards!.length).toBeGreaterThanOrEqual(1);
    }
    expect(Object.keys(kpi.csf)).toHaveLength(22);
  });

  it('merges depth into CIS and CSF plans', () => {
    const cisTasks = cisPlan(cis, igs, 3, kpi.cis);
    const c1 = cisTasks.find((t) => t.id === '1')!;
    expect(c1.kpis?.length).toBeGreaterThanOrEqual(2);
    expect(c1.standards?.some((s) => /CIS/.test(s.framework))).toBe(true);
    // Without depth, tasks stay lean.
    expect(cisPlan(cis, igs, 3).find((t) => t.id === '1')!.kpis).toBeUndefined();

    const csfTasks = csfPlan(csf, kpi.csf);
    expect(csfTasks.find((t) => t.id === 'GV.OC')!.kpis?.length).toBeGreaterThanOrEqual(2);
  });
});
