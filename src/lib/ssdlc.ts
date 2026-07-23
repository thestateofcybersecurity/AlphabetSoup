/**
 * Secure SDLC Gap Checker: deterministic maturity scoring and adoption-plan
 * ordering over the practice rubric in src/data/ssdlc.json. Each practice has a
 * four-rung maturity ladder (0 to 3); the user records where they are today.
 * The plan sequences the next step for each gap by leverage-to-friction ratio.
 * All functions are pure.
 */

export type PhaseId = 'design' | 'code' | 'build' | 'test' | 'release' | 'operate';
export type Rating = 'high' | 'medium' | 'low';

export interface Level {
  label: string;
  detail: string;
}
export interface Practice {
  id: string;
  name: string;
  phase: PhaseId;
  why: string;
  leverage: Rating;
  friction: Rating;
  ssdfRef: string;
  levels: Level[];
  engineerNote: string;
}
export interface SsdlcData {
  meta: { title: string; version: string; note: string; sources: { name: string; url: string }[] };
  phases: { id: PhaseId; name: string }[];
  practices: Practice[];
}

export const PHASE_ORDER: PhaseId[] = ['design', 'code', 'build', 'test', 'release', 'operate'];
const PHASE_RANK: Record<PhaseId, number> = { design: 0, code: 1, build: 2, test: 3, release: 4, operate: 5 };

/** The top rung index of a practice's ladder (the mature end state). */
export function maxLevel(practice: Practice): number {
  return practice.levels.length - 1;
}

/** The current level for a practice, clamped to its ladder, defaulting to 0. */
export function currentLevel(practice: Practice, levels: Readonly<Record<string, number>>): number {
  const raw = levels[practice.id] ?? 0;
  return Math.max(0, Math.min(maxLevel(practice), Math.round(raw)));
}

const LEVERAGE_NUM: Record<Rating, number> = { high: 3, medium: 2, low: 1 };
// Low friction is the most adoptable, so it scores highest.
const FRICTION_EASE: Record<Rating, number> = { low: 3, medium: 2, high: 1 };

/** Higher is do-sooner: strong risk reduction that is also easy to adopt. */
export function priorityScore(practice: Practice): number {
  return LEVERAGE_NUM[practice.leverage] * FRICTION_EASE[practice.friction];
}

export interface PhaseScore {
  phase: PhaseId;
  name: string;
  current: number;
  max: number;
  pct: number;
  practices: number;
}

/** Maturity per phase: summed current levels over the achievable maximum. */
export function scoreByPhase(data: SsdlcData, levels: Readonly<Record<string, number>>): PhaseScore[] {
  return data.phases.map((phase) => {
    const inPhase = data.practices.filter((p) => p.phase === phase.id);
    const current = inPhase.reduce((n, p) => n + currentLevel(p, levels), 0);
    const max = inPhase.reduce((n, p) => n + maxLevel(p), 0);
    return {
      phase: phase.id,
      name: phase.name,
      current,
      max,
      pct: max === 0 ? 0 : Math.round((current / max) * 100),
      practices: inPhase.length,
    };
  });
}

/** Overall maturity as a 0 to 100 percentage across every practice. */
export function overallScore(data: SsdlcData, levels: Readonly<Record<string, number>>): number {
  const current = data.practices.reduce((n, p) => n + currentLevel(p, levels), 0);
  const max = data.practices.reduce((n, p) => n + maxLevel(p), 0);
  return max === 0 ? 0 : Math.round((current / max) * 100);
}

export interface PlanItem {
  practice: Practice;
  from: Level;
  to: Level;
  fromIndex: number;
  toIndex: number;
  score: number;
}

/**
 * The sequenced adoption plan: one "next step" per practice not yet at the top,
 * ordered by leverage-to-friction ratio (highest first), then pipeline order.
 */
export function adoptionPlan(data: SsdlcData, levels: Readonly<Record<string, number>>): PlanItem[] {
  return data.practices
    .map((practice) => ({ practice, cur: currentLevel(practice, levels) }))
    .filter(({ practice, cur }) => cur < maxLevel(practice))
    .map(({ practice, cur }) => ({
      practice,
      from: practice.levels[cur],
      to: practice.levels[cur + 1],
      fromIndex: cur,
      toIndex: cur + 1,
      score: priorityScore(practice),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        PHASE_RANK[a.practice.phase] - PHASE_RANK[b.practice.phase] ||
        a.practice.name.localeCompare(b.practice.name),
    );
}

/** CSV of the sequenced adoption plan for export. */
export function planCsv(plan: PlanItem[]): string {
  const header = ['Order', 'Practice', 'Phase', 'Move from', 'Move to', 'Leverage', 'Friction', 'SSDF'];
  const cell = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [header.join(',')];
  plan.forEach((item, index) => {
    lines.push(
      [
        String(index + 1),
        item.practice.name,
        item.practice.phase,
        item.from.label,
        item.to.label,
        item.practice.leverage,
        item.practice.friction,
        item.practice.ssdfRef,
      ]
        .map(cell)
        .join(','),
    );
  });
  return lines.join('\n');
}
