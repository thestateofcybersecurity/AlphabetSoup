import { describe, expect, it } from 'vitest';
import csfRaw from '../src/data/nist-csf.json';
import cisRaw from '../src/data/cis.json';
import mapRaw from '../src/data/csf-cis-map.json';
import deckIndex from '../src/data/quiz/index.json';
import type { CisData, CsfData } from '../src/lib/frameworks';
import type { DeckMeta } from '../src/lib/quiz';
import { latestDelta, recordSnapshot } from '../src/lib/assessment';
import { crossSearch } from '../src/lib/global-search';

const csf = csfRaw as CsfData;
const cis = cisRaw as CisData;
const decks = deckIndex as DeckMeta[];

describe('csf-cis mapping', () => {
  const map = mapRaw as Record<string, string[]>;

  it('covers every CSF subcategory with only valid CIS ids', () => {
    expect(Object.keys(map).sort()).toEqual(Object.keys(csf).sort());
    for (const [csfId, cisIds] of Object.entries(map)) {
      expect(new Set(cisIds).size).toBe(cisIds.length);
      for (const cisId of cisIds) {
        expect(cis[cisId], `${csfId} -> ${cisId}`).toBeDefined();
      }
    }
  });

  it('has substantial coverage without stretch-filling', () => {
    const nonEmpty = Object.values(map).filter((v) => v.length > 0).length;
    expect(nonEmpty).toBeGreaterThan(60);
    const pairs = Object.values(map).reduce((sum, v) => sum + v.length, 0);
    expect(pairs).toBeGreaterThan(150);
    expect(Object.values(map).every((v) => v.length <= 12)).toBe(true);
  });
});

describe('assessment history', () => {
  it('keeps one snapshot per day, sorted, capped at 24', () => {
    let history = recordSnapshot([], 40, '2026-07-01');
    history = recordSnapshot(history, 45, '2026-07-01'); // same day replaces
    history = recordSnapshot(history, 60, '2026-07-15');
    expect(history).toEqual([
      { date: '2026-07-01', overall: 45 },
      { date: '2026-07-15', overall: 60 },
    ]);
    for (let day = 1; day <= 30; day++) {
      history = recordSnapshot(history, day, `2026-08-${String(day).padStart(2, '0')}`);
    }
    expect(history).toHaveLength(24);
  });

  it('reports the delta since the previous snapshot', () => {
    const history = [
      { date: '2026-06-01', overall: 40 },
      { date: '2026-07-01', overall: 52 },
    ];
    expect(latestDelta(history)).toEqual({ delta: 12, since: '2026-06-01' });
    expect(latestDelta(history.slice(1))).toBeNull();
  });
});

describe('crossSearch', () => {
  it('finds CSF subcategories by id', () => {
    const hits = crossSearch('gv.oc-01', csf, cis, decks);
    expect(hits[0].section).toBe('NIST CSF');
    expect(hits[0].href).toBe('frameworks/nist-csf/gv-oc-01.html');
  });

  it('finds CIS safeguards by id and topic', () => {
    const byId = crossSearch('8.1', csf, cis, decks);
    expect(byId.some((h) => h.href === 'frameworks/cis/8-1.html')).toBe(true);
    const byTopic = crossSearch('audit log', csf, cis, decks);
    expect(byTopic.some((h) => h.section === 'CIS Controls')).toBe(true);
  });

  it('finds quiz decks by cert name', () => {
    const hits = crossSearch('cissp', csf, cis, decks);
    expect(hits.some((h) => h.section === 'Quiz' && h.href === 'quiz/?deck=cissp')).toBe(true);
  });

  it('caps results and ignores short queries', () => {
    expect(crossSearch('a', csf, cis, decks)).toEqual([]);
    expect(crossSearch('security', csf, cis, decks).length).toBeLessThanOrEqual(5);
  });
});
