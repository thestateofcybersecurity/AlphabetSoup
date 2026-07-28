import { describe, expect, it } from 'vitest';
import catalogRaw from '../src/data/policies.json';
import crosswalk from '../src/data/crosswalk.json';
import csf from '../src/data/nist-csf.json';
import cis from '../src/data/cis.json';
import hipaa from '../src/data/hipaa-security.json';
import {
  EMPTY_PROFILE,
  coverage,
  deriveTier,
  fill,
  hasRegulatedData,
  policyToMarkdown,
  renderPolicy,
  selectPolicies,
  setToMarkdown,
  tiersUpTo,
  uncoveredControls,
  type Catalog,
  type CrosswalkDomain,
  type Framework,
  type Profile,
} from '../src/lib/policy';

const catalog = catalogRaw as unknown as Catalog;
const domains = crosswalk.controls as unknown as CrosswalkDomain[];
const frameworks = crosswalk.frameworks as unknown as Framework[];

/** Real control counts, for the frameworks this site holds in full. */
const SIZES: Record<string, number> = {
  csf: Object.keys(csf as Record<string, unknown>).length,
  cis: Object.keys(cis as Record<string, unknown>).length,
  hipaa: (hipaa.standards as unknown[]).length,
  pci: 12,
  cmmc: 14,
};

const profile = (over: Partial<Profile> = {}): Profile => ({ ...EMPTY_PROFILE, ...over });

describe('tier derivation', () => {
  it('puts a small unregulated organization at the floor', () => {
    expect(deriveTier(profile({ size: 'small' }))).toBe('ig1');
  });

  it('raises a mid-size organization to IG2', () => {
    expect(deriveTier(profile({ size: 'mid' }))).toBe('ig2');
  });

  it('puts a large organization at IG3', () => {
    expect(deriveTier(profile({ size: 'large' }))).toBe('ig3');
  });

  it.each([['cardData'], ['healthData'], ['controlledUnclassified']] as const)(
    'raises the baseline when the organization holds %s, regardless of headcount',
    (flag) => {
      // An obligation does not scale down with the organization holding it.
      const small = profile({ size: 'small', [flag]: true } as Partial<Profile>);
      expect(deriveTier(small)).not.toBe('ig1');
    },
  );

  it('does not push the very smallest regulated organization straight to IG3', () => {
    expect(deriveTier(profile({ size: 'micro', cardData: true }))).toBe('ig2');
  });

  it('honours an explicit override', () => {
    expect(deriveTier(profile({ size: 'large', tier: 'ig1' }))).toBe('ig1');
  });

  it('treats personal data alone as not regulated for tiering', () => {
    // Personal data raises obligations, but the CIS tiering signal here is the
    // presence of card, health, or controlled unclassified information.
    expect(hasRegulatedData(profile({ personalData: true }))).toBe(false);
  });
});

describe('tier accumulation', () => {
  it('is additive', () => {
    expect(tiersUpTo('ig1')).toEqual(['ig1']);
    expect(tiersUpTo('ig2')).toEqual(['ig1', 'ig2']);
    expect(tiersUpTo('ig3')).toEqual(['ig1', 'ig2', 'ig3']);
  });

  it('produces strictly more requirements at each tier', () => {
    const p = catalog.policies[0];
    const counts = (['ig1', 'ig2', 'ig3'] as const).map(
      (t) => renderPolicy(p, profile(), t, catalog, domains).requirements.length,
    );
    expect(counts[1]).toBeGreaterThan(counts[0]);
    expect(counts[2]).toBeGreaterThan(counts[1]);
  });
});

describe('policy selection', () => {
  it('includes everything for an organization that builds software and has offices', () => {
    const s = selectPolicies(catalog, profile({ buildsSoftware: true, hasOffices: true }));
    expect(s.included).toHaveLength(catalog.policies.length);
    expect(s.excluded).toEqual([]);
  });

  it('excludes secure development with a stated reason, never silently', () => {
    const s = selectPolicies(catalog, profile({ buildsSoftware: false }));
    const ex = s.excluded.find((e) => e.policy.domain === 'appsec');
    expect(ex).toBeDefined();
    // A missing document is a finding; a documented exclusion is a scope statement.
    expect(ex!.reason.length).toBeGreaterThan(40);
    expect(s.included.some((p) => p.domain === 'appsec')).toBe(false);
  });

  it('reduces physical scope for an organization with no facilities, and says where it went', () => {
    const s = selectPolicies(catalog, profile({ hasOffices: false }));
    const ex = s.excluded.find((e) => e.policy.domain === 'physical');
    expect(ex!.reason).toMatch(/Endpoint|Asset/);
  });

  it('never excludes a baseline policy', () => {
    const s = selectPolicies(catalog, profile({ buildsSoftware: false, hasOffices: false }));
    for (const domain of ['governance', 'iam', 'incident-response', 'backup', 'data-protection']) {
      expect(s.included.some((p) => p.domain === domain), domain).toBe(true);
    }
  });

  it('accounts for every catalogued policy exactly once', () => {
    const s = selectPolicies(catalog, profile({ buildsSoftware: false, hasOffices: false }));
    expect(s.included.length + s.excluded.length).toBe(catalog.policies.length);
  });
});

describe('placeholder substitution', () => {
  it('uses the profile when set', () => {
    const out = fill('{{org}} and {{owner}} review {{review}}.', profile({
      orgName: 'Acme Ltd', policyOwner: 'the CISO', reviewCadence: 'quarterly',
    }), catalog);
    expect(out).toBe('Acme Ltd and the CISO review quarterly.');
  });

  it('falls back to readable defaults when the profile is empty', () => {
    const out = fill('{{org}} and {{owner}}.', profile(), catalog);
    expect(out).toBe('the organization and the security lead.');
    expect(out).not.toContain('{{');
  });

  it('trims whitespace-only input rather than rendering a gap', () => {
    expect(fill('{{org}}.', profile({ orgName: '   ' }), catalog)).toBe('the organization.');
  });

  it('leaves no unresolved token anywhere in a rendered policy', () => {
    for (const p of catalog.policies) {
      const r = renderPolicy(p, profile({ orgName: 'Acme' }), 'ig3', catalog, domains);
      expect(JSON.stringify(r), p.id).not.toContain('{{');
    }
  });
});

describe('coverage reporting', () => {
  const all = selectPolicies(catalog, profile({ buildsSoftware: true, hasOffices: true })).included;

  it('measures against the real framework, not the mapped subset', () => {
    const c = coverage(all, frameworks, domains, SIZES).find((x) => x.id === 'csf')!;
    // The catalog reaches all 99 mapped subcategories, but CSF has 106.
    expect(c.addressed).toBe(99);
    expect(c.frameworkTotal).toBe(106);
    expect(c.percent).toBe(93);
    expect(c.approximate).toBe(false);
  });

  it('never reports 100% for a framework the crosswalk only partly maps', () => {
    const cov = coverage(all, frameworks, domains, SIZES);
    for (const id of ['csf', 'cis', 'hipaa']) {
      const c = cov.find((x) => x.id === id)!;
      expect(c.percent, `${id} must not read as fully covered`).toBeLessThan(100);
    }
    // And nothing may show 100% off a subset denominator.
    for (const c of cov) {
      if (c.approximate) expect(c.percent, `${c.id}`).toBeNull();
    }
  });

  it('reports no percentage where the true denominator is unknown', () => {
    const iso = coverage(all, frameworks, domains, SIZES).find((x) => x.id === 'iso')!;
    // ISO control text is not redistributable, so only identifiers are stored.
    // Dividing by the mapped subset would render 100% for a framework this
    // catalog only partly reaches, which is worse than reporting nothing.
    expect(iso.approximate).toBe(true);
    expect(iso.frameworkTotal).toBeNull();
    expect(iso.percent).toBeNull();
    expect(iso.addressed).toBeGreaterThan(0);
  });

  it('drops coverage when a policy is excluded', () => {
    const fewer = selectPolicies(catalog, profile({ buildsSoftware: false })).included;
    const withDev = coverage(all, frameworks, domains, SIZES).find((c) => c.id === 'cis')!;
    const without = coverage(fewer, frameworks, domains, SIZES).find((c) => c.id === 'cis')!;
    expect(without.addressed).toBeLessThan(withDev.addressed);
  });

  it('reports zero for an empty selection rather than dividing by zero', () => {
    for (const c of coverage([], frameworks, domains, SIZES)) {
      expect(c.addressed).toBe(0);
      expect(c.percent === null || Number.isFinite(c.percent)).toBe(true);
    }
  });

  it('lists the controls a reduced selection leaves uncovered', () => {
    const s = selectPolicies(catalog, profile({ buildsSoftware: false }));
    const gaps = uncoveredControls(s, 'cis', domains);
    expect(gaps.length).toBeGreaterThan(0);
    // Every gap must be a real id from the crosswalk.
    const known = new Set(domains.flatMap((d) => d.mappings.cis ?? []));
    for (const g of gaps) expect(known.has(g), g).toBe(true);
  });
});

describe('markdown export', () => {
  const p = renderPolicy(catalog.policies[0], profile({ orgName: 'Acme Ltd' }), 'ig2', catalog, domains);

  it('produces a document with the sections a policy needs', () => {
    const md = policyToMarkdown(p, profile({ orgName: 'Acme Ltd' }));
    for (const heading of ['# ', '## Purpose', '## Scope', '## Roles', '## Policy requirements',
      '## Exceptions', '## Review', '## Evidence', '## Control mapping']) {
      expect(md, heading).toContain(heading);
    }
    expect(md).toContain('Acme Ltd');
  });

  it('labels each requirement with the tier that introduced it', () => {
    const md = policyToMarkdown(p, profile());
    expect(md).toContain('*(IG1)*');
    expect(md).toContain('*(IG2)*');
    expect(md).not.toContain('*(IG3)*');
  });

  it('states excluded policies in the set, so scope is explicit', () => {
    const prof = profile({ orgName: 'Acme Ltd', buildsSoftware: false });
    const sel = selectPolicies(catalog, prof);
    const rendered = sel.included.map((x) => renderPolicy(x, prof, 'ig1', catalog, domains));
    const md = setToMarkdown(rendered, sel, prof, 'ig1', coverage(sel.included, frameworks, domains, SIZES));
    expect(md).toContain('Policies considered and not included');
    expect(md).toContain('Secure Development Policy');
  });

  it('does not present coverage as evidence of effectiveness', () => {
    const sel = selectPolicies(catalog, profile());
    const rendered = sel.included.map((x) => renderPolicy(x, profile(), 'ig1', catalog, domains));
    const md = setToMarkdown(rendered, sel, profile(), 'ig1', coverage(sel.included, frameworks, domains, SIZES));
    expect(md).toMatch(/not evidence that the control operates effectively/i);
  });

  it('emits every included policy', () => {
    const prof = profile({ buildsSoftware: true, hasOffices: true });
    const sel = selectPolicies(catalog, prof);
    const rendered = sel.included.map((x) => renderPolicy(x, prof, 'ig3', catalog, domains));
    const md = setToMarkdown(rendered, sel, prof, 'ig3', coverage(sel.included, frameworks, domains, SIZES));
    for (const r of rendered) expect(md, r.title).toContain(`# ${r.title}`);
  });
});
