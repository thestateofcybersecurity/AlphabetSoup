/**
 * Runbook and Tabletop Generator: a small deterministic template engine over the
 * scenario library in src/data/runbooks.json. An org profile (six fields) is
 * substituted into scenario text to produce a tailored runbook skeleton, a
 * tabletop script, and gap questions. All functions are pure and testable.
 */

export interface OrgProfile {
  org: string;
  size: string;
  cloud: string;
  mdr: string;
  dataTypes: string;
  process: string;
}

export type ProfileKey = keyof OrgProfile;

export interface Phase {
  name: string;
  steps: string[];
}
export interface Role {
  role: string;
  focus: string;
}
export interface CommsTemplate {
  audience: string;
  draft: string;
}
export interface Inject {
  time: string;
  title: string;
  detail: string;
  facilitatorNote: string;
  expectedAction: string;
}
export interface Scenario {
  id: string;
  name: string;
  tagline: string;
  summary: string;
  phases: Phase[];
  roles: Role[];
  escalation: string[];
  decisionPoints: string[];
  commsTemplates: CommsTemplate[];
  injects: Inject[];
  gapQuestions: string[];
}
export interface RunbookData {
  meta: { title: string; version: string; note: string; sources: { name: string; url: string }[] };
  scenarios: Scenario[];
}

/** Generic noun-phrase fallbacks so text still reads when a field is left blank. */
export const FALLBACK: Record<ProfileKey, string> = {
  org: 'our organization',
  size: 'our size',
  cloud: 'our environment',
  mdr: 'our MDR partner',
  dataTypes: 'regulated data',
  process: 'our key business process',
};

export const PROFILE_FIELDS: { key: ProfileKey; label: string; placeholder: string }[] = [
  { key: 'org', label: 'Organization name', placeholder: 'e.g. Acme Corp' },
  { key: 'size', label: 'Size', placeholder: 'e.g. mid-size (about 800 staff)' },
  { key: 'cloud', label: 'Cloud and tech stack', placeholder: 'e.g. AWS and Microsoft 365' },
  { key: 'mdr', label: 'MDR or SOC partner', placeholder: 'e.g. Arctic Wolf, or in-house SOC' },
  { key: 'dataTypes', label: 'Regulated data held', placeholder: 'e.g. PII, PHI, cardholder data' },
  { key: 'process', label: 'Key business process', placeholder: 'e.g. online order fulfillment' },
];

const KEYS = PROFILE_FIELDS.map((f) => f.key);

export function emptyProfile(): OrgProfile {
  return { org: '', size: '', cloud: '', mdr: '', dataTypes: '', process: '' };
}

/** Replace every {key} token with the profile value, or its generic fallback. */
export function fillTemplate(text: string, profile: OrgProfile): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => {
    if (!KEYS.includes(key as ProfileKey)) return match;
    const value = (profile[key as ProfileKey] ?? '').trim();
    return value || FALLBACK[key as ProfileKey];
  });
}

const fillList = (items: string[], p: OrgProfile): string[] => items.map((t) => fillTemplate(t, p));

/** A deep copy of the scenario with every string filled from the profile. */
export function fillScenario(scenario: Scenario, profile: OrgProfile): Scenario {
  return {
    ...scenario,
    tagline: fillTemplate(scenario.tagline, profile),
    summary: fillTemplate(scenario.summary, profile),
    phases: scenario.phases.map((ph) => ({ name: ph.name, steps: fillList(ph.steps, profile) })),
    roles: scenario.roles.map((r) => ({ role: r.role, focus: fillTemplate(r.focus, profile) })),
    escalation: fillList(scenario.escalation, profile),
    decisionPoints: fillList(scenario.decisionPoints, profile),
    commsTemplates: scenario.commsTemplates.map((c) => ({ audience: c.audience, draft: fillTemplate(c.draft, profile) })),
    injects: scenario.injects.map((i) => ({
      time: i.time,
      title: fillTemplate(i.title, profile),
      detail: fillTemplate(i.detail, profile),
      facilitatorNote: fillTemplate(i.facilitatorNote, profile),
      expectedAction: fillTemplate(i.expectedAction, profile),
    })),
    gapQuestions: fillList(scenario.gapQuestions, profile),
  };
}

/** Which profile fields the raw scenario actually references (before filling). */
export function usedFields(scenario: Scenario): ProfileKey[] {
  const blob = JSON.stringify(scenario);
  return KEYS.filter((k) => blob.includes(`{${k}}`));
}

/** Markdown export of a filled scenario: runbook, tabletop, and gap questions. */
export function toMarkdown(filled: Scenario, profile: OrgProfile): string {
  const org = (profile.org ?? '').trim() || FALLBACK.org;
  const lines: string[] = [];
  lines.push(`# ${filled.name} runbook and tabletop`, '', `Prepared for ${org}.`, '', `_${filled.summary}_`, '');

  lines.push('## Response runbook', '');
  lines.push('### Roles');
  for (const r of filled.roles) lines.push(`- **${r.role}:** ${r.focus}`);
  lines.push('', '### Escalation ladder');
  for (const e of filled.escalation) lines.push(`- ${e}`);
  lines.push('', '### Phases');
  for (const ph of filled.phases) {
    lines.push(`**${ph.name}**`);
    for (const s of ph.steps) lines.push(`- ${s}`);
    lines.push('');
  }
  lines.push('### Decision points');
  for (const d of filled.decisionPoints) lines.push(`- ${d}`);
  lines.push('', '### Communications drafts');
  for (const c of filled.commsTemplates) lines.push(`**${c.audience}**`, '', c.draft, '');

  lines.push('## Tabletop exercise', '');
  filled.injects.forEach((i, index) => {
    lines.push(`### Inject ${index + 1} (${i.time}): ${i.title}`);
    lines.push(i.detail, '', `- Facilitator: ${i.facilitatorNote}`, `- Strong response: ${i.expectedAction}`, '');
  });

  lines.push('## Gap questions to answer first', '');
  for (const q of filled.gapQuestions) lines.push(`- ${q}`);

  return lines.join('\n');
}
