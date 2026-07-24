/**
 * Team Skills Matrix and Growth Planner: deterministic coverage, bus-factor,
 * growth-plan, and hiring-need math over the competency model in
 * src/data/skills-matrix.json (which mirrors the ten scorecard demands). All
 * functions are pure; the roster lives only in the browser.
 */

export interface Level {
  value: number;
  label: string;
  hint: string;
}
export interface Resource {
  label: string;
  href: string;
}
export interface Competency {
  id: string;
  name: string;
  blurb: string;
  resources: Resource[];
}
export interface SkillsData {
  meta: { title: string; version: string; note: string; sources: { name: string; url: string }[] };
  levels: Level[];
  proficientLevel: number;
  competencies: Competency[];
}

/** A team member and their 0-to-max rating per competency id. */
export interface Member {
  id: string;
  name: string;
  ratings: Record<string, number>;
}

export function maxLevel(data: SkillsData): number {
  return data.levels.length - 1;
}

/** A member's rating for a competency, clamped to the scale, default 0. */
export function rating(data: SkillsData, member: Member, competencyId: string): number {
  const raw = member.ratings[competencyId] ?? 0;
  return Math.max(0, Math.min(maxLevel(data), Math.round(raw)));
}

export interface CoverageRow {
  competency: Competency;
  proficient: number;
  average: number;
  priority: boolean;
  busFactor: boolean;
}

/** Per-competency coverage: how many are proficient, the average, and whether
 * it is a single point of failure (one or zero proficient people). */
export function coverage(data: SkillsData, members: Member[], priorities: ReadonlySet<string>): CoverageRow[] {
  return data.competencies.map((competency) => {
    const ratings = members.map((m) => rating(data, m, competency.id));
    const proficient = ratings.filter((r) => r >= data.proficientLevel).length;
    const average = members.length === 0 ? 0 : Math.round((ratings.reduce((a, b) => a + b, 0) / members.length) * 10) / 10;
    return {
      competency,
      proficient,
      average,
      priority: priorities.has(competency.id),
      busFactor: members.length > 0 && proficient <= 1,
    };
  });
}

function priorityFirst(a: CoverageRow, b: CoverageRow): number {
  return Number(b.priority) - Number(a.priority) || a.proficient - b.proficient;
}

/** Competencies that are single points of failure, priority ones first. */
export function busFactorWarnings(
  data: SkillsData,
  members: Member[],
  priorities: ReadonlySet<string>,
): CoverageRow[] {
  return coverage(data, members, priorities)
    .filter((row) => row.busFactor)
    .sort(priorityFirst);
}

export interface GapRow {
  competency: Competency;
  current: number;
  target: number;
  gap: number;
  priority: boolean;
}

/** One member's growth plan: competencies below proficient, priority-first then largest gap. */
export function growthPlan(data: SkillsData, member: Member, priorities: ReadonlySet<string>): GapRow[] {
  const target = data.proficientLevel;
  return data.competencies
    .map((competency) => {
      const current = rating(data, member, competency.id);
      return { competency, current, target, gap: target - current, priority: priorities.has(competency.id) };
    })
    .filter((row) => row.gap > 0)
    .sort((a, b) => Number(b.priority) - Number(a.priority) || b.gap - a.gap || a.competency.name.localeCompare(b.competency.name));
}

export interface HiringNeed {
  competency: Competency;
  proficient: number;
  priority: boolean;
  reason: string;
}

/** What the next hire should bring: weakest coverage on the priorities, worst first. */
export function hiringProfile(data: SkillsData, members: Member[], priorities: ReadonlySet<string>): HiringNeed[] {
  return coverage(data, members, priorities)
    .filter((row) => row.busFactor || (row.priority && row.proficient < 2))
    .sort(priorityFirst)
    .map((row) => ({
      competency: row.competency,
      proficient: row.proficient,
      priority: row.priority,
      reason:
        row.proficient === 0
          ? 'No one on the team is proficient here yet.'
          : `Only one person is proficient here${row.priority ? ', and it is a stated priority' : ''}.`,
    }));
}

/** Overall resilient-coverage percentage: competencies with at least two proficient people. */
export function resilientCoverage(data: SkillsData, members: Member[]): number {
  if (data.competencies.length === 0) return 0;
  const resilient = data.competencies.filter(
    (c) => members.filter((m) => rating(data, m, c.id) >= data.proficientLevel).length >= 2,
  ).length;
  return Math.round((resilient / data.competencies.length) * 100);
}

/** CSV of the full member-by-competency matrix. */
export function matrixCsv(data: SkillsData, members: Member[]): string {
  const cell = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const header = ['Member', ...data.competencies.map((c) => c.name)];
  const lines = [header.map(cell).join(',')];
  for (const member of members) {
    lines.push([member.name || 'Unnamed', ...data.competencies.map((c) => String(rating(data, member, c.id)))].map(cell).join(','));
  }
  return lines.join('\n');
}
