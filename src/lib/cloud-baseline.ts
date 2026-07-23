/**
 * Cloud Security Baseline Generator: deterministic prioritization over the
 * per-provider control ruleset in src/data/cloud-baseline.json. Controls are
 * filtered by provider and workload, ordered identity-first, and bucketed into
 * a 30/60/90 day plan, with compliance selection pulling relevant controls
 * earlier. All functions are pure.
 */

export type Domain = 'identity' | 'logging' | 'network' | 'workload' | 'data';
export type Priority = 'critical' | 'high' | 'standard';
export type ProviderId = 'aws' | 'azure' | 'gcp';
export type WorkloadId = 'saas' | 'corp-it' | 'data-platform';
export type ComplianceId = 'soc2' | 'hipaa' | 'cmmc' | 'pci';
export type PlanWindow = 30 | 60 | 90;

export interface Control {
  id: string;
  provider: ProviderId;
  domain: Domain;
  title: string;
  rationale: string;
  priority: Priority;
  workloads: WorkloadId[];
  compliance: ComplianceId[];
  cisRef?: string;
}

export interface CloudBaselineData {
  meta: { title: string; version: string; note: string; sources: { name: string; url: string }[] };
  providers: { id: ProviderId; name: string }[];
  workloads: { id: WorkloadId; name: string; hint: string }[];
  compliance: { id: ComplianceId; name: string }[];
  domains: { id: Domain; name: string }[];
  controls: Control[];
}

export interface Selection {
  providers: ReadonlySet<ProviderId>;
  workload: WorkloadId | null;
  compliance: ReadonlySet<ComplianceId>;
}

export const DOMAIN_ORDER: Domain[] = ['identity', 'logging', 'network', 'workload', 'data'];
const DOMAIN_RANK: Record<Domain, number> = { identity: 0, logging: 1, network: 2, workload: 3, data: 4 };
const PRIORITY_RANK: Record<Priority, number> = { critical: 0, high: 1, standard: 2 };
const BASE_WINDOW: Record<Priority, PlanWindow> = { critical: 30, high: 60, standard: 90 };

/** A control applies when its provider is selected and it fits the workload (if one is chosen). */
export function inScope(control: Control, selection: Selection): boolean {
  if (!selection.providers.has(control.provider)) return false;
  if (selection.workload && !control.workloads.includes(selection.workload)) return false;
  return true;
}

/** True when the control materially supports at least one selected compliance target. */
export function servesSelectedCompliance(control: Control, compliance: ReadonlySet<ComplianceId>): boolean {
  return control.compliance.some((c) => compliance.has(c));
}

/**
 * The 30/60/90 window for a control: its priority sets the base, and a control
 * that supports a selected compliance target is pulled one window earlier.
 */
export function effectiveWindow(control: Control, compliance: ReadonlySet<ComplianceId>): PlanWindow {
  const base = BASE_WINDOW[control.priority];
  if (base > 30 && servesSelectedCompliance(control, compliance)) {
    return base === 90 ? 60 : 30;
  }
  return base;
}

function compareControls(a: Control, b: Control): number {
  return (
    DOMAIN_RANK[a.domain] - DOMAIN_RANK[b.domain] ||
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
    a.title.localeCompare(b.title)
  );
}

export function selectedControls(data: CloudBaselineData, selection: Selection): Control[] {
  return data.controls.filter((c) => inScope(c, selection)).sort(compareControls);
}

export interface Plan {
  windows: { window: PlanWindow; controls: Control[] }[];
  total: number;
}

/** Group in-scope controls into 30/60/90 buckets, each ordered identity-first. */
export function buildPlan(data: CloudBaselineData, selection: Selection): Plan {
  const scoped = data.controls.filter((c) => inScope(c, selection));
  const buckets: Record<PlanWindow, Control[]> = { 30: [], 60: [], 90: [] };
  for (const control of scoped) buckets[effectiveWindow(control, selection.compliance)].push(control);
  const windows = ([30, 60, 90] as PlanWindow[]).map((window) => ({
    window,
    controls: buckets[window].sort(compareControls),
  }));
  return { windows, total: scoped.length };
}

export interface ComplianceCoverage {
  id: ComplianceId;
  name: string;
  count: number;
}

/** For each selected target, how many in-scope controls support it. */
export function complianceCoverage(data: CloudBaselineData, selection: Selection): ComplianceCoverage[] {
  const scoped = data.controls.filter((c) => inScope(c, selection));
  return data.compliance
    .filter((t) => selection.compliance.has(t.id))
    .map((t) => ({ id: t.id, name: t.name, count: scoped.filter((c) => c.compliance.includes(t.id)).length }));
}

/** CSV of the ordered plan for export. */
export function planCsv(data: CloudBaselineData, selection: Selection): string {
  const providerName = new Map(data.providers.map((p) => [p.id, p.name]));
  const header = ['Window', 'Provider', 'Domain', 'Priority', 'Control', 'CIS reference', 'Compliance'];
  const cell = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [header.join(',')];
  for (const { window, controls } of buildPlan(data, selection).windows) {
    for (const c of controls) {
      lines.push(
        [
          `${window} day`,
          providerName.get(c.provider) ?? c.provider,
          c.domain,
          c.priority,
          c.title,
          c.cisRef ?? '',
          c.compliance.join(' '),
        ]
          .map(cell)
          .join(','),
      );
    }
  }
  return lines.join('\n');
}
