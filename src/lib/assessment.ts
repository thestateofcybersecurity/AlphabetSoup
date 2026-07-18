export type Tier = 'basic' | 'intermediate' | 'advanced';

export interface AssessmentQuestion {
  id: string;
  text: string;
  tier: Tier;
  group: string;
  references: string[];
}

export interface AssessmentCategory {
  id: string;
  name: string;
}

export interface AssessmentData {
  categories: AssessmentCategory[];
  questions: AssessmentQuestion[];
}

export type Answers = Record<string, 'yes' | 'no'>;

export interface GroupScore {
  id: string;
  name: string;
  yes: number;
  total: number;
  percent: number;
}

export interface AssessmentResult {
  answered: number;
  total: number;
  overallPercent: number;
  tierPercents: Record<Tier, number>;
  groups: GroupScore[];
}

const pct = (yes: number, total: number): number => (total === 0 ? 0 : Math.round((yes / total) * 100));

export function scoreAssessment(data: AssessmentData, answers: Answers): AssessmentResult {
  const answered = data.questions.filter((q) => answers[q.id] === 'yes' || answers[q.id] === 'no').length;
  const yesOf = (qs: AssessmentQuestion[]) => qs.filter((q) => answers[q.id] === 'yes').length;

  const tierPercents = {} as Record<Tier, number>;
  for (const tier of ['basic', 'intermediate', 'advanced'] as Tier[]) {
    const qs = data.questions.filter((q) => q.tier === tier);
    tierPercents[tier] = pct(yesOf(qs), qs.length);
  }

  const groups: GroupScore[] = data.categories.map((category) => {
    const qs = data.questions.filter((q) => q.group === category.id);
    const yes = yesOf(qs);
    return { id: category.id, name: category.name, yes, total: qs.length, percent: pct(yes, qs.length) };
  });

  return {
    answered,
    total: data.questions.length,
    overallPercent: pct(yesOf(data.questions), data.questions.length),
    tierPercents,
    groups,
  };
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
      blurb: 'Significant gaps a ransomware crew would find quickly. Start with backups, patching, and access management.',
    };
  }
  return {
    label: 'High risk',
    blurb: 'Little standing between you and a bad week. Work through the basic tier top to bottom.',
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

/** A generated assessment covering every CIS v8 IG1 safeguard as a yes/no check. */
export function cisIg1Assessment(
  cis: Record<string, CisLikeEntry>,
  igMap: Record<string, number>,
): AssessmentData {
  const ids = Object.keys(cis)
    .filter((id) => igMap[id] === 1)
    .sort((a, b) => {
      const [a1, a2] = a.split('.').map(Number);
      const [b1, b2] = b.split('.').map(Number);
      return a1 - b1 || a2 - b2;
    });
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
    tier: 'basic',
    group: String(cis[id].control),
    references: [`CIS Safeguard ${id}: ${cis[id].title}`],
  }));
  return { categories, questions };
}
