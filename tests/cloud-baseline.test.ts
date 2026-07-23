import { describe, expect, it } from 'vitest';
import dataRaw from '../src/data/cloud-baseline.json';
import {
  buildPlan,
  complianceCoverage,
  DOMAIN_ORDER,
  effectiveWindow,
  inScope,
  planCsv,
  selectedControls,
  type CloudBaselineData,
  type ComplianceId,
  type Control,
  type ProviderId,
  type Selection,
} from '../src/lib/cloud-baseline';

const data = dataRaw as CloudBaselineData;

const ctl = (over: Partial<Control>): Control => ({
  id: 'x',
  provider: 'aws',
  domain: 'identity',
  title: 'T',
  rationale: 'R',
  priority: 'high',
  workloads: ['saas', 'corp-it', 'data-platform'],
  compliance: ['soc2'],
  ...over,
});

const sel = (over: Partial<Selection>): Selection => ({
  providers: new Set<ProviderId>(['aws']),
  workload: null,
  compliance: new Set<ComplianceId>(),
  ...over,
});

describe('inScope', () => {
  it('filters by provider', () => {
    expect(inScope(ctl({ provider: 'azure' }), sel({}))).toBe(false);
    expect(inScope(ctl({ provider: 'aws' }), sel({}))).toBe(true);
  });
  it('filters by workload when one is chosen', () => {
    const c = ctl({ workloads: ['data-platform'] });
    expect(inScope(c, sel({ workload: 'saas' }))).toBe(false);
    expect(inScope(c, sel({ workload: 'data-platform' }))).toBe(true);
    expect(inScope(c, sel({ workload: null }))).toBe(true);
  });
});

describe('effectiveWindow', () => {
  const none = new Set<ComplianceId>();
  it('maps priority to a base window', () => {
    expect(effectiveWindow(ctl({ priority: 'critical' }), none)).toBe(30);
    expect(effectiveWindow(ctl({ priority: 'high' }), none)).toBe(60);
    expect(effectiveWindow(ctl({ priority: 'standard' }), none)).toBe(90);
  });
  it('pulls a control one window earlier when it serves a selected target', () => {
    const target = new Set<ComplianceId>(['pci']);
    expect(effectiveWindow(ctl({ priority: 'standard', compliance: ['pci'] }), target)).toBe(60);
    expect(effectiveWindow(ctl({ priority: 'high', compliance: ['pci'] }), target)).toBe(30);
    expect(effectiveWindow(ctl({ priority: 'critical', compliance: ['pci'] }), target)).toBe(30);
  });
  it('does not pull when the control does not serve the target', () => {
    expect(effectiveWindow(ctl({ priority: 'standard', compliance: ['soc2'] }), new Set(['pci']))).toBe(90);
  });
});

describe('buildPlan', () => {
  const mini: CloudBaselineData = {
    ...data,
    controls: [
      ctl({ id: 'a', domain: 'data', priority: 'standard', compliance: [] }),
      ctl({ id: 'b', domain: 'identity', priority: 'critical', compliance: [] }),
      ctl({ id: 'c', domain: 'logging', priority: 'high', compliance: [] }),
    ],
  };
  it('buckets by window and orders identity-first within a window', () => {
    const plan = buildPlan(mini, sel({}));
    const byWindow = Object.fromEntries(plan.windows.map((w) => [w.window, w.controls.map((c) => c.id)]));
    expect(byWindow[30]).toEqual(['b']);
    expect(byWindow[60]).toEqual(['c']);
    expect(byWindow[90]).toEqual(['a']);
    expect(plan.total).toBe(3);
  });
  it('reflects compliance pulls in the buckets', () => {
    const plan = buildPlan(
      { ...data, controls: [ctl({ id: 'z', priority: 'standard', compliance: ['hipaa'] })] },
      sel({ compliance: new Set(['hipaa']) }),
    );
    expect(plan.windows.find((w) => w.window === 60)!.controls.map((c) => c.id)).toEqual(['z']);
  });
});

describe('complianceCoverage', () => {
  it('counts in-scope controls per selected target', () => {
    const mini: CloudBaselineData = {
      ...data,
      controls: [ctl({ id: 'a', compliance: ['pci', 'soc2'] }), ctl({ id: 'b', compliance: ['soc2'] })],
    };
    const cov = complianceCoverage(mini, sel({ compliance: new Set(['pci', 'soc2']) }));
    expect(cov.find((c) => c.id === 'pci')!.count).toBe(1);
    expect(cov.find((c) => c.id === 'soc2')!.count).toBe(2);
  });
});

describe('planCsv', () => {
  it('emits a header and one row per in-scope control', () => {
    const mini: CloudBaselineData = { ...data, controls: [ctl({ id: 'a', title: 'Do, a thing', cisRef: 'CIS 1.1' })] };
    const rows = planCsv(mini, sel({})).split('\n');
    expect(rows[0]).toBe('Window,Provider,Domain,Priority,Control,CIS reference,Compliance');
    expect(rows[1]).toContain('"Do, a thing"');
    expect(rows[1]).toContain('CIS 1.1');
  });
});

describe('cloud-baseline.json data integrity', () => {
  const DOMAINS = new Set(DOMAIN_ORDER);
  const PRIORITIES = new Set(['critical', 'high', 'standard']);
  const PROVIDERS = new Set(['aws', 'azure', 'gcp']);
  const WORKLOADS = new Set(['saas', 'corp-it', 'data-platform']);
  const COMPLIANCE = new Set(['soc2', 'hipaa', 'cmmc', 'pci']);

  it('has unique control ids and each provider is represented', () => {
    const ids = data.controls.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PROVIDERS) expect(data.controls.some((c) => c.provider === p), p).toBe(true);
  });

  it('uses valid enums and non-empty workloads', () => {
    for (const c of data.controls) {
      expect(PROVIDERS.has(c.provider), c.id).toBe(true);
      expect(DOMAINS.has(c.domain), c.id).toBe(true);
      expect(PRIORITIES.has(c.priority), c.id).toBe(true);
      expect(c.workloads.length, c.id).toBeGreaterThan(0);
      expect(c.workloads.every((w) => WORKLOADS.has(w)), c.id).toBe(true);
      expect(c.compliance.every((x) => COMPLIANCE.has(x)), c.id).toBe(true);
    }
  });

  it('has no em dashes and titles within length', () => {
    for (const c of data.controls) {
      for (const f of [c.title, c.rationale, c.cisRef ?? ''] as string[]) expect(f, c.id).not.toMatch(/—/);
      expect(c.title.length, c.id).toBeLessThanOrEqual(95);
    }
  });

  it('every control is reachable by selecting its provider with all workloads', () => {
    for (const p of PROVIDERS) {
      const reached = selectedControls(data, sel({ providers: new Set([p as ProviderId]) }));
      expect(reached.length).toBe(data.controls.filter((c) => c.provider === p).length);
    }
  });
});
