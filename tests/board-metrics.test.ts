import { describe, expect, it } from 'vitest';
import dataRaw from '../src/data/board-metrics.json';
import {
  formatValue,
  prioritize,
  read,
  status,
  talkTrack,
  tally,
  trend,
  type BoardMetricsData,
  type Metric,
} from '../src/lib/board-metrics';

const data = dataRaw as BoardMetricsData;

const higher: Metric = {
  id: 'cov',
  name: 'Coverage',
  short: 'Coverage',
  unit: '%',
  category: 'Exposure',
  question: 'q',
  definition: 'd',
  direction: 'higher-better',
  thresholds: { good: 95, act: 80 },
  boardFraming: 'Gaps are blind spots.',
};
const lower: Metric = {
  id: 'mttr',
  name: 'MTTR',
  short: 'MTTR',
  unit: 'hours',
  category: 'Response',
  question: 'q',
  definition: 'd',
  direction: 'lower-better',
  thresholds: { good: 8, act: 24 },
  boardFraming: 'Slow response costs money.',
};

describe('status', () => {
  it('bands higher-better values', () => {
    expect(status(higher, 96)).toBe('good');
    expect(status(higher, 95)).toBe('good');
    expect(status(higher, 88)).toBe('watch');
    expect(status(higher, 80)).toBe('act');
    expect(status(higher, 70)).toBe('act');
  });
  it('bands lower-better values', () => {
    expect(status(lower, 6)).toBe('good');
    expect(status(lower, 8)).toBe('good');
    expect(status(lower, 15)).toBe('watch');
    expect(status(lower, 24)).toBe('act');
    expect(status(lower, 40)).toBe('act');
  });
});

describe('trend', () => {
  it('reads a rise on a higher-better metric as improving', () => {
    expect(trend(higher, 90, 82)).toMatchObject({ movement: 'improving', arrow: 'up', delta: 8 });
  });
  it('reads a rise on a lower-better metric as worsening', () => {
    expect(trend(lower, 20, 10)).toMatchObject({ movement: 'worsening', arrow: 'up', delta: 10 });
  });
  it('reads a fall on a lower-better metric as improving', () => {
    expect(trend(lower, 6, 12)).toMatchObject({ movement: 'improving', arrow: 'down', delta: -6 });
  });
  it('reads no change as flat', () => {
    expect(trend(higher, 90, 90)).toMatchObject({ movement: 'flat', arrow: 'flat', delta: 0 });
  });
});

describe('formatValue', () => {
  it('renders units and singular/plural', () => {
    expect(formatValue(higher, 92.5)).toBe('92.5%');
    expect(formatValue(lower, 1)).toBe('1 hour');
    expect(formatValue(lower, 8)).toBe('8 hours');
    expect(formatValue({ ...lower, unit: 'count' }, 3)).toBe('3');
  });
});

describe('talkTrack', () => {
  it('states value, movement, and board framing', () => {
    const r = read(lower, 6, 12);
    const line = talkTrack(r);
    expect(line).toContain('6 hours');
    expect(line).toContain('good');
    expect(line).toContain('improved by 6 hours');
    expect(line).toContain('Slow response costs money.');
  });
  it('omits movement when there is no prior', () => {
    const line = talkTrack(read(higher, 96));
    expect(line).not.toMatch(/versus last period/);
  });
});

describe('prioritize and tally', () => {
  it('orders worst-first and counts by status', () => {
    const readings = [read(higher, 96), read(lower, 40), read(higher, 88)];
    const ordered = prioritize(readings);
    expect(ordered.map((r) => r.status)).toEqual(['act', 'watch', 'good']);
    expect(tally(readings)).toEqual({ good: 1, watch: 1, act: 1 });
  });
});

describe('board-metrics.json data integrity', () => {
  it('has 12 metrics with unique ids and valid enums', () => {
    expect(data.metrics).toHaveLength(12);
    const ids = new Set(data.metrics.map((m) => m.id));
    expect(ids.size).toBe(12);
    for (const m of data.metrics) {
      expect(['higher-better', 'lower-better']).toContain(m.direction);
      expect(['%', 'days', 'count', 'hours']).toContain(m.unit);
    }
  });

  it('orders thresholds correctly for the metric direction', () => {
    for (const m of data.metrics) {
      if (m.direction === 'higher-better') expect(m.thresholds.good, m.id).toBeGreaterThanOrEqual(m.thresholds.act);
      else expect(m.thresholds.good, m.id).toBeLessThanOrEqual(m.thresholds.act);
    }
  });

  it('has no em dashes and respects label lengths', () => {
    for (const m of data.metrics) {
      for (const field of ['name', 'short', 'question', 'definition', 'boardFraming'] as const) {
        expect(m[field], `${m.id}.${field}`).not.toMatch(/—/);
        expect(m[field].trim().length).toBeGreaterThan(0);
      }
      expect(m.name.length, m.id).toBeLessThanOrEqual(42);
      expect(m.short.length, m.id).toBeLessThanOrEqual(18);
    }
  });
});
