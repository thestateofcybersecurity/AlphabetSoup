/**
 * Regulatory Applicability Mapper: deterministic rule evaluation over the
 * curated regulation dataset in src/data/regulations.json. A profile (the user's
 * answers to a fixed questionnaire) is tested against each regulation's triggers;
 * a regulation applies if any trigger fires. Everything is pure and runs in the
 * browser. This is an educational mapping, never a legal determination.
 */

export interface Option {
  id: string;
  label: string;
}
export interface Question {
  id: string;
  label: string;
  help?: string;
  options: Option[];
}
export interface Trigger {
  /** questionId -> option ids; fires when every key intersects the profile. */
  condition: Record<string, string[]>;
  because: string;
}
export interface Regulation {
  id: string;
  name: string;
  short: string;
  enforcer: string;
  appliesTo: string;
  triggers: Trigger[];
  obligations: string[];
  first90: string[];
  sources: { name: string; url: string }[];
  caveat: string;
}
export interface RegData {
  meta: { title: string; version: string; note: string; sources: { name: string; url: string }[] };
  questions: Question[];
  regulations: Regulation[];
}

/** A profile maps each question id to the set of chosen option ids. */
export type Profile = Record<string, readonly string[]>;

function has(profile: Profile, questionId: string, options: readonly string[]): boolean {
  const chosen = profile[questionId];
  if (!chosen || chosen.length === 0) return false;
  const set = new Set(chosen);
  return options.some((o) => set.has(o));
}

/** A trigger fires when, for every question in its condition, the profile intersects. */
export function triggerFires(trigger: Trigger, profile: Profile): boolean {
  const keys = Object.keys(trigger.condition);
  if (keys.length === 0) return false;
  return keys.every((key) => has(profile, key, trigger.condition[key]));
}

export interface ApplicableRegulation {
  regulation: Regulation;
  reasons: string[];
}

/** Regulations whose triggers fire for the profile, each with its reasons. */
export function applicable(data: RegData, profile: Profile): ApplicableRegulation[] {
  const out: ApplicableRegulation[] = [];
  for (const regulation of data.regulations) {
    const reasons = regulation.triggers.filter((t) => triggerFires(t, profile)).map((t) => t.because);
    if (reasons.length > 0) out.push({ regulation, reasons: [...new Set(reasons)] });
  }
  return out;
}

export interface PlanItem {
  action: string;
  regulations: string[];
}

/**
 * A combined first-90-days plan across the applicable regulations. Identical
 * actions are merged and tagged with every regulation that calls for them.
 */
export function combinedPlan(applicableRegs: ApplicableRegulation[]): PlanItem[] {
  const byAction = new Map<string, Set<string>>();
  const order: string[] = [];
  for (const { regulation } of applicableRegs) {
    for (const action of regulation.first90) {
      const key = action.trim();
      if (!byAction.has(key)) {
        byAction.set(key, new Set());
        order.push(key);
      }
      byAction.get(key)!.add(regulation.short);
    }
  }
  // Actions shared by more regulations come first (highest leverage).
  return order
    .map((action) => ({ action, regulations: [...byAction.get(action)!] }))
    .sort((a, b) => b.regulations.length - a.regulations.length);
}

/** Count of profile selections, to distinguish "nothing entered" from "no matches". */
export function profileSize(profile: Profile): number {
  return Object.values(profile).reduce((n, arr) => n + (arr?.length ?? 0), 0);
}

/** CSV of the combined action plan for export. */
export function planCsv(plan: PlanItem[]): string {
  const cell = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = ['Action,Driven by'];
  for (const item of plan) lines.push([item.action, item.regulations.join(' ')].map(cell).join(','));
  return lines.join('\n');
}
