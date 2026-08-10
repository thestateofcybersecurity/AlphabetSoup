import { describe, expect, it } from 'vitest';
import dataRaw from '../src/data/ai-cloud-controls.json';
import type { AiCloudControlsData, PhaseId, ProviderId, Selection, TierId } from '../src/lib/ai-cloud-controls';
import {
  LAYER_ORDER,
  PHASE_ORDER,
  TIER_ORDER,
  controlsCsv,
  groupByLayer,
  referencedFrameworks,
  selectedControls,
  serviceFor,
  tierApplies,
  tierBreakdown,
} from '../src/lib/ai-cloud-controls';

const data = dataRaw as AiCloudControlsData;
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

  it('uses framework references in the site-wide format', () => {
    const pattern = /^(LLM\d{2}|(GOVERN|MAP|MEASURE|MANAGE) \d+)$/;
    for (const control of data.controls) {
      for (const ref of control.refs) {
        expect(ref, `${control.id} has an off-format ref: ${ref}`).toMatch(pattern);
      }
    }
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
