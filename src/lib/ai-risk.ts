/**
 * AI Use Case Risk Tiering: deterministic scoring over the rubric in
 * src/data/ai-risk-tiering.json. Anchored options only; the score is never
 * self-declared. Some options carry a minTier gate that forces the final tier
 * up regardless of the total score (e.g. regulated data is always High).
 */

export type TierId = 'low' | 'medium' | 'high';

export interface RubricOption {
  value: string;
  points: number;
  label: string;
  detail: string;
  minTier?: TierId;
  gateReason?: string;
}

export interface RubricQuestion {
  id: string;
  prompt: string;
  help: string;
  options: RubricOption[];
}

export interface TierControl {
  text: string;
  refs: string[];
}

export interface Tier {
  id: TierId;
  label: string;
  scoreMin: number;
  scoreMax: number;
  summary: string;
  reviewPath: { name: string; description: string; steps: string[] };
  controls: TierControl[];
  policySnippet: string;
}

export interface Rubric {
  meta: {
    title: string;
    version: string;
    maxScore: number;
    sources: { name: string; url: string }[];
  };
  questions: RubricQuestion[];
  tiers: Tier[];
}

/** question id -> selected option value */
export type Answers = Record<string, string>;

export interface TierResult {
  score: number;
  maxScore: number;
  /** Tier the raw score lands in, before gates. */
  scoreTier: Tier;
  /** Final tier after applying option gates. */
  tier: Tier;
  /** Reasons from gate options that forced the tier to (at least) the final tier. */
  gateReasons: string[];
}

const TIER_ORDER: TierId[] = ['low', 'medium', 'high'];

export function tierRank(id: TierId): number {
  return TIER_ORDER.indexOf(id);
}

export function isComplete(rubric: Rubric, answers: Answers): boolean {
  return rubric.questions.every((q) => q.options.some((o) => o.value === answers[q.id]));
}

export function scoreUseCase(rubric: Rubric, answers: Answers): TierResult {
  let score = 0;
  let maxScore = 0;
  let floor: TierId = 'low';
  const gates: { tier: TierId; reason: string }[] = [];

  for (const question of rubric.questions) {
    maxScore += Math.max(...question.options.map((o) => o.points));
    const selected = question.options.find((o) => o.value === answers[question.id]);
    if (!selected) throw new Error(`Missing answer for question "${question.id}"`);
    score += selected.points;
    if (selected.minTier) {
      gates.push({ tier: selected.minTier, reason: selected.gateReason ?? '' });
      if (tierRank(selected.minTier) > tierRank(floor)) floor = selected.minTier;
    }
  }

  const scoreTier = rubric.tiers.find((t) => score >= t.scoreMin && score <= t.scoreMax);
  if (!scoreTier) throw new Error(`No tier covers score ${score}`);

  const finalId: TierId = tierRank(floor) > tierRank(scoreTier.id) ? floor : scoreTier.id;
  const tier = rubric.tiers.find((t) => t.id === finalId)!;

  // Surface only the gates that hold the final tier up (at or above the score
  // tier alone); lower gates are redundant noise in the rationale.
  const gateReasons = gates
    .filter((g) => tierRank(g.tier) >= tierRank(scoreTier.id) && g.tier === finalId)
    .map((g) => g.reason)
    .filter((reason, i, all) => reason && all.indexOf(reason) === i);

  return { score, maxScore, scoreTier, tier, gateReasons };
}

/** Cumulative controls: a tier inherits everything below it. */
export function controlsForTier(rubric: Rubric, tierId: TierId): { tier: Tier; controls: TierControl[] }[] {
  const rank = tierRank(tierId);
  return rubric.tiers
    .filter((t) => tierRank(t.id) <= rank)
    .map((t) => ({ tier: t, controls: t.controls }));
}

/** Validate rubric integrity; returns human-readable problems (empty = valid). */
export function validateRubric(rubric: Rubric): string[] {
  const errors: string[] = [];
  const tierIds = rubric.tiers.map((t) => t.id);

  if (tierIds.join(',') !== TIER_ORDER.join(',')) {
    errors.push(`Tiers must be exactly ${TIER_ORDER.join(', ')} in order, got ${tierIds.join(', ')}`);
  }

  let expectedMin = 0;
  for (const tier of rubric.tiers) {
    if (tier.scoreMin !== expectedMin) {
      errors.push(`[${tier.id}] scoreMin ${tier.scoreMin}, expected ${expectedMin} (bands must be contiguous)`);
    }
    if (tier.scoreMax < tier.scoreMin) errors.push(`[${tier.id}] scoreMax below scoreMin`);
    expectedMin = tier.scoreMax + 1;
  }

  let maxScore = 0;
  for (const question of rubric.questions) {
    const where = `[${question.id}]`;
    const points = question.options.map((o) => o.points).sort((a, b) => a - b);
    if (points.join(',') !== '0,1,2,3') {
      errors.push(`${where} options must carry points 0,1,2,3 exactly, got ${points.join(',')}`);
    }
    maxScore += 3;
    const values = new Set(question.options.map((o) => o.value));
    if (values.size !== question.options.length) errors.push(`${where} duplicate option values`);
    for (const option of question.options) {
      if (option.minTier && !TIER_ORDER.includes(option.minTier)) {
        errors.push(`${where}.${option.value} invalid minTier "${option.minTier}"`);
      }
      if (option.minTier && option.minTier !== 'low' && !option.gateReason?.trim()) {
        errors.push(`${where}.${option.value} gate needs a gateReason`);
      }
    }
  }

  if (rubric.meta.maxScore !== maxScore) {
    errors.push(`meta.maxScore ${rubric.meta.maxScore} does not match computed ${maxScore}`);
  }
  const last = rubric.tiers[rubric.tiers.length - 1];
  if (last && last.scoreMax !== maxScore) {
    errors.push(`[${last.id}] scoreMax ${last.scoreMax} must equal max score ${maxScore}`);
  }

  const text = JSON.stringify(rubric);
  if (text.includes('—')) errors.push('Rubric contains an em dash');

  return errors;
}
