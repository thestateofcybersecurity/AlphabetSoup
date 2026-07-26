import { describe, expect, it } from 'vitest';
import rawData from '../src/data/acronyms.json';
import { searchEntries, suggest } from '../src/lib/search';
import type { AcronymData, AcronymIndex } from '../src/lib/types';

/**
 * The homepage searches a lightweight index until the prose chunk arrives, so
 * the two have to agree. They differ in exactly one documented way: the lowest
 * rank matches a term inside an entry's explanation, which the index cannot see.
 *
 * This rebuilds the index the same way the `acronym-index` Vite plugin does, so
 * a field added to one and not the other shows up here.
 */

const full = rawData as AcronymData;

const index: AcronymIndex = Object.fromEntries(
  Object.entries(full).map(([key, entry]) => [
    key,
    {
      display: entry.display,
      expansion: entry.expansion,
      category: entry.category,
      difficulty: entry.difficulty,
    },
  ]),
);

describe('acronym index', () => {
  it('covers every entry', () => {
    expect(Object.keys(index)).toEqual(Object.keys(full));
  });

  it('carries no prose, which is the whole point', () => {
    for (const entry of Object.values(index)) {
      expect(entry).not.toHaveProperty('explanation');
      expect(entry).not.toHaveProperty('sources');
    }
  });

  it('is a small fraction of the full dataset', () => {
    const size = (value: unknown): number => JSON.stringify(value).length;
    // Guards the premise of the split: if the index ever grows to most of the
    // payload, deferring the rest stops being worth the complexity.
    expect(size(index) / size(full)).toBeLessThan(0.2);
  });
});

describe('search parity between the index and the full records', () => {
  const queries = ['siem', 'zero trust', 'authentication', 'MFA', 'cloud', 'x', '2fa', 'nist'];

  it.each(queries)('ranks %s identically apart from prose-only matches', (query) => {
    const fromFull = searchEntries(full, query);
    const fromIndex = searchEntries(index, query);
    // Every index hit must also be a full hit, in the same relative order.
    expect(fromFull).toEqual(expect.arrayContaining(fromIndex));
    const proseOnly = fromFull.filter((key) => !fromIndex.includes(key));
    for (const key of proseOnly) {
      // Anything the index missed must be missing *only* because the term is in
      // the explanation and nowhere else.
      expect(full[key].explanation.toLowerCase()).toContain(query.toLowerCase());
    }
  });

  it('returns the identical set for an empty query', () => {
    expect(searchEntries(index, '')).toEqual(searchEntries(full, ''));
  });

  it.each(['category', 'difficulty'] as const)('filters by %s identically', (field) => {
    const value = Object.values(full)[0][field];
    expect(searchEntries(index, '', { [field]: value })).toEqual(
      searchEntries(full, '', { [field]: value }),
    );
  });

  it('suggests the same correction for a typo', () => {
    for (const typo of ['siwm', 'mfaa', 'zeroo']) {
      expect(suggest(index, typo)).toBe(suggest(full, typo));
    }
  });
});
