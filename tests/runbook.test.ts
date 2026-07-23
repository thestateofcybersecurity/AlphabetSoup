import { describe, expect, it } from 'vitest';
import dataRaw from '../src/data/runbooks.json';
import {
  emptyProfile,
  FALLBACK,
  fillScenario,
  fillTemplate,
  toMarkdown,
  usedFields,
  type OrgProfile,
  type RunbookData,
  type Scenario,
} from '../src/lib/runbook';

const data = dataRaw as RunbookData;

const profile: OrgProfile = {
  org: 'Acme Corp',
  size: 'mid-size',
  cloud: 'AWS and Microsoft 365',
  mdr: 'Arctic Wolf',
  dataTypes: 'PII and cardholder data',
  process: 'online order fulfillment',
};

describe('fillTemplate', () => {
  it('substitutes known placeholders', () => {
    expect(fillTemplate('Alert {org} about {process}.', profile)).toBe('Alert Acme Corp about online order fulfillment.');
  });
  it('uses the generic fallback for blank fields', () => {
    const blank = { ...profile, mdr: '  ' };
    expect(fillTemplate('Call {mdr} now.', blank)).toBe(`Call ${FALLBACK.mdr} now.`);
  });
  it('leaves unknown tokens untouched', () => {
    expect(fillTemplate('Keep {sla} and {org}.', profile)).toBe('Keep {sla} and Acme Corp.');
  });
});

describe('fillScenario', () => {
  it('deeply fills every string and leaves no known placeholders behind', () => {
    const raw = data.scenarios[0];
    const filled = fillScenario(raw, profile);
    const blob = JSON.stringify(filled);
    for (const key of Object.keys(profile)) expect(blob, key).not.toContain(`{${key}}`);
    expect(filled.phases).toHaveLength(raw.phases.length);
    expect(filled.injects).toHaveLength(raw.injects.length);
  });
  it('does not mutate the source scenario', () => {
    const raw = data.scenarios[0];
    const before = JSON.stringify(raw);
    fillScenario(raw, profile);
    expect(JSON.stringify(raw)).toBe(before);
  });
});

describe('usedFields', () => {
  it('reports only referenced profile keys', () => {
    const s = {
      id: 'x',
      name: 'X',
      tagline: 't',
      summary: 'Protect {process}.',
      phases: [{ name: 'Contain', steps: ['Call {mdr}.'] }],
      roles: [],
      escalation: [],
      decisionPoints: [],
      commsTemplates: [],
      injects: [],
      gapQuestions: [],
    } as unknown as Scenario;
    expect(usedFields(s).sort()).toEqual(['mdr', 'process']);
  });
});

describe('toMarkdown', () => {
  it('includes the org, all sections, and every inject', () => {
    const filled = fillScenario(data.scenarios[0], profile);
    const md = toMarkdown(filled, profile);
    expect(md).toContain('# ' + filled.name);
    expect(md).toContain('Prepared for Acme Corp.');
    expect(md).toContain('## Response runbook');
    expect(md).toContain('## Tabletop exercise');
    expect(md).toContain('## Gap questions to answer first');
    for (const inj of filled.injects) expect(md).toContain(inj.title);
  });
  it('falls back to a generic org label when name is blank', () => {
    const md = toMarkdown(fillScenario(data.scenarios[0], emptyProfile()), emptyProfile());
    expect(md).toContain(`Prepared for ${FALLBACK.org}.`);
  });
});

describe('runbooks.json data integrity', () => {
  const PHASES = ['Detect and triage', 'Contain', 'Eradicate', 'Recover', 'Post-incident review'];
  const AUDIENCES = ['Employees', 'Customers', 'Executives and board', 'Regulators'];
  const KNOWN = new Set(['org', 'size', 'cloud', 'mdr', 'dataTypes', 'process']);

  it('has 5 scenarios with unique ids', () => {
    expect(data.scenarios).toHaveLength(5);
    expect(new Set(data.scenarios.map((s) => s.id)).size).toBe(5);
  });

  it('each scenario has the five named phases and four comms audiences', () => {
    for (const s of data.scenarios) {
      expect(s.phases.map((p) => p.name), s.id).toEqual(PHASES);
      expect(s.commsTemplates.map((c) => c.audience), s.id).toEqual(AUDIENCES);
      expect(s.injects.length, s.id).toBeGreaterThanOrEqual(5);
      expect(s.injects.length, s.id).toBeLessThanOrEqual(7);
    }
  });

  it('has no em dashes and only known placeholders', () => {
    for (const s of data.scenarios) {
      const blob = JSON.stringify(s);
      expect(blob, s.id).not.toMatch(/—/);
      for (const token of blob.match(/\{(\w+)\}/g) ?? []) {
        expect(KNOWN.has(token.slice(1, -1)), `${s.id}: ${token}`).toBe(true);
      }
    }
  });
});
