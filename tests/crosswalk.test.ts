import { describe, expect, it } from 'vitest';
import crosswalkRaw from '../src/data/crosswalk.json';
import nistCsf from '../src/data/nist-csf.json';
import cis from '../src/data/cis.json';
import {
  coverage,
  gapCsv,
  gapRegister,
  mappedFrameworks,
  mappingCsv,
  pendingFrameworks,
  signalsFor,
  type CrosswalkData,
  type Framework,
  type FrameworkId,
} from '../src/lib/crosswalk';

const data = crosswalkRaw as unknown as CrosswalkData;
const ALL = new Set<FrameworkId>(mappedFrameworks(data).map((f) => f.id));

/** A framework record with only the fields a test cares about spelled out. */
const fw = (id: string, total: number, over: Partial<Framework> = {}): Framework => ({
  id,
  name: id.toUpperCase(),
  short: id.toUpperCase(),
  family: 'core',
  kind: 'control-set',
  unit: 'controls',
  version: '1',
  url: 'https://example.invalid/',
  note: '',
  status: 'mapped',
  total,
  ...over,
});

// A tiny synthetic dataset for exercising the math in isolation.
const toy: CrosswalkData = {
  meta: { title: 't', version: '0', note: '', groups: [{ id: 'g', name: 'G' }], families: [], sources: [] },
  frameworks: [fw('csf', 3), fw('cis', 2), fw('iso', 0), fw('soc2', 0)],
  signals: [],
  controls: [
    { id: 'a', group: 'g', domain: 'Alpha', summary: '', mappings: { csf: ['C1', 'C2'], cis: ['1.1'], iso: [], soc2: [] } },
    { id: 'b', group: 'g', domain: 'Bravo', summary: '', mappings: { csf: ['C2', 'C3'], cis: ['2.1'], iso: [], soc2: [] } },
    { id: 'c', group: 'g', domain: 'Charlie', summary: '', mappings: { csf: [], cis: [], iso: [], soc2: [] } },
  ],
};

describe('coverage', () => {
  it('counts distinct framework ids, not double-counting shared ones', () => {
    const cov = coverage(toy, new Set(['a', 'b']), new Set<FrameworkId>(['csf']));
    // C1, C2, C3 across both domains = 3 distinct of 3.
    expect(cov).toHaveLength(1);
    expect(cov[0]).toMatchObject({ covered: 3, total: 3, pct: 100 });
  });

  it('is 0% when nothing is implemented', () => {
    const cov = coverage(toy, new Set(), new Set<FrameworkId>(['csf', 'cis']));
    expect(cov.every((c) => c.covered === 0 && c.pct === 0)).toBe(true);
  });

  it('only reports in-scope frameworks', () => {
    const cov = coverage(toy, new Set(['a']), new Set<FrameworkId>(['cis']));
    expect(cov.map((c) => c.framework.id)).toEqual(['cis']);
    expect(cov[0]).toMatchObject({ covered: 1, total: 2, pct: 50 });
  });

  it('never scores a pending framework, even when it is in scope', () => {
    // A program-specific model holds structure only. Scoring it would report 0%
    // for something that has simply not been filled in yet.
    const withPending: CrosswalkData = {
      ...toy,
      frameworks: [...toy.frameworks, fw('bastionone', 0, { status: 'pending', family: 'pending' })],
    };
    const cov = coverage(withPending, new Set(['a', 'b']), new Set<FrameworkId>(['csf', 'bastionone']));
    expect(cov.map((c) => c.framework.id)).toEqual(['csf']);
  });
});

describe('gapRegister', () => {
  it('ranks unimplemented domains by in-scope leverage and drops zero-leverage rows', () => {
    const gaps = gapRegister(toy, new Set(['a']), new Set<FrameworkId>(['csf', 'cis']));
    // Only 'b' has mappings; 'c' has none so it is dropped.
    expect(gaps.map((g) => g.control.id)).toEqual(['b']);
    expect(gaps[0].leverage).toBe(3); // C2, C3, 2.1
    expect(gaps[0].perFramework).toEqual({ csf: 2, cis: 1 });
  });

  it('excludes implemented domains', () => {
    const gaps = gapRegister(toy, new Set(['a', 'b']), ALL);
    expect(gaps.every((g) => g.control.id !== 'a' && g.control.id !== 'b')).toBe(true);
  });

  it('breaks ties by domain name for a stable order', () => {
    const tie: CrosswalkData = {
      ...toy,
      controls: [
        { id: 'z', group: 'g', domain: 'Zeta', summary: '', mappings: { csf: ['X'], cis: [], iso: [], soc2: [] } },
        { id: 'a', group: 'g', domain: 'Alpha', summary: '', mappings: { csf: ['Y'], cis: [], iso: [], soc2: [] } },
      ],
    };
    const gaps = gapRegister(tie, new Set(), new Set<FrameworkId>(['csf']));
    expect(gaps.map((g) => g.control.domain)).toEqual(['Alpha', 'Zeta']);
  });
});

describe('gapCsv', () => {
  it('emits a header plus one row per gap with per-framework counts', () => {
    const gaps = gapRegister(toy, new Set(['a']), new Set<FrameworkId>(['csf', 'cis']));
    const csv = gapCsv(toy, gaps, new Set<FrameworkId>(['csf', 'cis'])).split('\n');
    expect(csv[0]).toBe('Domain,Requirements unlocked,CSF,CIS');
    expect(csv[1]).toBe('Bravo,3,2,1');
  });

  it('quotes values containing commas', () => {
    const commad: CrosswalkData = {
      ...toy,
      controls: [{ id: 'x', group: 'g', domain: 'Gov, risk', summary: '', mappings: { csf: ['A'], cis: [], iso: [], soc2: [] } }],
    };
    const gaps = gapRegister(commad, new Set(), new Set<FrameworkId>(['csf']));
    expect(gapCsv(commad, gaps, new Set<FrameworkId>(['csf'])).split('\n')[1]).toBe('"Gov, risk",1,1');
  });
});

describe('mappingCsv', () => {
  it('emits one row per domain and framework pair that has identifiers', () => {
    const csv = mappingCsv(toy, new Set<FrameworkId>(['csf', 'cis', 'iso'])).split('\n');
    expect(csv[0]).toBe('Domain,Group,Framework,Mapped identifiers,Count');
    // Alpha maps CSF and CIS; ISO is empty and Charlie maps nothing at all.
    expect(csv.slice(1)).toEqual(['Alpha,g,CSF,C1 C2,2', 'Alpha,g,CIS,1.1,1', 'Bravo,g,CSF,C2 C3,2', 'Bravo,g,CIS,2.1,1']);
  });

  it('exports the whole in-scope mapping without dropping a domain that has one', () => {
    const rows = mappingCsv(data, ALL).split('\n').slice(1);
    const domainsWithRows = new Set(rows.map((r) => r.split(',')[0]));
    const expected = data.controls.filter((c) =>
      mappedFrameworks(data).some((f) => (c.mappings[f.id] ?? []).length > 0),
    );
    expect(domainsWithRows.size).toBe(expected.length);
  });
});

describe('crosswalk.json data integrity', () => {
  const csfKeys = new Set(Object.keys(nistCsf as Record<string, unknown>));
  const cisKeys = new Set(Object.keys(cis as Record<string, unknown>));
  const isoRe = /^A\.(5\.(3[0-7]|[12]?[0-9])|6\.[1-8]|7\.(1[0-4]|[1-9])|8\.(3[0-4]|[12]?[0-9]))$/;
  const soc2Re = /^(CC[1-9]\.[1-9]|A1\.[1-3]|C1\.[1-2]|PI1\.[1-5]|P[1-8]\.[1-9])$/;
  const groupIds = new Set(data.meta.groups.map((g) => g.id));
  const domainIds = new Set(data.controls.map((c) => c.id));

  it('has 45 domains, each in a real group with at least one core mapping and no em dashes', () => {
    expect(data.controls).toHaveLength(45);
    for (const c of data.controls) {
      expect(groupIds.has(c.group), `${c.id} has unknown group ${c.group}`).toBe(true);
      const total = c.mappings.csf.length + c.mappings.cis.length + c.mappings.iso.length + c.mappings.soc2.length;
      expect(total, `${c.id} has no mappings`).toBeGreaterThan(0);
      expect(c.summary).not.toMatch(/—/);
      expect(c.domain).not.toMatch(/—/);
    }
  });

  it('groups the domains in dataset order, so each group appears once', () => {
    // The page prints a heading when the group changes, so an interleaved
    // dataset would print the same heading twice.
    const order = data.controls.map((c) => c.group);
    const firstSeen = [...new Set(order)];
    expect(order).toEqual(firstSeen.flatMap((g) => order.filter((x) => x === g)));
  });

  it('references only real CSF and CIS ids', () => {
    for (const c of data.controls) {
      for (const id of c.mappings.csf) expect(csfKeys.has(id), `${c.id}: bad CSF ${id}`).toBe(true);
      for (const id of c.mappings.cis) expect(cisKeys.has(id), `${c.id}: bad CIS ${id}`).toBe(true);
    }
  });

  it('uses valid ISO 27001:2022 and SOC 2 identifiers', () => {
    for (const c of data.controls) {
      for (const id of c.mappings.iso) expect(isoRe.test(id), `${c.id}: bad ISO ${id}`).toBe(true);
      for (const id of c.mappings.soc2) expect(soc2Re.test(id), `${c.id}: bad SOC2 ${id}`).toBe(true);
    }
  });

  it('framework totals equal the distinct ids the crosswalk maps', () => {
    for (const f of data.frameworks) {
      const distinct = new Set(data.controls.flatMap((c) => c.mappings[f.id] ?? []));
      expect(f.total, `${f.id} total mismatch`).toBe(distinct.size);
    }
  });

  it('gives every framework a family, a mapping unit, and a scope note', () => {
    const familyIds = new Set(data.meta.families.map((f) => f.id));
    for (const f of data.frameworks) {
      expect(familyIds.has(f.family), `${f.id}: unknown family ${f.family}`).toBe(true);
      expect(f.note.length, `${f.id}: note`).toBeGreaterThan(20);
      if (f.status === 'mapped') {
        expect(f.unit.length, `${f.id}: unit`).toBeGreaterThan(2);
        expect(f.url, `${f.id}: url`).toMatch(/^https:\/\//);
      }
    }
  });

  it('keeps program-specific models empty, since their content is not public', () => {
    const pending = pendingFrameworks(data);
    expect(pending.length).toBeGreaterThan(0);
    for (const f of pending) {
      expect(f.total, `${f.id} should map nothing`).toBe(0);
      expect(f.family).toBe('pending');
      for (const c of data.controls) expect(c.mappings[f.id]).toEqual([]);
    }
  });

  it('anchors every signal to real domains and states what it is', () => {
    expect(data.signals.length).toBeGreaterThan(0);
    for (const s of data.signals) {
      expect(s.domains.length, `${s.id}`).toBeGreaterThan(0);
      for (const d of s.domains) expect(domainIds.has(d), `${s.id}: unknown domain ${d}`).toBe(true);
      expect(s.what.length, `${s.id}`).toBeGreaterThan(30);
      if (s.status === 'public') expect(s.url, `${s.id}`).toMatch(/^https:\/\//);
    }
  });

  it('exposes the exploit-driven feeds on the prioritization domain', () => {
    // KEV and EPSS are not control sets and are deliberately not scored, so the
    // only way they reach a user is through this attachment.
    const ids = signalsFor(data, 'vuln-prioritization').map((s) => s.id);
    expect(ids).toContain('kev');
    expect(ids).toContain('epss');
  });

  it('full-scope, fully-implemented coverage is 100% for every mapped framework', () => {
    const all = new Set(data.controls.map((c) => c.id));
    const rows = coverage(data, all, ALL);
    expect(rows).toHaveLength(mappedFrameworks(data).length);
    for (const row of rows) expect(row.pct, row.framework.id).toBe(100);
  });
});
