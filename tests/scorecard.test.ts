import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import scorecard from '../src/data/scorecard.json';

const root = fileURLToPath(new URL('..', import.meta.url));

describe('scorecard dataset', () => {
  it('has ten cards with unique ranks 1 through 10', () => {
    expect(scorecard.cards).toHaveLength(10);
    const ranks = scorecard.cards.map((card) => card.rank).sort((a, b) => a - b);
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const ids = new Set(scorecard.cards.map((card) => card.id));
    expect(ids.size).toBe(10);
  });

  it('keeps every card complete and plausible', () => {
    for (const card of scorecard.cards) {
      expect(card.frequencyPct).toBeGreaterThanOrEqual(1);
      expect(card.frequencyPct).toBeLessThanOrEqual(100);
      expect(card.title.length).toBeGreaterThan(5);
      expect(card.plainEnglish.length).toBeGreaterThan(80);
      expect(card.whyItMatters.length).toBeGreaterThan(80);
      expect(card.howJDsSayIt.length).toBeGreaterThanOrEqual(2);
      const tool = card.onTheJobTool;
      expect(tool.name.length).toBeGreaterThan(3);
      expect(tool.elevatorPitch.length).toBeGreaterThan(40);
      expect(tool.day1Value.length).toBeGreaterThan(40);
      expect(['live', 'planned']).toContain(tool.status);
    }
  });

  it('points every live tool at a page that exists', () => {
    const live = scorecard.cards.filter((card) => card.onTheJobTool.status === 'live');
    expect(live.length).toBeGreaterThanOrEqual(1);
    for (const card of live) {
      const href = card.onTheJobTool.href;
      expect(href, `live tool on ${card.id} needs an href`).toBeTruthy();
      expect(existsSync(`${root}tools/${href}index.html`), `tools/${href}index.html missing`).toBe(true);
    }
  });

  it('contains no em dashes', () => {
    expect(JSON.stringify(scorecard)).not.toMatch(/—/);
  });
});
