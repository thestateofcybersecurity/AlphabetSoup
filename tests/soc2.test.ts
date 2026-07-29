import { describe, expect, it } from 'vitest';
import soc2Raw from '../src/data/soc2.json';
import crosswalkRaw from '../src/data/crosswalk.json';
import {
  byFamily,
  compareIds,
  cosoPrincipleCount,
  criterionById,
  domainsForCriterion,
  familyOf,
  isEnumerated,
  relatedByCriterion,
  unmappedCriteria,
  type CrosswalkDomain,
  type Soc2Data,
} from '../src/lib/soc2';

/**
 * The SOC 2 structure here was derived, not recalled, because the criteria
 * themselves are paywalled and the freely available summaries are unreliable.
 * Public repositories claiming to list the criteria disagreed with each other
 * and invented identifiers such as CC8.4 and CC9.3, which do not exist.
 *
 * These tests pin the derivation so that a future edit cannot quietly
 * reintroduce a family size nothing supports.
 */

const data = soc2Raw as unknown as Soc2Data;
const domains = crosswalkRaw.controls as unknown as CrosswalkDomain[];

describe('structure', () => {
  it('holds exactly the criteria it claims to', () => {
    expect(data.criteria).toHaveLength(data.meta.criterionCount);
    expect(data.criteria).toHaveLength(38);
  });

  it('gives every criterion a unique id', () => {
    const ids = data.criteria.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('matches each declared family count to the criteria actually present', () => {
    for (const { family, criteria } of byFamily(data)) {
      expect(criteria, family.code).toHaveLength(family.count);
    }
  });

  it('numbers each family from 1 with no gaps', () => {
    // A gap would mean either a missing criterion or an invented one.
    for (const { family, criteria } of byFamily(data)) {
      const numbers = criteria.map((c) => Number(c.id.split('.')[1]));
      expect(numbers, family.code).toEqual(Array.from({ length: family.count }, (_, i) => i + 1));
    }
  });

  it('accounts for exactly the seventeen COSO principles across CC1 to CC5', () => {
    // This is the derivation that fixed CC5 at three, which no crosswalk
    // identifier corroborated. If it stops equalling 17, the basis is gone.
    expect(cosoPrincipleCount(data)).toBe(17);
  });

  it('keeps the common criteria at 33 and the whole scope at 38', () => {
    const cc = data.criteria.filter((c) => c.family.startsWith('CC'));
    expect(cc).toHaveLength(33);
    expect(data.meta.categories.reduce((s, c) => s + c.count, 0)).toBe(38);
  });

  it('orders CC2, CC3 and CC4 the way the trust services criteria do', () => {
    // The ordering differs from COSO's own, which is the detail that makes the
    // COSO derivation checkable: Communication is CC2, Risk Assessment is CC3.
    const size = (code: string): number =>
      data.meta.families.find((f) => f.code === code)?.count ?? 0;
    expect([size('CC2'), size('CC3'), size('CC4')]).toEqual([3, 4, 2]);
  });

  it('writes original prose for every criterion', () => {
    for (const c of data.criteria) {
      for (const field of ['subject', 'metaphor', 'translation'] as const) {
        expect(c[field]?.trim(), `${c.id} ${field}`).toBeTruthy();
      }
    }
  });

  it('uses no em dashes or en dashes anywhere in the dataset', () => {
    expect(JSON.stringify(data)).not.toMatch(/[—–]/);
  });

  it('reproduces no AICPA criterion text, and says so', () => {
    expect(data.meta.note).toMatch(/copyright/i);
    expect(data.meta.officialUrl).toContain('aicpa');
  });
});

describe('scope', () => {
  it('describes Processing Integrity and Privacy without enumerating them', () => {
    const codes = data.meta.unscopedCategories.map((c) => c.code);
    expect(codes).toEqual(['PI', 'P']);
    for (const category of data.meta.unscopedCategories) {
      expect(category.reason, category.code).toBeTruthy();
    }
    expect(data.criteria.some((c) => /^(PI|P[1-8])/.test(c.id))).toBe(false);
  });

  it('treats the crosswalk PI identifiers as not enumerated', () => {
    // The crosswalk cites these; the dataset deliberately does not define them.
    // Linking them without checking would produce dead links.
    expect(isEnumerated(data, 'PI1.2')).toBe(false);
    expect(isEnumerated(data, 'PI1.3')).toBe(false);
    expect(isEnumerated(data, 'CC6.8')).toBe(true);
  });

  it('rejects the identifiers that public sources invented', () => {
    // Two GitHub projects listed these. CC8 has one criterion and CC9 has two.
    for (const fake of ['CC8.2', 'CC8.4', 'CC9.3', 'CC4.3', 'CC5.4']) {
      expect(criterionById(data, fake), fake).toBeUndefined();
    }
  });
});

describe('identifiers', () => {
  it('reads the family off an identifier', () => {
    expect(familyOf('CC6.8')).toBe('CC6');
    expect(familyOf('A1.1')).toBe('A1');
    expect(familyOf('C1.2')).toBe('C1');
  });

  it('sorts numerically within a family rather than as text', () => {
    // A plain string sort puts CC6.10 before CC6.2.
    expect(compareIds('CC6.2', 'CC6.10')).toBeLessThan(0);
    expect(compareIds('CC10.1', 'CC9.1')).toBeGreaterThan(0);
    expect(compareIds('A1.1', 'C1.1')).toBeLessThan(0);
  });

  it('sorts a shuffled list back into order', () => {
    const shuffled = ['CC6.8', 'A1.2', 'CC1.1', 'CC6.2', 'C1.1'];
    expect([...shuffled].sort(compareIds)).toEqual(['A1.2', 'C1.1', 'CC1.1', 'CC6.2', 'CC6.8']);
  });
});

describe('crosswalk mappings', () => {
  it('maps every enumerated criterion to at least one domain', () => {
    expect(unmappedCriteria(data, domains)).toEqual([]);
  });

  it('cites only real identifiers, apart from the documented PI exception', () => {
    const known = new Set(data.criteria.map((c) => c.id));
    const stray = [...new Set(domains.flatMap((d) => d.mappings.soc2 ?? []))]
      .filter((id) => !known.has(id))
      .sort(compareIds);
    expect(stray).toEqual(['PI1.2', 'PI1.3']);
  });

  it('corroborates the declared family sizes against the crosswalk maxima', () => {
    // The crosswalk was curated independently of this dataset. Where it cites
    // the last criterion in a family, it confirms that family's size. This is
    // the evidence that fixed CC6, CC7, CC8, CC9, A1 and C1.
    const cited = new Set(domains.flatMap((d) => d.mappings.soc2 ?? []));
    for (const family of ['CC6', 'CC7', 'CC8', 'CC9', 'A1', 'C1']) {
      const declared = data.meta.families.find((f) => f.code === family)?.count ?? 0;
      expect(cited.has(`${family}.${declared}`), `${family} maximum`).toBe(true);
      expect(cited.has(`${family}.${declared + 1}`), `${family} overrun`).toBe(false);
    }
  });

  it('derives related controls in the other frameworks', () => {
    const related = relatedByCriterion(data, domains);
    const governance = related.get('CC1.1');
    expect(governance?.csf.length).toBeGreaterThan(0);
    expect(governance?.iso.length).toBeGreaterThan(0);
  });

  it('derives nothing for a criterion it does not enumerate', () => {
    // PI1.2 is cited by the appsec domain, so an unguarded derivation would
    // hand back relationships for a criterion that has no page.
    const related = relatedByCriterion(data, domains);
    expect(related.has('PI1.2')).toBe(false);
    expect(domainsForCriterion('PI1.2', domains)).toContain('appsec');
  });

  it('reports which domains cite a criterion', () => {
    expect(domainsForCriterion('CC8.1', domains)).toEqual(
      expect.arrayContaining(['appsec', 'change-mgmt']),
    );
  });
});
