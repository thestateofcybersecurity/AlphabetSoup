/**
 * The SOC 2 Trust Services Criteria, and how they reach the other frameworks.
 *
 * Two things here are worth knowing before changing anything.
 *
 * First, the scope is deliberate. This covers Security (the common criteria),
 * Availability and Confidentiality: 38 criteria. Processing Integrity and
 * Privacy are described at category level only. The AICPA criteria are
 * paywalled, and the freely published summaries contradicted each other on how
 * PI and P are numbered, so enumerating them would mean asserting a structure
 * this site cannot stand behind. Two of the identifiers the crosswalk cites,
 * PI1.2 and PI1.3, therefore have no entry in the dataset. That is expected,
 * and `isEnumerated` is how callers avoid linking to a page that will not exist.
 *
 * Second, the family sizes are derived rather than assumed. CC1 through CC5 are
 * organized around the seventeen COSO principles, which fixes them at 5, 3, 4,
 * 2 and 3. The crosswalk independently corroborates several of those maxima.
 * `cosoPrincipleCount` exists so a test can assert the derivation still holds.
 */

export interface Soc2Criterion {
  id: string;
  family: string;
  familyName: string;
  subject: string;
  metaphor: string;
  translation: string;
}

export interface Soc2Family {
  code: string;
  name: string;
  /** Which COSO principles the family is built on, or null if it is not COSO derived. */
  coso: string | null;
  count: number;
}

export interface Soc2Category {
  code: string;
  name: string;
  blurb: string;
  count: number;
}

export interface Soc2UnscopedCategory {
  code: string;
  name: string;
  blurb: string;
  reason: string;
}

export interface Soc2Data {
  meta: {
    name: string;
    short: string;
    officialUrl: string;
    criterionCount: number;
    note: string;
    scopeNote: string;
    structureNote: string;
    categories: Soc2Category[];
    families: Soc2Family[];
    unscopedCategories: Soc2UnscopedCategory[];
  };
  criteria: Soc2Criterion[];
}

/** The family an identifier belongs to: CC6.8 gives CC6, A1.1 gives A1. */
export function familyOf(id: string): string {
  return id.split('.')[0] ?? '';
}

/**
 * Sort order for criterion identifiers.
 *
 * Families sort by their letter prefix then their number, and criteria sort
 * numerically within a family so that CC6.2 precedes CC6.10 rather than
 * following it the way a plain string sort would have them.
 */
export function compareIds(a: string, b: string): number {
  const parse = (id: string): [string, number, number] => {
    const [family, rest] = id.split('.');
    const letters = family.replace(/[0-9]/g, '');
    const familyNum = Number(family.replace(/[^0-9]/g, '') || 0);
    return [letters, familyNum, Number(rest ?? 0)];
  };
  const [al, af, an] = parse(a);
  const [bl, bf, bn] = parse(b);
  return al.localeCompare(bl) || af - bf || an - bn;
}

/** Look up one criterion, or undefined if it is outside the enumerated scope. */
export function criterionById(data: Soc2Data, id: string): Soc2Criterion | undefined {
  return data.criteria.find((c) => c.id === id);
}

/**
 * Whether this site has an entry for the identifier.
 *
 * Callers that turn a crosswalk identifier into a link must check this first.
 * PI1.2 and PI1.3 are cited by the crosswalk but deliberately not enumerated,
 * so linking them unconditionally would produce dead links.
 */
export function isEnumerated(data: Soc2Data, id: string): boolean {
  return criterionById(data, id) !== undefined;
}

/** Criteria grouped by family, in declared family order, sorted within each. */
export function byFamily(data: Soc2Data): { family: Soc2Family; criteria: Soc2Criterion[] }[] {
  return data.meta.families.map((family) => ({
    family,
    criteria: data.criteria
      .filter((c) => c.family === family.code)
      .sort((a, b) => compareIds(a.id, b.id)),
  }));
}

/** How many COSO principles the COSO derived families account for. Should be 17. */
export function cosoPrincipleCount(data: Soc2Data): number {
  return data.meta.families.filter((f) => f.coso !== null).reduce((sum, f) => sum + f.count, 0);
}

export interface CrosswalkDomain {
  id: string;
  mappings: Record<string, string[]>;
}

export interface RelatedControls {
  csf: string[];
  cis: string[];
  iso: string[];
}

/**
 * Related controls in the other frameworks, derived through the crosswalk.
 *
 * A criterion reaches CSF, CIS and ISO by way of whichever crosswalk domains
 * cite it: two frameworks mapped to the same domain are addressing the same
 * ground. This is an unofficial mapping and pages that surface it say so.
 *
 * Only enumerated criteria get an entry, so a PI identifier in the crosswalk
 * does not silently create a relationship for a criterion with no page.
 */
export function relatedByCriterion(
  data: Soc2Data,
  domains: readonly CrosswalkDomain[],
): Map<string, RelatedControls> {
  const acc = new Map<string, { csf: Set<string>; cis: Set<string>; iso: Set<string> }>();
  for (const domain of domains) {
    for (const id of domain.mappings.soc2 ?? []) {
      if (!isEnumerated(data, id)) continue;
      const entry = acc.get(id) ?? { csf: new Set(), cis: new Set(), iso: new Set() };
      for (const other of domain.mappings.csf ?? []) entry.csf.add(other);
      for (const other of domain.mappings.cis ?? []) entry.cis.add(other);
      for (const other of domain.mappings.iso ?? []) entry.iso.add(other);
      acc.set(id, entry);
    }
  }
  const out = new Map<string, RelatedControls>();
  for (const [id, sets] of acc) {
    out.set(id, {
      csf: [...sets.csf].sort(),
      cis: [...sets.cis].sort(),
      iso: [...sets.iso].sort(),
    });
  }
  return out;
}

/** Which crosswalk domains cite a given criterion. */
export function domainsForCriterion(id: string, domains: readonly CrosswalkDomain[]): string[] {
  return domains.filter((d) => (d.mappings.soc2 ?? []).includes(id)).map((d) => d.id);
}

/**
 * Criteria the crosswalk does not reach.
 *
 * Reported rather than hidden: a criterion with no crosswalk domain is a gap in
 * the crosswalk, not a criterion that does not matter.
 */
export function unmappedCriteria(data: Soc2Data, domains: readonly CrosswalkDomain[]): string[] {
  const mapped = new Set(domains.flatMap((d) => d.mappings.soc2 ?? []));
  return data.criteria
    .map((c) => c.id)
    .filter((id) => !mapped.has(id))
    .sort(compareIds);
}
