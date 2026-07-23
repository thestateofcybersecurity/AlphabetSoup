/**
 * Control Crosswalk Mapper: deterministic coverage and gap math over the curated
 * domain-level crosswalk in src/data/crosswalk.json. A domain is "implemented"
 * or not; coverage for a framework is the share of the requirements this
 * crosswalk maps for that framework that an implemented domain satisfies.
 */

export type FrameworkId = 'csf' | 'iso' | 'soc2' | 'cis';

export interface Framework {
  id: FrameworkId;
  name: string;
  short: string;
  /** Distinct requirement IDs this crosswalk maps for the framework (coverage denominator). */
  total: number;
}

export interface CrosswalkControl {
  id: string;
  domain: string;
  summary: string;
  mappings: Record<FrameworkId, string[]>;
}

export interface CrosswalkData {
  meta: { title: string; version: string; note: string; sources: { name: string; url: string }[] };
  frameworks: Framework[];
  controls: CrosswalkControl[];
}

export interface Coverage {
  framework: Framework;
  covered: number;
  total: number;
  pct: number;
}

const uniq = (values: string[]): string[] => [...new Set(values)];

/** Per-framework coverage across the in-scope frameworks, given the implemented domain ids. */
export function coverage(
  data: CrosswalkData,
  implemented: ReadonlySet<string>,
  scope: ReadonlySet<FrameworkId>,
): Coverage[] {
  const done = data.controls.filter((c) => implemented.has(c.id));
  return data.frameworks
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
  const scoped = data.frameworks.filter((f) => scope.has(f.id)).map((f) => f.id);
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
  const scoped = data.frameworks.filter((f) => scope.has(f.id));
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
