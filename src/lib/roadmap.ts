import type { CisData, CsfData } from './frameworks';
import { CSF_FUNCTIONS } from './frameworks';
import { cisControlFromReference } from './assessment';
import type { Answers, AssessmentData } from './assessment';

export type Quarter = 'Onboarding' | 'Q1' | 'Q2' | 'Q3' | 'Q4';
export type TaskStatus = 'planned' | 'in-progress' | 'done';

export interface StandardRef {
  framework: string;
  ref: string;
}

export interface RoadmapTask {
  id: string;
  label: string;
  group: string;
  detail: string;
  defaultQuarter: Quarter;
  /** Relative link to related site content, if any. */
  link?: string;
  hours?: number;
  /** Depth fields, populated for the curated Security program source. */
  objective?: string;
  why?: string;
  kpis?: string[];
  milestones?: string[];
  standards?: StandardRef[];
}

export interface TaskState {
  quarter: Quarter;
  status: TaskStatus;
  owner?: string;
  /** Target date, YYYY-MM-DD. */
  date?: string;
  note?: string;
}

export type PlanState = Record<string, TaskState>;

export const QUARTERS: Quarter[] = ['Onboarding', 'Q1', 'Q2', 'Q3', 'Q4'];
export const STATUS_CYCLE: TaskStatus[] = ['planned', 'in-progress', 'done'];

/** Optional per-item depth (objective, KPIs, standards) merged into framework tasks. */
export interface GoalDepth {
  objective?: string;
  kpis?: string[];
  standards?: StandardRef[];
}

const mergeDepth = (task: RoadmapTask, depth?: GoalDepth): RoadmapTask =>
  depth ? { ...task, objective: depth.objective, kpis: depth.kpis, standards: depth.standards } : task;

/** One task per CSF 2.0 category, spread across the year by function. */
export function csfPlan(csf: CsfData, depth?: Record<string, GoalDepth>): RoadmapTask[] {
  const functionQuarter: Record<string, Quarter> = {
    GV: 'Q1',
    ID: 'Q1',
    PR: 'Q2',
    DE: 'Q3',
    RS: 'Q3',
    RC: 'Q4',
  };
  const seen = new Map<string, { name: string; fn: string; count: number }>();
  for (const id of Object.keys(csf).sort()) {
    const entry = csf[id];
    const existing = seen.get(entry.categoryCode);
    if (existing) {
      existing.count += 1;
    } else {
      seen.set(entry.categoryCode, { name: entry.category, fn: entry.functionCode, count: 1 });
    }
  }
  const functionOrder = CSF_FUNCTIONS.map(([code]) => code);
  return [...seen.entries()]
    .sort(
      (a, b) =>
        functionOrder.indexOf(a[1].fn) - functionOrder.indexOf(b[1].fn) ||
        a[0].localeCompare(b[0]),
    )
    .map(([code, info]) =>
      mergeDepth(
        {
          id: code,
          label: `${code}: ${info.name}`,
          group: CSF_FUNCTIONS.find(([c]) => c === info.fn)?.[1] ?? info.fn,
          detail: `${info.count} subcategories`,
          defaultQuarter: functionQuarter[info.fn] ?? 'Q4',
          link: `../frameworks/nist-csf/?q=${code.toLowerCase()}`,
        },
        depth?.[code],
      ),
    );
}

/** One task per CIS control, scoped to an implementation group. */
export function cisPlan(
  cis: CisData,
  igMap: Record<string, number>,
  ig: 1 | 2 | 3,
  depth?: Record<string, GoalDepth>,
): RoadmapTask[] {
  const controls = new Map<number, { name: string; inScope: number; total: number }>();
  for (const id of Object.keys(cis)) {
    const entry = cis[id];
    const record = controls.get(entry.control) ?? { name: entry.controlName, inScope: 0, total: 0 };
    record.total += 1;
    if ((igMap[id] ?? 3) <= ig) record.inScope += 1;
    controls.set(entry.control, record);
  }
  const quarterFor = (control: number): Quarter =>
    control <= 6 ? 'Q1' : control <= 12 ? 'Q2' : control <= 16 ? 'Q3' : 'Q4';
  return [...controls.entries()]
    .sort((a, b) => a[0] - b[0])
    .filter(([, info]) => info.inScope > 0)
    .map(([control, info]) =>
      mergeDepth(
        {
          id: String(control),
          label: `Control ${control}: ${info.name}`,
          group: `IG${ig} scope`,
          detail: `${info.inScope} of ${info.total} safeguards in IG${ig}`,
          defaultQuarter: quarterFor(control),
          link: `../frameworks/cis/?q=${control}.`,
        },
        depth?.[String(control)],
      ),
    );
}

export interface VcisoTask {
  task: string;
  description: string;
  hours: number;
  package: 'Small' | 'Medium' | 'Large';
  quarter: string;
}

const PACKAGE_RANK = { Small: 1, Medium: 2, Large: 3 } as const;

/** vCISO engagement template; packages are cumulative (Large includes all). */
export function vcisoPlan(tasks: VcisoTask[], pkg: 'Small' | 'Medium' | 'Large'): RoadmapTask[] {
  const quarterMap: Record<string, Quarter> = {
    Onboarding: 'Onboarding',
    'First Quarter': 'Q1',
    'Second Quarter': 'Q2',
    'Third Quarter': 'Q3',
    'Fourth Quarter': 'Q4',
  };
  return tasks
    .filter((task) => PACKAGE_RANK[task.package] <= PACKAGE_RANK[pkg])
    .map((task, index) => ({
      id: `v${index}`,
      label: task.task,
      group: `${task.package} package`,
      detail: task.description,
      defaultQuarter: quarterMap[task.quarter] ?? 'Q1',
      hours: task.hours,
    }));
}

/**
 * One task per assessment gap, basics first. A gap is any applicable question
 * that is not satisfied: unanswered or "no". "N/A" and compensating-control
 * ("alt") answers are not gaps, matching the assessment scoring.
 */
export function gapsPlan(assessment: AssessmentData, answers: Answers): RoadmapTask[] {
  const tierQuarter: Record<string, Quarter> = { basic: 'Q1', intermediate: 'Q2', advanced: 'Q3' };
  const groupNames = new Map(assessment.categories.map((c) => [c.id, c.name]));
  const csfRef = (refs: string[]): string | undefined => {
    for (const r of refs) {
      const m = r.match(/\b([A-Z]{2}\.[A-Z]{2}-\d{2})\b/);
      if (m) return m[1];
    }
    return undefined;
  };
  return assessment.questions
    .filter((question) => {
      const answer = answers[question.id];
      return answer !== 'yes' && answer !== 'alt' && answer !== 'na';
    })
    .map((question) => {
      const cisRef = question.references.map(cisControlFromReference).find((c) => c !== null);
      const csf = csfRef(question.references);
      const link = cisRef
        ? `../frameworks/cis/?q=${cisRef}.`
        : csf
          ? `../frameworks/nist-csf/?q=${csf.toLowerCase()}`
          : undefined;
      return {
        id: question.id,
        label: question.text,
        group: groupNames.get(question.group) ?? question.group,
        detail: `${question.tier} tier gap`,
        defaultQuarter: tierQuarter[question.tier] ?? 'Q4',
        ...(link ? { link } : {}),
      };
    });
}

export interface ProgramGoal {
  id: string;
  title: string;
  phase: Quarter;
  group: string;
  objective: string;
  why: string;
  standards: StandardRef[];
  kpis: string[];
  milestones: string[];
}

/** Link a goal to the most relevant framework page from its standard mappings. */
function standardLink(standards: StandardRef[]): string | undefined {
  const csf = standards.find((s) => /csf/i.test(s.framework));
  if (csf) return `../frameworks/nist-csf/?q=${csf.ref.toLowerCase()}`;
  const cis = standards.find((s) => /cis/i.test(s.framework));
  if (cis) {
    const num = cis.ref.match(/\d+/)?.[0];
    if (num) return `../frameworks/cis/?q=${num}.`;
  }
  return undefined;
}

/**
 * The curated, comprehensive information security program: consolidated goals,
 * each with an objective, KPIs, mapped standards, and milestone tasks.
 */
export function programPlan(program: { goals: ProgramGoal[] }): RoadmapTask[] {
  return program.goals.map((goal) => {
    const link = standardLink(goal.standards);
    return {
      id: goal.id,
      label: goal.title,
      group: goal.group,
      detail: goal.objective,
      defaultQuarter: goal.phase,
      objective: goal.objective,
      why: goal.why,
      kpis: goal.kpis,
      milestones: goal.milestones,
      standards: goal.standards,
      ...(link ? { link } : {}),
    };
  });
}

export function totalHours(tasks: RoadmapTask[]): number {
  return Math.round(tasks.reduce((sum, task) => sum + (task.hours ?? 0), 0) * 10) / 10;
}

export function planProgress(tasks: RoadmapTask[], state: PlanState): { done: number; total: number } {
  const done = tasks.filter((task) => state[task.id]?.status === 'done').length;
  return { done, total: tasks.length };
}

export function nextStatus(status: TaskStatus): TaskStatus {
  return STATUS_CYCLE[(STATUS_CYCLE.indexOf(status) + 1) % STATUS_CYCLE.length];
}

/** Task count and estimated hours per quarter, using each task's current or default quarter. */
export function planLoad(tasks: RoadmapTask[], state: PlanState): Record<Quarter, { count: number; hours: number }> {
  const load = {} as Record<Quarter, { count: number; hours: number }>;
  for (const quarter of QUARTERS) load[quarter] = { count: 0, hours: 0 };
  for (const task of tasks) {
    const quarter = state[task.id]?.quarter ?? task.defaultQuarter;
    load[quarter].count += 1;
    load[quarter].hours += task.hours ?? 0;
  }
  for (const quarter of QUARTERS) load[quarter].hours = Math.round(load[quarter].hours * 10) / 10;
  return load;
}

export function statusCounts(tasks: RoadmapTask[], state: PlanState): Record<TaskStatus, number> {
  const counts: Record<TaskStatus, number> = { planned: 0, 'in-progress': 0, done: 0 };
  for (const task of tasks) counts[state[task.id]?.status ?? 'planned'] += 1;
  return counts;
}

export interface Maturity {
  percent: number;
  level: string;
}

const MATURITY_LEVELS: { min: number; label: string }[] = [
  { min: 0, label: 'Initial' },
  { min: 20, label: 'Developing' },
  { min: 40, label: 'Defined' },
  { min: 60, label: 'Managed' },
  { min: 80, label: 'Optimizing' },
];

/**
 * Roll the plan's status up into a single maturity indicator: each goal scores
 * done = 1, in progress = 0.5, planned = 0. The percentage maps to a CMMI-style
 * level so a whole program reads as one number.
 */
export function programMaturity(tasks: RoadmapTask[], state: PlanState): Maturity {
  if (tasks.length === 0) return { percent: 0, level: 'Initial' };
  let score = 0;
  for (const task of tasks) {
    const status = state[task.id]?.status ?? 'planned';
    score += status === 'done' ? 1 : status === 'in-progress' ? 0.5 : 0;
  }
  const percent = Math.round((score / tasks.length) * 100);
  const level = [...MATURITY_LEVELS].reverse().find((l) => percent >= l.min)?.label ?? 'Initial';
  return { percent, level };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Map a quarter to a calendar range from a program start month ("YYYY-MM"). */
export function quarterDateRange(start: string, quarter: Quarter): string {
  if (quarter === 'Onboarding') return 'Setup';
  const offset: Record<Exclude<Quarter, 'Onboarding'>, number> = { Q1: 0, Q2: 3, Q3: 6, Q4: 9 };
  const [year, month] = start.split('-').map(Number);
  if (!year || !month) return '';
  const startIndex = month - 1 + offset[quarter as Exclude<Quarter, 'Onboarding'>];
  const endIndex = startIndex + 2;
  const sy = year + Math.floor(startIndex / 12);
  const ey = year + Math.floor(endIndex / 12);
  const sLabel = `${MONTHS[((startIndex % 12) + 12) % 12]} ${sy}`;
  const eLabel = `${MONTHS[((endIndex % 12) + 12) % 12]} ${ey}`;
  return `${sLabel} to ${eLabel}`;
}

const csvEscape = (value: string): string =>
  /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

export function planToCsv(tasks: RoadmapTask[], state: PlanState): string {
  const rows = [
    ['id', 'task', 'group', 'quarter', 'status', 'owner', 'target_date', 'notes', 'standards', 'kpis', 'hours'],
  ];
  for (const task of tasks) {
    const s = state[task.id] ?? { quarter: task.defaultQuarter, status: 'planned' };
    rows.push([
      task.id,
      task.label,
      task.group,
      s.quarter,
      s.status,
      s.owner ?? '',
      s.date ?? '',
      s.note ?? '',
      (task.standards ?? []).map((ref) => `${ref.framework} ${ref.ref}`).join('; '),
      (task.kpis ?? []).join('; '),
      task.hours != null ? String(task.hours) : '',
    ]);
  }
  return rows.map((row) => row.map(csvEscape).join(',')).join('\n') + '\n';
}
