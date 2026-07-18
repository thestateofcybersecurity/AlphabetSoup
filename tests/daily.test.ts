import { describe, expect, it } from 'vitest';
import { EPOCH, dailyIndex, dayNumber, localDateString } from '../src/lib/daily';

describe('soup of the day', () => {
  it('starts at day 1 on the epoch', () => {
    expect(dayNumber(EPOCH)).toBe(1);
  });

  it('formats local dates', () => {
    expect(localDateString(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('is deterministic and in bounds', () => {
    for (let n = 1; n <= 800; n++) {
      const idx = dailyIndex(n, 545);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(545);
    }
    expect(dailyIndex(9, 545)).toBe(dailyIndex(9, 545));
  });

  it('visits every entry before repeating for coprime pool sizes', () => {
    const size = 547; // prime
    const seen = new Set<number>();
    for (let n = 1; n <= size; n++) seen.add(dailyIndex(n, size));
    expect(seen.size).toBe(size);
  });
});
