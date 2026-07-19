import { describe, expect, it } from 'vitest';
import rawData from '../src/data/acronyms.json';
import { suggest } from '../src/lib/search';
import { relatedFor } from '../src/lib/related';
import type { AcronymData } from '../src/lib/types';

const data = rawData as AcronymData;

describe('did-you-mean suggestions', () => {
  it('finds the nearest acronym for a typo', () => {
    expect(suggest(data, 'SIEMM')).toBe('SIEM'); // one extra letter
    expect(suggest(data, 'fireawll')).toBeNull(); // not an acronym key
  });

  it('does not suggest for an exact match or gibberish', () => {
    expect(suggest(data, 'SIEM')).toBeNull(); // already correct
    expect(suggest(data, 'zzzzzzzz')).toBeNull();
    expect(suggest(data, 'x')).toBeNull(); // too short
  });
});

describe('related terms', () => {
  const fixture: AcronymData = {
    AAA: { display: 'AAA', expansion: 'x', category: 'identity', difficulty: 'easy', explanation: '', sources: [], related: ['BBB', 'ZZZ'] },
    BBB: { display: 'BBB', expansion: 'shared word alpha', category: 'identity', difficulty: 'easy', explanation: '', sources: [] },
    CCC: { display: 'CCC', expansion: 'shared word alpha beta', category: 'identity', difficulty: 'easy', explanation: '', sources: [] },
    DDD: { display: 'DDD', expansion: 'unrelated', category: 'crypto', difficulty: 'easy', explanation: '', sources: [] },
  } as unknown as AcronymData;

  it('puts curated related first and drops invalid keys', () => {
    const rel = relatedFor('AAA', fixture);
    expect(rel[0]).toBe('BBB'); // curated, valid
    expect(rel).not.toContain('ZZZ'); // curated but not in the dataset
    expect(rel).not.toContain('DDD'); // different category
  });

  it('falls back to same-category shared-word neighbors', () => {
    // BBB has no curated relations; CCC shares "shared word alpha".
    expect(relatedFor('BBB', fixture)).toContain('CCC');
  });

  it('every curated relation in the real dataset points to an existing key', () => {
    for (const [key, entry] of Object.entries(data)) {
      for (const rel of entry.related ?? []) {
        expect(data[rel], `${key} -> ${rel}`).toBeDefined();
        expect(rel).not.toBe(key);
      }
    }
  });
});
