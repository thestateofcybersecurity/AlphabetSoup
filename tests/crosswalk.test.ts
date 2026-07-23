import { describe, expect, it } from 'vitest';
import crosswalkRaw from '../src/data/crosswalk.json';
import nistCsf from '../src/data/nist-csf.json';
import cis from '../src/data/cis.json';
import { coverage, gapCsv, gapRegister, type CrosswalkData, type FrameworkId } from '../src/lib/crosswalk';

const data = crosswalkRaw as CrosswalkData;
const ALL = new Set<FrameworkId>(data.frameworks.map((f) => f.id));

// A tiny synthetic dataset for exercising the math in isolation.
const toy: CrosswalkData = {
  meta: { title: 't', version: '0', note: '', sources: [] },
  frameworks: [
    { id: 'csf', name: 'CSF', short: 'CSF', total: 3 },
    { id: 'cis', name: 'CIS', short: 'CIS', total: 2 },
    { id: 'iso', name: 'ISO', short: 'ISO', total: 0 },
    { id: 'soc2', name: 'SOC2', short: 'SOC2', total: 0 },
  ],
  controls: [
    { id: 'a', domain: 'Alpha', summary: '', mappings: { csf: ['C1', 'C2'], cis: ['1.1'], iso: [], soc2: [] } },
    { id: 'b', domain: 'Bravo', summary: '', mappings: { csf: ['C2', 'C3'], cis: ['2.1'], iso: [], soc2: [] } },
    { id: 'c', domain: 'Charlie', summary: '', mappings: { csf: [], cis: [], iso: [], soc2: [] } },
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
        { id: 'z', domain: 'Zeta', summary: '', mappings: { csf: ['X'], cis: [], iso: [], soc2: [] } },
        { id: 'a', domain: 'Alpha', summary: '', mappings: { csf: ['Y'], cis: [], iso: [], soc2: [] } },
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
      controls: [{ id: 'x', domain: 'Gov, risk', summary: '', mappings: { csf: ['A'], cis: [], iso: [], soc2: [] } }],
    };
    const gaps = gapRegister(commad, new Set(), new Set<FrameworkId>(['csf']));
    expect(gapCsv(commad, gaps, new Set<FrameworkId>(['csf'])).split('\n')[1]).toBe('"Gov, risk",1,1');
  });
});

describe('crosswalk.json data integrity', () => {
  const csfKeys = new Set(Object.keys(nistCsf as Record<string, unknown>));
  const cisKeys = new Set(Object.keys(cis as Record<string, unknown>));
  const isoRe = /^A\.(5\.(3[0-7]|[12]?[0-9])|6\.[1-8]|7\.(1[0-4]|[1-9])|8\.(3[0-4]|[12]?[0-9]))$/;
  const soc2Re = /^(CC[1-9]\.[1-9]|A1\.[1-3]|C1\.[1-2]|PI1\.[1-5]|P[1-8]\.[1-9])$/;

  it('has 24 domains, each with at least one mapping and no em dashes', () => {
    expect(data.controls).toHaveLength(24);
    for (const c of data.controls) {
      const total = c.mappings.csf.length + c.mappings.cis.length + c.mappings.iso.length + c.mappings.soc2.length;
      expect(total, `${c.id} has no mappings`).toBeGreaterThan(0);
      expect(c.summary).not.toMatch(/—/);
      expect(c.domain).not.toMatch(/—/);
    }
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
      const distinct = new Set(data.controls.flatMap((c) => c.mappings[f.id]));
      expect(f.total, `${f.id} total mismatch`).toBe(distinct.size);
    }
  });

  it('full-scope, fully-implemented coverage is 100% for every framework', () => {
    const all = new Set(data.controls.map((c) => c.id));
    for (const row of coverage(data, all, ALL)) expect(row.pct).toBe(100);
  });
});
