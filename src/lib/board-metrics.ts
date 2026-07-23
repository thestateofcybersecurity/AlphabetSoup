/**
 * Board Metrics Builder: deterministic status, trend, and talk-track logic over
 * the curated KPI/KRI catalog in src/data/board-metrics.json. All math is pure
 * so the board summary is reproducible from the same inputs.
 */

export type Direction = 'higher-better' | 'lower-better';
export type Unit = '%' | 'days' | 'count' | 'hours';
export type Status = 'good' | 'watch' | 'act';

export interface Metric {
  id: string;
  name: string;
  short: string;
  unit: Unit;
  category: string;
  question: string;
  definition: string;
  direction: Direction;
  thresholds: { good: number; act: number };
  boardFraming: string;
}

export interface BoardMetricsData {
  meta: { title: string; version: string; note: string; sources: { name: string; url: string }[] };
  metrics: Metric[];
}

/** Where a value falls against a metric's anchored good/watch/act bands. */
export function status(metric: Metric, value: number): Status {
  const { good, act } = metric.thresholds;
  if (metric.direction === 'higher-better') {
    if (value >= good) return 'good';
    if (value <= act) return 'act';
    return 'watch';
  }
  if (value <= good) return 'good';
  if (value >= act) return 'act';
  return 'watch';
}

export const STATUS_LABEL: Record<Status, string> = { good: 'Good', watch: 'Watch', act: 'Act' };

export type Movement = 'improving' | 'worsening' | 'flat';

export interface Trend {
  movement: Movement;
  /** Signed change in the metric's own unit (current minus prior). */
  delta: number;
  /** Arrow describing the raw direction of change, independent of good/bad. */
  arrow: 'up' | 'down' | 'flat';
}

/** Quarter-over-quarter movement, judged good/bad by the metric's direction. */
export function trend(metric: Metric, current: number, prior: number): Trend {
  const delta = round(current - prior);
  const arrow = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  if (delta === 0) return { movement: 'flat', delta, arrow };
  const rising = delta > 0;
  const goodWhenRising = metric.direction === 'higher-better';
  return { movement: rising === goodWhenRising ? 'improving' : 'worsening', delta, arrow };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatValue(metric: Metric, value: number): string {
  if (metric.unit === '%') return `${round(value)}%`;
  if (metric.unit === 'days') return `${round(value)} day${value === 1 ? '' : 's'}`;
  if (metric.unit === 'hours') return `${round(value)} hour${value === 1 ? '' : 's'}`;
  return String(round(value));
}

export interface MetricReading {
  metric: Metric;
  current: number;
  prior?: number;
  status: Status;
  trend?: Trend;
}

/** A deterministic, board-ready sentence summarizing one metric reading. */
export function talkTrack(reading: MetricReading): string {
  const { metric, current, status: s } = reading;
  const value = formatValue(metric, current);
  const head = `${metric.name} sits at ${value} (${STATUS_LABEL[s].toLowerCase()}).`;
  let move = '';
  if (reading.trend && reading.prior !== undefined) {
    if (reading.trend.movement === 'flat') {
      move = ' Flat versus last period.';
    } else {
      const mag = formatValue(metric, Math.abs(reading.trend.delta));
      const word = reading.trend.movement === 'improving' ? 'improved' : 'worsened';
      move = ` ${word} by ${mag} versus last period.`;
    }
  }
  return `${head}${move} ${metric.boardFraming}`;
}

/** Build a full reading for a metric given raw current/prior inputs. */
export function read(metric: Metric, current: number, prior?: number): MetricReading {
  return {
    metric,
    current,
    prior,
    status: status(metric, current),
    trend: prior === undefined ? undefined : trend(metric, current, prior),
  };
}

const STATUS_RANK: Record<Status, number> = { act: 0, watch: 1, good: 2 };

/** Readings ordered worst-first so the board sees what needs attention up top. */
export function prioritize(readings: MetricReading[]): MetricReading[] {
  return [...readings].sort(
    (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.metric.name.localeCompare(b.metric.name),
  );
}

export interface StatusTally {
  good: number;
  watch: number;
  act: number;
}

export function tally(readings: MetricReading[]): StatusTally {
  return readings.reduce<StatusTally>(
    (acc, r) => {
      acc[r.status] += 1;
      return acc;
    },
    { good: 0, watch: 0, act: 0 },
  );
}
