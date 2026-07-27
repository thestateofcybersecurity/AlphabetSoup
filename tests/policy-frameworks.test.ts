import { describe, expect, it } from 'vitest';
import crosswalk from '../src/data/crosswalk.json';
import hipaa from '../src/data/hipaa-security.json';
import pci from '../src/data/assessment-pci-dss.json';
import cmmc from '../src/data/assessment-800171.json';
import csf from '../src/data/nist-csf.json';
import cis from '../src/data/cis.json';

/**
 * The crosswalk is the spine the policy generator maps against: each control
 * domain becomes a policy, and its mappings become that policy's framework
 * coverage claim. A dangling id here means a generated policy would cite a
 * control that does not exist, which is the one failure a compliance tool
 * cannot have.
 */

interface Domain {
  id: string;
  domain: string;
  summary: string;
  mappings: Record<string, string[]>;
}
interface Framework {
  id: string;
  name: string;
  short: string;
  total: number;
}

const domains = crosswalk.controls as Domain[];
const frameworks = crosswalk.frameworks as Framework[];

/** Valid control identifiers for each mapped framework, from its own dataset. */
const VALID: Record<string, Set<string>> = {
  csf: new Set(Object.keys(csf as Record<string, unknown>)),
  cis: new Set(Object.keys(cis as Record<string, unknown>)),
  pci: new Set((pci.categories as { id: string }[]).map((c) => c.id)),
  cmmc: new Set((cmmc.categories as { id: string }[]).map((c) => c.id)),
  hipaa: new Set((hipaa.standards as { slug: string }[]).map((s) => s.slug)),
};

describe('HIPAA Security Rule dataset', () => {
  const standards = hipaa.standards as {
    section: string;
    slug: string;
    standard: string;
    specifications: { name: string; kind: string }[];
  }[];

  it('matches the published structure of 45 CFR 164 Subpart C', () => {
    // 9 administrative, 4 physical, 5 technical, 2 organizational, 2 documentation.
    const bySection = standards.reduce<Record<string, number>>((acc, s) => {
      acc[s.section] = (acc[s.section] ?? 0) + 1;
      return acc;
    }, {});
    expect(bySection).toEqual({
      '164.308': 9,
      '164.310': 4,
      '164.312': 5,
      '164.314': 2,
      '164.316': 2,
    });
    expect(standards).toHaveLength(22);
  });

  it('has 40 implementation specifications, 19 required and 21 addressable', () => {
    const specs = standards.flatMap((s) => s.specifications);
    expect(specs).toHaveLength(40);
    expect(specs.filter((s) => s.kind === 'required')).toHaveLength(19);
    expect(specs.filter((s) => s.kind === 'addressable')).toHaveLength(21);
  });

  it('only labels a specification required or addressable', () => {
    for (const s of standards) {
      for (const spec of s.specifications) {
        expect(['required', 'addressable'], `${s.slug}/${spec.name}`).toContain(spec.kind);
      }
    }
  });

  it('uses unique slugs, since the crosswalk references them', () => {
    const slugs = standards.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('cites its public-domain source', () => {
    expect(hipaa.meta.citation).toContain('45 CFR');
    expect(hipaa.meta.source).toContain('ecfr.gov');
  });
});

describe('crosswalk mappings', () => {
  it('covers all seven frameworks', () => {
    expect(frameworks.map((f) => f.id).sort()).toEqual(
      ['cis', 'cmmc', 'csf', 'hipaa', 'iso', 'pci', 'soc2'].sort(),
    );
  });

  it('maps every domain to every framework that has a checkable dataset', () => {
    // ISO and SOC 2 control texts are not redistributable, so only their
    // identifiers are stored and there is no dataset to validate against.
    for (const domain of domains) {
      for (const fw of Object.keys(VALID)) {
        expect(domain.mappings[fw], `${domain.id} is missing ${fw}`).toBeDefined();
      }
    }
  });

  it.each(Object.keys(VALID))('cites only real %s control ids', (fw) => {
    const bad: string[] = [];
    for (const domain of domains) {
      for (const id of domain.mappings[fw] ?? []) {
        if (!VALID[fw].has(id)) bad.push(`${domain.id} -> ${fw}:${id}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('leaves no domain without a policy-relevant mapping', () => {
    const orphans = domains.filter((d) =>
      Object.values(d.mappings).every((ids) => (ids ?? []).length === 0),
    );
    expect(orphans.map((d) => d.id)).toEqual([]);
  });

  it('has a unique id and a summary for every domain', () => {
    const ids = domains.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of domains) {
      expect(d.domain.length, d.id).toBeGreaterThan(3);
      expect(d.summary.length, d.id).toBeGreaterThan(20);
    }
  });

  it('reports a total equal to the distinct ids it maps', () => {
    // `total` is how many of a framework's controls this crosswalk reaches, not
    // how large the framework is: CSF maps 99 of its 106 subcategories. Reading
    // it as framework size is what made the first version of this data wrong.
    for (const fw of frameworks) {
      const mapped = new Set(domains.flatMap((d) => d.mappings[fw.id] ?? []));
      expect(mapped.size, fw.id).toBe(fw.total);
    }
  });

  it('leaves only genuinely out-of-scope HIPAA standards unmapped', () => {
    const mapped = new Set(domains.flatMap((d) => d.mappings.hipaa ?? []));
    const unmapped = [...VALID.hipaa].filter((id) => !mapped.has(id));
    // 164.314(b) applies only to group health plans amending plan documents,
    // so it is not a security policy domain. Anything else appearing here means
    // a standard lost its home and should be re-mapped.
    expect(unmapped).toEqual(['requirements-for-group-health-plans']);
  });
});
