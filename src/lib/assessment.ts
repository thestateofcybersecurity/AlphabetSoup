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

/** Extract a CIS control number from a reference string like "CIS Control 11 - Data Recovery". */
export function cisControlFromReference(reference: string): number | null {
  const match = reference.match(/CIS Control (\d{1,2})/i);
  if (!match) return null;
  const control = Number(match[1]);
  return control >= 1 && control <= 18 ? control : null;
}
