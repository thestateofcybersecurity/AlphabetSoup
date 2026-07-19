export type Tier = 'basic' | 'intermediate' | 'advanced';

/**
 * Answer states, modeled on the CISA CSET engine:
 * yes = satisfied, no = deficient, na = not applicable (excluded from the
 * denominator), alt = met through a compensating control (counts as satisfied).
 */
export type AnswerState = 'yes' | 'no' | 'na' | 'alt';

export const TIER_ORDER: Tier[] = ['basic', 'intermediate', 'advanced'];

export interface GuidanceLink {
  label: string;
  url: string;
}

export interface AssessmentQuestion {
  id: string;
  text: string;
  tier: Tier;
  group: string;
  references: string[];
  /** Why this matters: the risk the control addresses. */
  why?: string;
  /** How to close the gap: the concrete first step. */
  fix?: string;
  /** Authoritative outbound resources. */
  links?: GuidanceLink[];
}

export interface AssessmentCategory {
  id: string;
  name: string;
  blurb?: string;
}

export interface AssessmentData {
  categories: AssessmentCategory[];
  questions: AssessmentQuestion[];
}

export type Answers = Record<string, AnswerState>;

/**
 * Per-module answer configuration. `states` are the options shown; `satisfied`
 * count toward the score; `excludeFromDenominator` (typically na) drop out of
 * the applicable total, matching CSET's per-model answer options.
 */
export interface AnswerConfig {
  states: AnswerState[];
  satisfied: AnswerState[];
  excludeFromDenominator: AnswerState[];
}

export const defaultAnswerConfig: AnswerConfig = {
  states: ['yes', 'alt', 'na', 'no'],
  satisfied: ['yes', 'alt'],
  excludeFromDenominator: ['na'],
};

/** Per-question working-session annotations, stored apart from answers. */
export interface Annotation {
  note?: string;
  flagged?: boolean;
  reviewed?: boolean;
}
export type Annotations = Record<string, Annotation>;

export interface GroupScore {
  id: string;
  name: string;
  /** Satisfied (yes + alt) count. */
  yes: number;
  /** Applicable count (excludes na). */
  total: number;
  na: number;
  percent: number;
}

export interface AnswerDistribution {
  yes: number;
  alt: number;
  no: number;
  na: number;
  unanswered: number;
}

export interface AssessmentResult {
  answered: number;
  total: number;
  applicable: number;
  overallPercent: number;
  tierPercents: Record<Tier, number>;
  groups: GroupScore[];
  distribution: AnswerDistribution;
  /** Cumulative tier attainment: a tier is true only if it and every lower tier are fully satisfied. */
  tierAttained: Record<Tier, boolean>;
  /** Highest fully-attained tier, or null. */
  attainedTier: Tier | null;
  /** True when nothing applicable was answered, so the score is not meaningful. */
  insufficient: boolean;
}

const pct = (yes: number, total: number): number => (total === 0 ? 0 : Math.round((yes / total) * 100));

const isSatisfied = (state: AnswerState | undefined, config: AnswerConfig): boolean =>
  state !== undefined && config.satisfied.includes(state);

const isApplicable = (state: AnswerState | undefined, config: AnswerConfig): boolean =>
  state === undefined || !config.excludeFromDenominator.includes(state);

function scoreOf(
  qs: AssessmentQuestion[],
  answers: Answers,
  config: AnswerConfig,
): { yes: number; applicable: number; na: number } {
  let yes = 0;
  let applicable = 0;
  let na = 0;
  for (const q of qs) {
    const state = answers[q.id];
    if (!isApplicable(state, config)) {
      na += 1;
      continue;
    }
    applicable += 1;
    if (isSatisfied(state, config)) yes += 1;
  }
  return { yes, applicable, na };
}

/** A tier is complete when every question is answered and every applicable answer is satisfied. */
function tierComplete(
  data: AssessmentData,
  answers: Answers,
  tier: Tier,
  config: AnswerConfig,
): boolean {
  const qs = data.questions.filter((q) => q.tier === tier);
  if (qs.length === 0) return true;
  return qs.every((q) => {
    const state = answers[q.id];
    if (state === undefined) return false;
    if (!isApplicable(state, config)) return true;
    return isSatisfied(state, config);
  });
}

export function scoreAssessment(
  data: AssessmentData,
  answers: Answers,
  config: AnswerConfig = defaultAnswerConfig,
): AssessmentResult {
  const answered = data.questions.filter((q) => answers[q.id] !== undefined).length;

  const tierPercents = {} as Record<Tier, number>;
  const tierAttained = {} as Record<Tier, boolean>;
  let cumulative = true;
  for (const tier of TIER_ORDER) {
    const s = scoreOf(data.questions.filter((q) => q.tier === tier), answers, config);
    tierPercents[tier] = pct(s.yes, s.applicable);
    cumulative = cumulative && tierComplete(data, answers, tier, config);
    tierAttained[tier] = cumulative;
  }
  // A tier with no questions is not a real attainment target. Without this a
  // two-tier assessment (e.g. CMMC L1 basic + L2 intermediate) would report the
  // empty "advanced" tier as reached, because an empty tier is vacuously complete.
  const present = new Set(data.questions.map((q) => q.tier));
  for (const tier of TIER_ORDER) if (!present.has(tier)) tierAttained[tier] = false;

  const overall = scoreOf(data.questions, answers, config);
  // With no applicable answers there is nothing to score; a tier is only
  // "attained" if something applicable was actually satisfied.
  const insufficient = overall.applicable === 0;
  const attainedTier = insufficient
    ? null
    : ([...TIER_ORDER].reverse().find((t) => tierAttained[t]) ?? null);
  if (insufficient) for (const tier of TIER_ORDER) tierAttained[tier] = false;

  const groups: GroupScore[] = data.categories.map((category) => {
    const s = scoreOf(data.questions.filter((q) => q.group === category.id), answers, config);
    return { id: category.id, name: category.name, yes: s.yes, total: s.applicable, na: s.na, percent: pct(s.yes, s.applicable) };
  });

  const distribution: AnswerDistribution = { yes: 0, alt: 0, no: 0, na: 0, unanswered: 0 };
  for (const q of data.questions) {
    const state = answers[q.id];
    if (state === undefined) distribution.unanswered += 1;
    else distribution[state] += 1;
  }

  return {
    answered,
    total: data.questions.length,
    applicable: overall.applicable,
    overallPercent: pct(overall.yes, overall.applicable),
    tierPercents,
    groups,
    distribution,
    tierAttained,
    attainedTier,
    insufficient,
  };
}

/**
 * Ranked areas of concern, mirroring CSET's "suggested areas for improvement":
 * deficient goals sorted by shortfall, and deficient questions ordered basic first.
 */
export function concerns(
  data: AssessmentData,
  answers: Answers,
  config: AnswerConfig = defaultAnswerConfig,
): { goals: GroupScore[]; questions: AssessmentQuestion[] } {
  const { groups } = scoreAssessment(data, answers, config);
  const goals = groups.filter((g) => g.total > 0 && g.percent < 100).sort((a, b) => a.percent - b.percent);
  const rank: Record<Tier, number> = { basic: 0, intermediate: 1, advanced: 2 };
  const questions = data.questions
    .filter((q) => {
      const state = answers[q.id];
      return isApplicable(state, config) && !isSatisfied(state, config);
    })
    .sort((a, b) => rank[a.tier] - rank[b.tier]);
  return { goals, questions };
}

export interface ReadinessBand {
  label: string;
  blurb: string;
}

export function readinessBand(overallPercent: number): ReadinessBand {
  if (overallPercent >= 85) {
    return {
      label: 'Well prepared',
      blurb: 'Strong coverage across the board. Keep exercising the plan and close the last gaps below.',
    };
  }
  if (overallPercent >= 60) {
    return {
      label: 'On the way',
      blurb: 'A solid foundation with real gaps. Prioritize the weakest goals below, basics first.',
    };
  }
  if (overallPercent >= 35) {
    return {
      label: 'Exposed',
      blurb: 'Significant gaps an attacker could exploit quickly. Start with the essentials below: backups, patching, MFA, and access control.',
    };
  }
  return {
    label: 'High risk',
    blurb: 'Little standing between you and a serious incident. Work through the basic tier below, top to bottom.',
  };
}

/* ------------------------------ history ------------------------------- */

export interface Snapshot {
  /** YYYY-MM-DD local date. */
  date: string;
  overall: number;
}

const HISTORY_CAP = 24;

/** Add or update today's snapshot; one per day, oldest dropped past the cap. */
export function recordSnapshot(history: Snapshot[], overall: number, date: string): Snapshot[] {
  const kept = history.filter((snapshot) => snapshot.date !== date);
  const next = [...kept, { date, overall }].sort((a, b) => a.date.localeCompare(b.date));
  return next.slice(-HISTORY_CAP);
}

/** Change since the previous snapshot, or null with fewer than two. */
export function latestDelta(history: Snapshot[]): { delta: number; since: string } | null {
  if (history.length < 2) return null;
  const last = history[history.length - 1];
  const previous = history[history.length - 2];
  return { delta: last.overall - previous.overall, since: previous.date };
}

/** Extract a CIS control number from a reference string like "CIS Control 11 - Data Recovery". */
export function cisControlFromReference(reference: string): number | null {
  const match = reference.match(/CIS Control (\d{1,2})/i);
  if (!match) return null;
  const control = Number(match[1]);
  return control >= 1 && control <= 18 ? control : null;
}

/** Extract a safeguard id from a reference like "CIS Safeguard 1.1: ...". */
export function cisSafeguardFromReference(reference: string): string | null {
  const match = reference.match(/CIS Safeguard (\d{1,2}\.\d{1,2})/i);
  return match ? match[1] : null;
}

/** Lowercase a Title Case phrase while preserving acronym-like tokens (DNS, MFA, IPv6). */
export function sentenceCase(title: string): string {
  return title
    .split(' ')
    .map((word) => (/[A-Z]{2}|\d/.test(word) ? word : word.toLowerCase()))
    .join(' ');
}

interface CisLikeEntry {
  control: number;
  controlName: string;
  title: string;
}

const compareSafeguardIds = (a: string, b: string): number => {
  const [a1, a2] = a.split('.').map(Number);
  const [b1, b2] = b.split('.').map(Number);
  return a1 - b1 || a2 - b2;
};

/** IG level to maturity tier: IG1 is the essential floor, IG3 the most advanced. */
const IG_TIER: Record<number, Tier> = { 1: 'basic', 2: 'intermediate', 3: 'advanced' };

/**
 * A generated assessment over CIS v8 safeguards as yes/no checks. `maxIg` bounds
 * which safeguards are included (cumulative: 1 gives IG1 only, 3 gives all 153),
 * and each safeguard's Implementation Group becomes its maturity tier, so the
 * cumulative tier attainment reads as IG progress.
 */
export function cisControlsAssessment(
  cis: Record<string, CisLikeEntry>,
  igMap: Record<string, number>,
  maxIg = 3,
): AssessmentData {
  const ids = Object.keys(cis)
    .filter((id) => (igMap[id] ?? 3) <= maxIg)
    .sort(compareSafeguardIds);
  const categories: AssessmentCategory[] = [];
  const seen = new Set<number>();
  for (const id of ids) {
    const control = cis[id].control;
    if (!seen.has(control)) {
      seen.add(control);
      categories.push({ id: String(control), name: `Control ${control}: ${cis[id].controlName}` });
    }
  }
  const questions: AssessmentQuestion[] = ids.map((id) => ({
    id,
    text: `Do you ${sentenceCase(cis[id].title)}?`,
    tier: IG_TIER[igMap[id] ?? 3] ?? 'advanced',
    group: String(cis[id].control),
    references: [`CIS Safeguard ${id}: ${cis[id].title}`],
  }));
  return { categories, questions };
}

/** A generated assessment covering every CIS v8 IG1 safeguard as a yes/no check. */
export function cisIg1Assessment(
  cis: Record<string, CisLikeEntry>,
  igMap: Record<string, number>,
): AssessmentData {
  return cisControlsAssessment(cis, igMap, 1);
}

interface CsfLikeEntry {
  function: string;
  functionCode: string;
  category: string;
  categoryCode: string;
  text: string;
}

/** NIST CSF 2.0 functions in canonical order. */
const CSF_FUNCTION_ORDER = ['GV', 'ID', 'PR', 'DE', 'RS', 'RC'];

/**
 * A generated self-assessment over the NIST CSF 2.0 subcategories. Each
 * subcategory outcome (verbatim NIST wording) is a yes/no check grouped by its
 * function; references link back to the plain-English framework pages. CSF has
 * no per-outcome maturity tiers, so every question sits in a single tier.
 */
export function csfAssessment(csf: Record<string, CsfLikeEntry>): AssessmentData {
  const ids = Object.keys(csf).sort((a, b) => {
    const fa = CSF_FUNCTION_ORDER.indexOf(csf[a].functionCode);
    const fb = CSF_FUNCTION_ORDER.indexOf(csf[b].functionCode);
    return fa - fb || a.localeCompare(b);
  });
  const categories: AssessmentCategory[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const code = csf[id].functionCode;
    if (!seen.has(code)) {
      seen.add(code);
      categories.push({ id: code, name: `${csf[id].function} (${code})` });
    }
  }
  const questions: AssessmentQuestion[] = ids.map((id) => ({
    id,
    text: `${csf[id].category}: is this outcome achieved? ${csf[id].text}`,
    tier: 'basic',
    group: csf[id].functionCode,
    references: [`NIST CSF ${id}`],
  }));
  return { categories, questions };
}
