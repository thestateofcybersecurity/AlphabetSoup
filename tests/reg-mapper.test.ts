import { describe, expect, it } from 'vitest';
import dataRaw from '../src/data/regulations.json';
import {
  applicable,
  combinedPlan,
  planCsv,
  profileSize,
  triggerFires,
  type RegData,
  type Regulation,
  type Trigger,
} from '../src/lib/reg-mapper';

const data = dataRaw as RegData;

const reg = (over: Partial<Regulation>): Regulation => ({
  id: 'r',
  name: 'Reg',
  short: 'R',
  enforcer: 'Body',
  appliesTo: 'Someone.',
  triggers: [],
  obligations: ['do a thing'],
  first90: ['first action'],
  sources: [{ name: 'src', url: 'https://example.gov' }],
  caveat: 'a nuance',
  ...over,
});

describe('triggerFires', () => {
  const t: Trigger = { condition: { dataTypes: ['phi'], industry: ['healthcare'] }, because: 'x' };
  it('needs every question in the condition to intersect (AND across keys)', () => {
    expect(triggerFires(t, { dataTypes: ['phi'], industry: ['healthcare'] })).toBe(true);
    expect(triggerFires(t, { dataTypes: ['phi'] })).toBe(false); // industry missing
  });
  it('matches any option within a key (OR within a key)', () => {
    const t2: Trigger = { condition: { dataTypes: ['phi', 'cardholder'] }, because: 'x' };
    expect(triggerFires(t2, { dataTypes: ['cardholder'] })).toBe(true);
  });
  it('an empty condition never fires', () => {
    expect(triggerFires({ condition: {}, because: 'x' }, { dataTypes: ['phi'] })).toBe(false);
  });
});

describe('applicable', () => {
  const mini: RegData = {
    meta: { title: 't', version: '0', note: '', sources: [] },
    questions: [
      { id: 'dataTypes', label: 'data', options: [{ id: 'phi', label: 'PHI' }, { id: 'cardholder', label: 'Card' }] },
    ],
    regulations: [
      reg({ id: 'hipaa', triggers: [{ condition: { dataTypes: ['phi'] }, because: 'You handle PHI.' }] }),
      reg({ id: 'pci', triggers: [{ condition: { dataTypes: ['cardholder'] }, because: 'You take cards.' }] }),
    ],
  };
  it('returns only regulations whose triggers fire, with reasons', () => {
    const result = applicable(mini, { dataTypes: ['phi'] });
    expect(result.map((r) => r.regulation.id)).toEqual(['hipaa']);
    expect(result[0].reasons).toEqual(['You handle PHI.']);
  });
  it('returns nothing for an empty profile', () => {
    expect(applicable(mini, {})).toHaveLength(0);
  });
  it('dedupes repeated reasons from multiple fired triggers', () => {
    const r = reg({
      id: 'dup',
      triggers: [
        { condition: { dataTypes: ['phi'] }, because: 'same reason' },
        { condition: { dataTypes: ['cardholder'] }, because: 'same reason' },
      ],
    });
    const result = applicable({ ...mini, regulations: [r] }, { dataTypes: ['phi', 'cardholder'] });
    expect(result[0].reasons).toEqual(['same reason']);
  });
});

describe('combinedPlan', () => {
  it('merges identical actions and tags every regulation, most-shared first', () => {
    const regs = [
      { regulation: reg({ short: 'A', first90: ['shared step', 'a-only'] }), reasons: [] },
      { regulation: reg({ short: 'B', first90: ['shared step', 'b-only'] }), reasons: [] },
    ];
    const plan = combinedPlan(regs);
    expect(plan[0]).toEqual({ action: 'shared step', regulations: ['A', 'B'] });
    expect(plan.map((p) => p.action)).toContain('a-only');
    expect(plan.map((p) => p.action)).toContain('b-only');
  });
});

describe('planCsv and profileSize', () => {
  it('builds a header and quotes commas', () => {
    const csv = planCsv([{ action: 'Do X, then Y', regulations: ['A', 'B'] }]).split('\n');
    expect(csv[0]).toBe('Action,Driven by');
    expect(csv[1]).toBe('"Do X, then Y",A B');
  });
  it('counts total selections', () => {
    expect(profileSize({ dataTypes: ['phi', 'cardholder'], industry: ['healthcare'] })).toBe(3);
    expect(profileSize({})).toBe(0);
  });
});

describe('regulations.json data integrity', () => {
  const optionsByQ = new Map(data.questions.map((q) => [q.id, new Set(q.options.map((o) => o.id))]));

  it('has questions and regulations with unique ids', () => {
    expect(data.regulations.length).toBeGreaterThanOrEqual(12);
    expect(new Set(data.regulations.map((r) => r.id)).size).toBe(data.regulations.length);
    expect(new Set(data.questions.map((q) => q.id)).size).toBe(data.questions.length);
  });

  it('every trigger references real question ids and option ids', () => {
    for (const r of data.regulations) {
      expect(r.triggers.length, r.id).toBeGreaterThan(0);
      for (const t of r.triggers) {
        for (const [qid, opts] of Object.entries(t.condition)) {
          const valid = optionsByQ.get(qid);
          expect(valid, `${r.id}: bad question ${qid}`).toBeDefined();
          for (const o of opts) expect(valid!.has(o), `${r.id}: bad option ${qid}/${o}`).toBe(true);
        }
      }
    }
  });

  it('every regulation has obligations, first90, a source, a caveat, and no em dashes', () => {
    for (const r of data.regulations) {
      expect(r.obligations.length, r.id).toBeGreaterThan(0);
      expect(r.first90.length, r.id).toBeGreaterThan(0);
      expect(r.sources.length, r.id).toBeGreaterThan(0);
      expect(r.caveat.trim().length, r.id).toBeGreaterThan(0);
      for (const s of r.sources) expect(s.url, r.id).toMatch(/^https:\/\//);
      expect(JSON.stringify(r), r.id).not.toMatch(/—/);
    }
  });

  it('a healthcare PHI profile surfaces HIPAA', () => {
    const result = applicable(data, { dataTypes: ['phi'] });
    expect(result.some((r) => r.regulation.id === 'hipaa')).toBe(true);
  });
});
