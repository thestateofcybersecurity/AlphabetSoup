import { describe, expect, it } from 'vitest';
import aiFrameworksRaw from '../src/data/ai-frameworks.json';
import dataRaw from '../src/data/ai-cloud-controls.json';
import type { AiData } from '../src/lib/frameworks';
import type { AiCloudControlsData, PhaseId, ProviderId, RefFrameworkId, Selection, TierId } from '../src/lib/ai-cloud-controls';
import {
  LAYER_ORDER,
  PHASE_ORDER,
  TIER_ORDER,
  comparisonByLayer,
  comparisonCsv,
  comparisonRows,
  controlsCsv,
  groupByLayer,
  referenceGroups,
  referencedFrameworks,
  refFramework,
  selectedControls,
  serviceFor,
  tierApplies,
  tierBreakdown,
} from '../src/lib/ai-cloud-controls';

const data = dataRaw as AiCloudControlsData;
const aiFrameworks = aiFrameworksRaw as AiData;
const providers: ProviderId[] = ['aws', 'azure', 'gcp'];

function sel(tier: TierId, provider: ProviderId = 'aws', phases: PhaseId[] = []): Selection {
  return { provider, tier, phases: new Set(phases) };
}

describe('dataset integrity', () => {
  it('has a control set with unique ids', () => {
    const ids = data.controls.map((c) => c.id);
    expect(ids.length).toBeGreaterThan(25);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses only known tiers, layers and phases', () => {
    for (const control of data.controls) {
      expect(TIER_ORDER).toContain(control.tier);
      expect(LAYER_ORDER).toContain(control.layer);
      expect(PHASE_ORDER).toContain(control.phase);
    }
  });

  it('names a native service for every provider on every control', () => {
    for (const control of data.controls) {
      for (const provider of providers) {
        const service = serviceFor(control, provider);
        expect(service, `${control.id} is missing a ${provider} service`).toBeTruthy();
        expect(service.length).toBeGreaterThan(8);
      }
    }
  });

  it('gives every control at least one framework reference', () => {
    for (const control of data.controls) {
      expect(control.refs.length, `${control.id} has no refs`).toBeGreaterThan(0);
    }
  });

  it('uses only reference codes the site actually publishes', () => {
    // Stronger than a format regex, which let "GOVERN 99" through and could not
    // catch an invented ATLAS tactic or ISO clause. Every ref chip deep-links to
    // /frameworks/ai/?q=<code>, so a code that is not in ai-frameworks.json is a
    // link to an empty search result.
    const published = new Set(aiFrameworks.map((entry) => entry.code));
    for (const control of data.controls) {
      for (const ref of control.refs) {
        expect(published.has(ref), `${control.id} cites ${ref}, which /frameworks/ai/ does not publish`).toBe(true);
      }
    }
  });

  it('classifies every ref to the same framework ai-frameworks.json assigns it', () => {
    const byCode = new Map(aiFrameworks.map((entry) => [entry.code, entry.frameworkCode]));
    for (const control of data.controls) {
      for (const ref of control.refs) {
        const classified = refFramework(ref);
        expect(classified, `${control.id} cites ${ref}, which refFramework does not recognise`).not.toBeNull();
        expect(classified?.id, `${ref} classified as ${classified?.id}`).toBe(byCode.get(ref));
      }
    }
  });

  it('cites no source it does not use', () => {
    // The defect this test exists for: meta.sources listed MITRE ATLAS and
    // ISO/IEC 42001 while no control referenced either, so the tool claimed a
    // grounding it did not have.
    const sourceFor: Record<RefFrameworkId, string> = {
      AIRMF: 'NIST AI Risk Management Framework',
      'OWASP-LLM': 'OWASP Top 10 for LLM Applications',
      ATLAS: 'MITRE ATLAS',
      ISO42001: 'ISO/IEC 42001',
    };
    const used = new Set(
      data.controls.flatMap((control) => control.refs.map((ref) => refFramework(ref)?.id)).filter(Boolean),
    );
    for (const [framework, sourceName] of Object.entries(sourceFor)) {
      const cited = data.meta.sources.some((source) => source.name === sourceName);
      expect(cited, `${sourceName} is used by a control but missing from meta.sources`).toBe(used.has(framework as RefFrameworkId));
      expect(used.has(framework as RefFrameworkId), `${sourceName} is cited as a source but no control references it`).toBe(cited);
    }
  });

  it('records when the provider service names were last verified', () => {
    expect(data.meta.servicesVerified).toMatch(/^\d{1,2} [A-Z][a-z]+ \d{4}$/);
  });

  it('uses no em dashes anywhere in the authored copy', () => {
    const prose = [
      data.meta.note,
      ...data.controls.flatMap((c) => [c.objective, c.rationale, ...Object.values(c.services)]),
      ...data.tiers.flatMap((t) => [t.name, t.hint, t.example]),
      ...data.layers.flatMap((l) => [l.name, l.hint]),
      ...data.phases.flatMap((p) => [p.name, p.hint]),
    ].join(' ');
    // Escaped rather than literal so this file stays free of the character too.
    expect(prose).not.toMatch(/\u2014/);
  });

  it('covers every tier and every layer', () => {
    for (const tier of TIER_ORDER) expect(data.controls.some((c) => c.tier === tier)).toBe(true);
    for (const layer of LAYER_ORDER) expect(data.controls.some((c) => c.layer === layer)).toBe(true);
  });

  it('writes distinct objectives', () => {
    const objectives = data.controls.map((c) => c.objective);
    expect(new Set(objectives).size).toBe(objectives.length);
  });
});

describe('tier cumulation', () => {
  it('includes lower tiers and excludes higher ones', () => {
    expect(tierApplies('answers', 'acts')).toBe(true);
    expect(tierApplies('connects', 'acts')).toBe(true);
    expect(tierApplies('acts', 'acts')).toBe(true);
    expect(tierApplies('acts', 'answers')).toBe(false);
    expect(tierApplies('connects', 'answers')).toBe(false);
  });

  it('grows the control count monotonically across tiers', () => {
    const answers = selectedControls(data, sel('answers')).length;
    const connects = selectedControls(data, sel('connects')).length;
    const acts = selectedControls(data, sel('acts')).length;
    expect(connects).toBeGreaterThan(answers);
    expect(acts).toBeGreaterThan(connects);
    expect(acts).toBe(data.controls.length);
  });

  it('selects no agent controls for an answering workload', () => {
    expect(selectedControls(data, sel('answers')).every((c) => c.tier === 'answers')).toBe(true);
  });

  it('marks lower tiers as inherited in the breakdown', () => {
    const breakdown = tierBreakdown(data, sel('acts'));
    expect(breakdown).toHaveLength(3);
    expect(breakdown.find((b) => b.tier === 'answers')?.inherited).toBe(true);
    expect(breakdown.find((b) => b.tier === 'acts')?.inherited).toBe(false);
    const total = breakdown.reduce((sum, b) => sum + b.count, 0);
    expect(total).toBe(selectedControls(data, sel('acts')).length);
  });
});

describe('phase filtering', () => {
  it('returns everything when no phase is selected', () => {
    expect(selectedControls(data, sel('acts', 'aws', [])).length).toBe(data.controls.length);
  });

  it('narrows to the selected phases only', () => {
    const foundational = selectedControls(data, sel('acts', 'aws', ['foundational']));
    expect(foundational.length).toBeGreaterThan(0);
    expect(foundational.every((c) => c.phase === 'foundational')).toBe(true);
  });

  it('partitions cleanly across the three phases', () => {
    const total = PHASE_ORDER.reduce((sum, phase) => sum + selectedControls(data, sel('acts', 'aws', [phase])).length, 0);
    expect(total).toBe(data.controls.length);
  });
});

describe('grouping and output', () => {
  it('orders layers infrastructure first and drops empty groups', () => {
    const groups = groupByLayer(data, sel('acts'));
    expect(groups[0].layer).toBe('infrastructure');
    expect(groups.every((g) => g.controls.length > 0)).toBe(true);
    const flattened = groups.reduce((sum, g) => sum + g.controls.length, 0);
    expect(flattened).toBe(data.controls.length);
  });

  it('is deterministic: the same selection returns the same order', () => {
    const a = selectedControls(data, sel('acts')).map((c) => c.id);
    const b = selectedControls(data, sel('acts')).map((c) => c.id);
    expect(a).toEqual(b);
  });

  it('returns the same controls regardless of provider, differing only in service names', () => {
    const aws = selectedControls(data, sel('acts', 'aws')).map((c) => c.id);
    const gcp = selectedControls(data, sel('acts', 'gcp')).map((c) => c.id);
    expect(aws).toEqual(gcp);
  });

  it('collects framework references without duplicates', () => {
    const refs = referencedFrameworks(data, sel('acts'));
    expect(refs.length).toBeGreaterThan(5);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it('exports a CSV row per control plus a header, with the provider service', () => {
    const csv = controlsCsv(data, sel('connects', 'azure'));
    const lines = csv.split('\n');
    expect(lines).toHaveLength(selectedControls(data, sel('connects')).length + 1);
    expect(lines[0]).toContain('Azure service');
    expect(csv).toContain('Microsoft');
  });

  it('quotes CSV fields containing commas', () => {
    const csv = controlsCsv(data, sel('acts'));
    for (const line of csv.split('\n')) {
      const unquotedCommaRuns = line.replace(/"[^"]*"/g, '');
      expect(unquotedCommaRuns.split(',').length).toBeLessThanOrEqual(7);
    }
  });
});

describe('framework reference grouping', () => {
  it('recognises all four vocabularies and rejects anything else', () => {
    expect(refFramework('GOVERN 1')?.id).toBe('AIRMF');
    expect(refFramework('LLM01')?.id).toBe('OWASP-LLM');
    expect(refFramework('AML.TA0010')?.id).toBe('ATLAS');
    expect(refFramework('Clause 6')?.id).toBe('ISO42001');
    expect(refFramework('Annex A')?.id).toBe('ISO42001');
    expect(refFramework('CIS 1.1')).toBeNull();
    expect(refFramework('LLM1')).toBeNull();
    expect(refFramework('GOVERN')).toBeNull();
  });

  it('groups the in-scope references by framework in a stable order', () => {
    const groups = referenceGroups(data, sel('acts'));
    expect(groups.map((g) => g.framework.id)).toEqual(['AIRMF', 'OWASP-LLM', 'ATLAS', 'ISO42001']);
    const flattened = groups.flatMap((g) => g.codes);
    expect(new Set(flattened).size).toBe(flattened.length);
    expect([...flattened].sort()).toEqual([...referencedFrameworks(data, sel('acts'))].sort());
  });

  it('drops frameworks that the narrowed selection never reaches', () => {
    const ids = referenceGroups(data, sel('answers', 'aws', ['foundational'])).map((g) => g.framework.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBeLessThanOrEqual(4);
  });
});

describe('cloud comparison', () => {
  it('returns one row per in-scope control with a cell per provider', () => {
    const rows = comparisonRows(data, sel('acts'));
    expect(rows).toHaveLength(data.controls.length);
    for (const row of rows) {
      expect(row.cells.map((cell) => cell.provider)).toEqual(providers);
      for (const cell of row.cells) {
        expect(cell.service, `${row.control.id} has no ${cell.provider} service`).toBeTruthy();
        expect(cell.name).toBeTruthy();
      }
    }
  });

  it('resolves each cell to exactly what the single-cloud view would show', () => {
    // The comparison must not be a second, drifting source of truth. Every cell
    // is the same string serviceFor returns for that provider.
    for (const row of comparisonRows(data, sel('acts'))) {
      for (const cell of row.cells) {
        expect(cell.service).toBe(serviceFor(row.control, cell.provider));
      }
    }
  });

  it('honours the tier and phase filters the same way the single-cloud view does', () => {
    for (const tier of TIER_ORDER) {
      for (const phase of PHASE_ORDER) {
        const selection = sel(tier, 'aws', [phase]);
        expect(comparisonRows(data, selection).map((r) => r.control.id)).toEqual(
          selectedControls(data, selection).map((c) => c.id),
        );
      }
    }
  });

  it('groups comparison rows by layer exactly as the single-cloud view groups controls', () => {
    const compare = comparisonByLayer(data, sel('acts'));
    const single = groupByLayer(data, sel('acts'));
    expect(compare.map((g) => g.layer)).toEqual(single.map((g) => g.layer));
    expect(compare.map((g) => g.rows.map((r) => r.control.id))).toEqual(single.map((g) => g.controls.map((c) => c.id)));
  });

  it('exports a CSV with a column per provider and the same row count', () => {
    const selection = sel('connects', 'aws');
    const lines = comparisonCsv(data, selection).split('\n');
    expect(lines).toHaveLength(selectedControls(data, selection).length + 1);
    for (const provider of data.providers) {
      expect(lines[0]).toContain(`${provider.name} service`);
    }
  });

  it('puts every provider service into the comparison CSV', () => {
    const selection = sel('acts', 'aws');
    const csv = comparisonCsv(data, selection);
    for (const control of selectedControls(data, selection)) {
      for (const provider of providers) {
        // Commas inside a service string are quoted, so compare against the cell
        // body rather than the raw string.
        const service = serviceFor(control, provider);
        expect(csv.includes(service) || csv.includes(service.replace(/"/g, '""'))).toBe(true);
      }
    }
  });

  it('says something different about each cloud on most controls', () => {
    // If the three columns were mostly identical the comparison view would be
    // decoration. This pins the premise that the clouds really do diverge.
    const rows = comparisonRows(data, sel('acts'));
    const distinct = rows.filter((row) => new Set(row.cells.map((c) => c.service)).size === 3);
    expect(distinct.length).toBe(rows.length);
  });
});
