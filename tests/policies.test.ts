import { describe, expect, it } from 'vitest';
import catalog from '../src/data/policies.json';
import crosswalk from '../src/data/crosswalk.json';
import hipaa from '../src/data/hipaa-security.json';
import csf from '../src/data/nist-csf.json';
import cis from '../src/data/cis.json';

/**
 * The policy catalog is the text the generator emits, so its integrity matters
 * more than most data here: a policy that cites a control domain which does not
 * exist would produce a coverage claim the site cannot support.
 *
 * Tiers follow CIS Implementation Groups and are additive by construction: the
 * generator concatenates ig1 into ig2 into ig3 rather than storing duplicates,
 * so these tests check the pieces are disjoint and non-empty.
 */

interface Policy {
  id: string;
  domain: string;
  title: string;
  summary: string;
  purpose: string;
  scope: string;
  roles: { role: string; responsibility: string }[];
  tiers: Record<string, string[]>;
  exceptions: string;
  review: string;
  evidence: string[];
}

const policies = catalog.policies as Policy[];
const domains = new Set((crosswalk.controls as { id: string }[]).map((c) => c.id));
const TIERS = ['ig1', 'ig2', 'ig3'] as const;

/** Every placeholder the catalog declares it will substitute. */
const declared = new Set(
  (catalog.meta.placeholders as { token: string }[]).map((p) => p.token),
);

describe('policy catalog integrity', () => {
  it('has a unique id and title per policy', () => {
    expect(new Set(policies.map((p) => p.id)).size).toBe(policies.length);
    expect(new Set(policies.map((p) => p.title)).size).toBe(policies.length);
  });

  it('anchors every policy to a real crosswalk domain', () => {
    // This is the link that turns a policy into a framework coverage claim.
    const orphans = policies.filter((p) => !domains.has(p.domain));
    expect(orphans.map((p) => p.id)).toEqual([]);
  });

  it('maps at most one policy to a domain, so coverage is not double counted', () => {
    const used = policies.map((p) => p.domain);
    expect(new Set(used).size).toBe(used.length);
  });

  it.each(TIERS)('gives every policy a non-empty %s tier', (tier) => {
    for (const p of policies) {
      expect(p.tiers[tier], `${p.id}/${tier}`).toBeDefined();
      expect(p.tiers[tier].length, `${p.id}/${tier}`).toBeGreaterThan(2);
    }
  });

  it('keeps tiers disjoint, since the generator concatenates them', () => {
    for (const p of policies) {
      const all = TIERS.flatMap((t) => p.tiers[t]);
      expect(new Set(all).size, `${p.id} repeats a statement across tiers`).toBe(all.length);
    }
  });

  it('escalates: each tier adds fewer statements than the one below', () => {
    // IG1 is the broad floor; higher tiers add targeted practices rather than
    // restating the basics, so a bloated IG3 usually means misfiled statements.
    for (const p of policies) {
      expect(p.tiers.ig1.length, p.id).toBeGreaterThanOrEqual(p.tiers.ig2.length);
      expect(p.tiers.ig2.length, p.id).toBeGreaterThanOrEqual(p.tiers.ig3.length);
    }
  });

  it('writes every statement as a complete sentence', () => {
    for (const p of policies) {
      for (const tier of TIERS) {
        for (const s of p.tiers[tier]) {
          expect(s.length, `${p.id}: ${s}`).toBeGreaterThan(30);
          expect(s.endsWith('.'), `${p.id}: ${s}`).toBe(true);
          expect(s[0], `${p.id}: ${s}`).toBe(s[0].toUpperCase());
        }
      }
    }
  });

  it('gives every policy the sections an adoptable document needs', () => {
    for (const p of policies) {
      expect(p.purpose.length, p.id).toBeGreaterThan(60);
      expect(p.scope.length, p.id).toBeGreaterThan(40);
      expect(p.exceptions.length, p.id).toBeGreaterThan(40);
      expect(p.review.length, p.id).toBeGreaterThan(30);
      expect(p.roles.length, p.id).toBeGreaterThanOrEqual(3);
      expect(p.evidence.length, p.id).toBeGreaterThanOrEqual(3);
      for (const r of p.roles) {
        expect(r.role.length, p.id).toBeGreaterThan(3);
        expect(r.responsibility.length, `${p.id}/${r.role}`).toBeGreaterThan(40);
      }
    }
  });

  it('uses only placeholders the catalog knows how to substitute', () => {
    // An unknown token would render literally as {{something}} in a document
    // the user is about to hand to an auditor.
    const text = JSON.stringify(policies);
    const found = new Set(text.match(/\{\{[a-zA-Z]+\}\}/g) ?? []);
    const unknown = [...found].filter((t) => !declared.has(t));
    expect(unknown).toEqual([]);
  });

  it('declares a fallback for every placeholder', () => {
    for (const p of catalog.meta.placeholders as { token: string; fallback: string }[]) {
      expect(p.fallback.length, p.token).toBeGreaterThan(2);
    }
  });

  it('describes all three implementation groups', () => {
    const tiers = catalog.meta.tiers as { id: string; name: string; blurb: string }[];
    expect(tiers.map((t) => t.id)).toEqual([...TIERS]);
    for (const t of tiers) expect(t.blurb.length, t.id).toBeGreaterThan(40);
  });

  it('avoids em dashes, per the house style', () => {
    expect(JSON.stringify(catalog)).not.toContain('—');
  });
});

describe('framework coverage claims', () => {
  it('lets every catalogued policy cite real controls in every framework', () => {
    const byId = new Map((crosswalk.controls as { id: string; mappings: Record<string, string[]> }[]).map((c) => [c.id, c]));
    for (const p of policies) {
      const mappings = byId.get(p.domain)!.mappings;
      const cited = Object.values(mappings).flat();
      expect(cited.length, `${p.id} would claim no coverage at all`).toBeGreaterThan(0);
    }
  });

  it('covers every control domain exactly once', () => {
    // The catalog is complete: each of the crosswalk's 24 domains has one
    // policy, so coverage can be computed without gaps or double counting.
    const all = (crosswalk.controls as { id: string }[]).map((c) => c.id).sort();
    expect(policies.map((p) => p.domain).sort()).toEqual(all);
  });

  it('does not let full domain coverage be read as full framework coverage', () => {
    // The catalog reaches every control the crosswalk maps, but the crosswalk
    // does not map every control in every framework: CSF maps 99 of its 106
    // subcategories and CIS 141 of 153. A tool that rendered this as "100% NIST
    // CSF" would be telling a user something untrue about their audit posture,
    // so the denominators are pinned here.
    const frameworkSizes: Record<string, number> = {
      csf: Object.keys(csf as Record<string, unknown>).length,
      cis: Object.keys(cis as Record<string, unknown>).length,
      hipaa: (hipaa.standards as unknown[]).length,
    };
    for (const [id, size] of Object.entries(frameworkSizes)) {
      const fw = (crosswalk.frameworks as { id: string; total: number }[]).find((f) => f.id === id)!;
      expect(fw.total, `${id}: crosswalk should not claim to map the whole framework`).toBeLessThan(
        size,
      );
    }
  });
});
