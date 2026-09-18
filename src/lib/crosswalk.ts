/**
 * Control Crosswalk Mapper: deterministic coverage and gap math over the curated
 * domain-level crosswalk in src/data/crosswalk.json. A domain is "implemented"
 * or not; coverage for a framework is the share of the requirements this
 * crosswalk maps for that framework that an implemented domain satisfies.
 *
 * Two kinds of entry share the frameworks list. A `mapped` framework carries
 * identifiers and is scored. A `pending` one is a program-specific model whose
 * content is supplied per engagement: it holds a place in the schema and the UI
 * but never enters the math, because scoring an empty framework would report
 * 0% for something that has simply not been filled in yet.
 */

/**
 * Framework identifiers are open: the crosswalk grows by adding frameworks to
 * the dataset, not by editing a union type here. Callers that need a specific
 * framework still name it as a string literal, which this alias accepts.
 */
export type FrameworkId = string;

/** Framework identifiers whose plain-English pages live on this site. */
export const LINKED_FRAMEWORKS = ['csf', 'cis', 'iso', 'soc2', 'airmf', 'atlas', 'iso42001', 'owaspllm'] as const;

export interface Framework {
  id: FrameworkId;
  name: string;
  short: string;
  /** Grouping for the scope picker, keyed to meta.families. */
  family: string;
  /** What kind of document it is: control-set, benchmark, regulation, taxonomy, and so on. */
  kind: string;
  /** What a mapped identifier refers to, since granularity differs by framework. */
  unit: string;
  version: string;
  url: string;
  /** What this crosswalk does and does not claim about the framework. */
  note: string;
  /** `pending` frameworks are structure only and are excluded from all math. */
  status: 'mapped' | 'pending';
  /** Distinct requirement IDs this crosswalk maps for the framework (coverage denominator). */
  total: number;
}

export interface CrosswalkControl {
  id: string;
  /** Grouping for display, keyed to meta.groups. */
  group: string;
  domain: string;
  summary: string;
  mappings: Record<FrameworkId, string[]>;
}

/** A feed or reference consulted inside a domain. Never scored as coverage. */
export interface Signal {
  id: string;
  name: string;
  short: string;
  status: 'public' | 'pending';
  url: string;
  what: string;
  domains: string[];
}

export interface CrosswalkData {
  meta: {
    title: string;
    version: string;
    note: string;
    groups: { id: string; name: string }[];
    families: { id: string; name: string; blurb: string }[];
    sources: { name: string; url: string }[];
  };
  frameworks: Framework[];
  signals: Signal[];
  controls: CrosswalkControl[];
}

export interface Coverage {
  framework: Framework;
  covered: number;
  total: number;
  pct: number;
}

const uniq = (values: string[]): string[] => [...new Set(values)];

/** Frameworks this crosswalk actually maps, in dataset order. */
export function mappedFrameworks(data: CrosswalkData): Framework[] {
  return data.frameworks.filter((f) => f.status === 'mapped');
}

/** Frameworks whose structure is in place but whose content is supplied per engagement. */
export function pendingFrameworks(data: CrosswalkData): Framework[] {
  return data.frameworks.filter((f) => f.status === 'pending');
}

/** The signals attached to one domain, in dataset order. */
export function signalsFor(data: CrosswalkData, domainId: string): Signal[] {
  return (data.signals ?? []).filter((s) => s.domains.includes(domainId));
}

/** Per-framework coverage across the in-scope frameworks, given the implemented domain ids. */
export function coverage(
  data: CrosswalkData,
  implemented: ReadonlySet<string>,
  scope: ReadonlySet<FrameworkId>,
): Coverage[] {
  const done = data.controls.filter((c) => implemented.has(c.id));
  return mappedFrameworks(data)
    .filter((f) => scope.has(f.id))
    .map((framework) => {
      const covered = uniq(done.flatMap((c) => c.mappings[framework.id] ?? [])).length;
      const total = framework.total;
      return { framework, covered, total, pct: total === 0 ? 0 : Math.round((covered / total) * 100) };
    });
}

export interface GapRow {
  control: CrosswalkControl;
  /** Total mapped requirements this domain would satisfy across the in-scope frameworks. */
  leverage: number;
  perFramework: Partial<Record<FrameworkId, number>>;
}

/**
 * Unimplemented domains ranked by leverage: how many in-scope requirements each
 * one would unlock. Ties break alphabetically by domain for a stable order.
 */
export function gapRegister(
  data: CrosswalkData,
  implemented: ReadonlySet<string>,
  scope: ReadonlySet<FrameworkId>,
): GapRow[] {
  const scoped = mappedFrameworks(data)
    .filter((f) => scope.has(f.id))
    .map((f) => f.id);
  const rows: GapRow[] = data.controls
    .filter((c) => !implemented.has(c.id))
    .map((control) => {
      const perFramework: Partial<Record<FrameworkId, number>> = {};
      let leverage = 0;
      for (const f of scoped) {
        const n = (control.mappings[f] ?? []).length;
        if (n > 0) perFramework[f] = n;
        leverage += n;
      }
      return { control, leverage, perFramework };
    })
    .filter((row) => row.leverage > 0);
  rows.sort((a, b) => b.leverage - a.leverage || a.control.domain.localeCompare(b.control.domain));
  return rows;
}

/** CSV of the gap register (domain, leverage, and per-framework counts) for export. */
export function gapCsv(data: CrosswalkData, rows: GapRow[], scope: ReadonlySet<FrameworkId>): string {
  const scoped = mappedFrameworks(data).filter((f) => scope.has(f.id));
  const header = ['Domain', 'Requirements unlocked', ...scoped.map((f) => f.short)];
  const cell = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(
      [cell(row.control.domain), String(row.leverage), ...scoped.map((f) => String(row.perFramework[f.id] ?? 0))].join(','),
    );
  }
  return lines.join('\n');
}

/**
 * CSV of the whole mapping: one row per domain and framework pair that has
 * identifiers. This is the artifact people ask for when they want to work the
 * crosswalk in a spreadsheet rather than in the browser.
 */
export function mappingCsv(data: CrosswalkData, scope: ReadonlySet<FrameworkId>): string {
  const scoped = mappedFrameworks(data).filter((f) => scope.has(f.id));
  const cell = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = ['Domain,Group,Framework,Mapped identifiers,Count'];
  for (const control of data.controls) {
    for (const framework of scoped) {
      const ids = control.mappings[framework.id] ?? [];
      if (ids.length === 0) continue;
      lines.push(
        [
          cell(control.domain),
          cell(control.group),
          cell(framework.name),
          cell(ids.join(' ')),
          String(ids.length),
        ].join(','),
      );
    }
  }
  return lines.join('\n');
}
