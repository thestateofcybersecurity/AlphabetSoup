/**
 * Turns the policy catalog into a tailored policy set for one organization.
 *
 * Two decisions shape everything here.
 *
 * First, a policy that does not apply is *excluded with a stated reason*, never
 * silently dropped. An assessor reading a policy set needs to see that secure
 * development was considered and ruled out because the organization writes no
 * software, which is a scope statement. A missing document is a finding.
 *
 * Second, coverage is reported against the size of the real framework, not
 * against the subset this site's crosswalk maps. The catalog reaches every
 * mapped control, which would render as 100% if measured against the crosswalk.
 * NIST CSF has 106 subcategories and the crosswalk maps 99 of them, so the
 * honest number is 93%. Telling someone they are fully covered when they are
 * not is the one output this tool must never produce.
 */

export type Tier = 'ig1' | 'ig2' | 'ig3';
export const TIERS: Tier[] = ['ig1', 'ig2', 'ig3'];

export type OrgSize = 'micro' | 'small' | 'mid' | 'large';

export interface Profile {
  orgName: string;
  policyOwner: string;
  reviewCadence: string;
  size: OrgSize;
  /** Explicit tier choice; when absent the tier is derived from the profile. */
  tier?: Tier;
  /** What the organization does and holds, which drives scope and tier. */
  buildsSoftware: boolean;
  hasOffices: boolean;
  usesCloud: boolean;
  cardData: boolean;
  healthData: boolean;
  controlledUnclassified: boolean;
  personalData: boolean;
}

export const EMPTY_PROFILE: Profile = {
  orgName: '',
  policyOwner: '',
  reviewCadence: 'annually',
  size: 'small',
  buildsSoftware: false,
  hasOffices: true,
  usesCloud: true,
  cardData: false,
  healthData: false,
  controlledUnclassified: false,
  personalData: true,
};

export interface CatalogPolicy {
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

export interface Catalog {
  meta: {
    tiers: { id: string; name: string; blurb: string }[];
    placeholders: { token: string; from: string; fallback: string }[];
  };
  policies: CatalogPolicy[];
}

/** Does this organization hold anything that raises the expected baseline? */
export function hasRegulatedData(profile: Profile): boolean {
  return profile.cardData || profile.healthData || profile.controlledUnclassified;
}

/**
 * The Implementation Group this organization should be working to.
 *
 * Follows the CIS framing: IG1 is the floor for everyone, IG2 assumes staff
 * dedicated to security, IG3 assumes a breach would be material. Regulated data
 * pulls the baseline up regardless of headcount, because an obligation does not
 * scale down with the organization holding it.
 */
export function deriveTier(profile: Profile): Tier {
  if (profile.tier) return profile.tier;
  if (profile.size === 'large') return 'ig3';
  if (hasRegulatedData(profile)) return profile.size === 'micro' ? 'ig2' : 'ig3';
  if (profile.size === 'mid') return 'ig2';
  return 'ig1';
}

/** Every tier up to and including the target, since tiers are additive. */
export function tiersUpTo(tier: Tier): Tier[] {
  return TIERS.slice(0, TIERS.indexOf(tier) + 1);
}

export interface Exclusion {
  policy: CatalogPolicy;
  reason: string;
}

export interface Selection {
  included: CatalogPolicy[];
  excluded: Exclusion[];
}

/**
 * Split the catalog into what applies and what does not.
 *
 * Only two policies are ever excluded, and both only on an unambiguous signal.
 * Everything else in the catalog is baseline: an organization that stores no
 * card data still needs an access control policy.
 */
export function selectPolicies(catalog: Catalog, profile: Profile): Selection {
  const included: CatalogPolicy[] = [];
  const excluded: Exclusion[] = [];
  for (const policy of catalog.policies) {
    if (policy.domain === 'appsec' && !profile.buildsSoftware) {
      excluded.push({
        policy,
        reason:
          'Not applicable: this organization does not develop or materially customize software. If that changes, this policy becomes required.',
      });
      continue;
    }
    if (policy.domain === 'physical' && !profile.hasOffices) {
      excluded.push({
        policy,
        reason:
          'Reduced scope: this organization operates no facilities of its own. Physical protection of equipment used by remote workers is covered by the Endpoint and Asset Management policies.',
      });
      continue;
    }
    included.push(policy);
  }
  return { included, excluded };
}

/** Substitute the profile into a catalog string, falling back where unset. */
export function fill(text: string, profile: Profile, catalog: Catalog): string {
  let out = text;
  for (const p of catalog.meta.placeholders) {
    const key = p.from.replace(/^profile\./, '') as keyof Profile;
    const raw = profile[key];
    const value = typeof raw === 'string' && raw.trim() ? raw.trim() : p.fallback;
    out = out.split(p.token).join(value);
  }
  return out;
}

export interface RenderedPolicy {
  id: string;
  title: string;
  summary: string;
  purpose: string;
  scope: string;
  roles: { role: string; responsibility: string }[];
  /** Every statement from IG1 up to the target tier, in order. */
  requirements: { tier: Tier; text: string }[];
  exceptions: string;
  review: string;
  evidence: string[];
  /** Control ids this policy addresses, by framework. */
  mappings: Record<string, string[]>;
}

export interface CrosswalkDomain {
  id: string;
  domain: string;
  mappings: Record<string, string[]>;
}

export function renderPolicy(
  policy: CatalogPolicy,
  profile: Profile,
  tier: Tier,
  catalog: Catalog,
  domains: CrosswalkDomain[],
): RenderedPolicy {
  const f = (s: string): string => fill(s, profile, catalog);
  const requirements = tiersUpTo(tier).flatMap((t) =>
    (policy.tiers[t] ?? []).map((text) => ({ tier: t, text: f(text) })),
  );
  return {
    id: policy.id,
    title: policy.title,
    summary: f(policy.summary),
    purpose: f(policy.purpose),
    scope: f(policy.scope),
    roles: policy.roles.map((r) => ({ role: f(r.role), responsibility: f(r.responsibility) })),
    requirements,
    exceptions: f(policy.exceptions),
    review: f(policy.review),
    evidence: policy.evidence.map(f),
    mappings: domains.find((d) => d.id === policy.domain)?.mappings ?? {},
  };
}

export interface FrameworkCoverage {
  id: string;
  name: string;
  short: string;
  /** Distinct controls the selected policies address. */
  addressed: number;
  /** Controls in the framework itself, when this site holds the full list. */
  frameworkTotal: number | null;
  /** Controls the crosswalk maps, which is always at most frameworkTotal. */
  mapped: number;
  /**
   * Percent of the real framework, or null when this site does not hold the
   * framework's full control list and so cannot know the true denominator.
   */
  percent: number | null;
  /** True when no percentage can be honestly computed. */
  approximate: boolean;
}

export interface Framework {
  id: string;
  name: string;
  short: string;
  total: number;
}

/**
 * Coverage of each framework by the selected policies.
 *
 * `frameworkSizes` carries the real control count for frameworks this site
 * holds in full. Where it is absent, as for ISO and SOC 2 whose control text is
 * not redistributable, the percentage is against the mapped subset and is
 * flagged approximate rather than presented as equivalent.
 */
export function coverage(
  selected: CatalogPolicy[],
  frameworks: Framework[],
  domains: CrosswalkDomain[],
  frameworkSizes: Record<string, number>,
): FrameworkCoverage[] {
  const chosen = new Set(selected.map((p) => p.domain));
  const relevant = domains.filter((d) => chosen.has(d.id));
  return frameworks.map((fw) => {
    const addressed = new Set(relevant.flatMap((d) => d.mappings[fw.id] ?? [])).size;
    const frameworkTotal = frameworkSizes[fw.id] ?? null;
    // Where the full control list is not held, dividing by the mapped subset
    // would render 100% for a framework this catalog only partly reaches. That
    // is worse than reporting nothing, so no percentage is produced.
    return {
      id: fw.id,
      name: fw.name,
      short: fw.short,
      addressed,
      frameworkTotal,
      mapped: fw.total,
      percent:
        frameworkTotal !== null && frameworkTotal > 0
          ? Math.round((addressed / frameworkTotal) * 100)
          : null,
      approximate: frameworkTotal === null,
    };
  });
}

/** Controls the crosswalk maps but the selected policies do not reach. */
export function uncoveredControls(
  selection: Selection,
  frameworkId: string,
  domains: CrosswalkDomain[],
): string[] {
  const chosen = new Set(selection.included.map((p) => p.domain));
  const addressed = new Set(
    domains.filter((d) => chosen.has(d.id)).flatMap((d) => d.mappings[frameworkId] ?? []),
  );
  const all = new Set(domains.flatMap((d) => d.mappings[frameworkId] ?? []));
  return [...all].filter((id) => !addressed.has(id)).sort();
}

const TIER_LABEL: Record<Tier, string> = { ig1: 'IG1', ig2: 'IG2', ig3: 'IG3' };

/** One policy as a Markdown document. */
export function policyToMarkdown(policy: RenderedPolicy, profile: Profile): string {
  const lines: string[] = [`# ${policy.title}`, ''];
  if (profile.orgName.trim()) lines.push(`**Organization:** ${profile.orgName.trim()}`, '');
  lines.push(`## Purpose`, '', policy.purpose, '', `## Scope`, '', policy.scope, '');
  lines.push(`## Roles and responsibilities`, '');
  for (const r of policy.roles) lines.push(`- **${r.role}.** ${r.responsibility}`);
  lines.push('', `## Policy requirements`, '');
  for (const r of policy.requirements) lines.push(`- ${r.text} *(${TIER_LABEL[r.tier]})*`);
  lines.push('', `## Exceptions`, '', policy.exceptions, '');
  lines.push(`## Review`, '', policy.review, '');
  lines.push(`## Evidence an assessor may request`, '');
  for (const e of policy.evidence) lines.push(`- ${e}`);
  const mapped = Object.entries(policy.mappings).filter(([, ids]) => ids.length > 0);
  if (mapped.length > 0) {
    lines.push('', `## Control mapping`, '');
    for (const [fw, ids] of mapped) lines.push(`- **${fw.toUpperCase()}:** ${ids.join(', ')}`);
  }
  return lines.join('\n');
}

/** The whole policy set, including the scope statement for what was excluded. */
export function setToMarkdown(
  rendered: RenderedPolicy[],
  selection: Selection,
  profile: Profile,
  tier: Tier,
  cover: FrameworkCoverage[],
): string {
  const org = profile.orgName.trim() || 'the organization';
  const lines: string[] = [
    `# Information security policy set`,
    '',
    `Prepared for ${org}. Working to ${TIER_LABEL[tier]}.`,
    '',
    `This set contains ${rendered.length} policies.`,
    '',
    `## Framework coverage`,
    '',
    `| Framework | Controls addressed | Of | Coverage |`,
    `| --- | --- | --- | --- |`,
    ...cover.map(
      (c) =>
        `| ${c.name} | ${c.addressed} | ${c.frameworkTotal ?? `${c.mapped} mapped`} | ${c.percent === null ? 'not measured' : `${c.percent}%`} |`,
    ),
    '',
    `Where a framework's full control list is not reproduced on this site, the controls addressed are listed but no percentage is given, because the true denominator is not known here.`,
    '',
    `Coverage counts the controls these policies address. A policy addressing a control is not evidence that the control operates effectively.`,
    '',
  ];
  if (selection.excluded.length > 0) {
    lines.push(`## Policies considered and not included`, '');
    for (const e of selection.excluded) lines.push(`- **${e.policy.title}.** ${e.reason}`);
    lines.push('');
  }
  lines.push(`## Contents`, '');
  for (const p of rendered) lines.push(`- ${p.title}`);
  lines.push('');
  for (const p of rendered) lines.push('---', '', policyToMarkdown(p, profile), '');
  return lines.join('\n');
}
