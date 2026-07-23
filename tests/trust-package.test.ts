import { describe, expect, it } from 'vitest';
import dataRaw from '../src/data/trust-library.json';
import { gaps, matchBatch, matchQuestion, tokenize, type Entry, type TrustData } from '../src/lib/trust-package';

const data = dataRaw as TrustData;

const mini: TrustData = {
  meta: { title: 't', version: '0', note: '', sources: [] },
  categories: [
    { id: 'encryption', name: 'Encryption' },
    { id: 'incident-response', name: 'Incident response' },
  ],
  entries: [
    {
      id: 'enc',
      category: 'encryption',
      question: 'How is data encrypted at rest and in transit?',
      keywords: ['encryption', 'at rest', 'in transit', 'tls', 'aes'],
      answer: 'TLS 1.2+ in transit, AES-256 at rest.',
    },
    {
      id: 'ir',
      category: 'incident-response',
      question: 'Do you have an incident response plan?',
      keywords: ['incident response', 'ir plan', 'breach'],
      answer: 'Yes, a documented IR plan.',
    } as Entry,
  ],
};

describe('tokenize', () => {
  it('lowercases, splits, and drops stopwords and single chars', () => {
    expect(tokenize('How is data ENCRYPTED at rest?')).toEqual(['data', 'encrypted', 'rest']);
  });
});

describe('matchQuestion', () => {
  it('matches a question to the right entry with a phrase bonus', () => {
    const matches = matchQuestion(mini, 'How do you handle encryption at rest?');
    expect(matches[0].entry.id).toBe('enc');
    expect(matches[0].confidence).toBe('high');
  });

  it('returns nothing for an unrelated question (a gap)', () => {
    expect(matchQuestion(mini, 'What is your marketing budget for pretzels?')).toHaveLength(0);
  });

  it('ranks the more relevant entry first', () => {
    const matches = matchQuestion(mini, 'incident response breach plan', 2);
    expect(matches[0].entry.id).toBe('ir');
  });
});

describe('matchBatch and gaps', () => {
  it('splits lines, matches each, and collects the unmatched ones', () => {
    const text = 'How is data encrypted?\n   \nWhat colour is your logo?';
    const results = matchBatch(mini, text);
    expect(results).toHaveLength(2); // blank line dropped
    expect(results[0].matches[0].entry.id).toBe('enc');
    expect(gaps(results)).toEqual(['What colour is your logo?']);
  });
});

describe('trust-library.json data integrity', () => {
  const catIds = new Set(data.categories.map((c) => c.id));

  it('has 39 entries with unique ids in valid categories', () => {
    expect(data.entries).toHaveLength(39);
    expect(new Set(data.entries.map((e) => e.id)).size).toBe(39);
    for (const e of data.entries) expect(catIds.has(e.category), e.id).toBe(true);
  });

  it('every entry has lowercase keywords and a non-empty answer', () => {
    for (const e of data.entries) {
      expect(e.answer.trim().length, e.id).toBeGreaterThan(0);
      expect(e.keywords.length, e.id).toBeGreaterThanOrEqual(3);
      for (const k of e.keywords) expect(k, e.id).toBe(k.toLowerCase());
    }
  });

  it('has no em dashes and every category is represented', () => {
    expect(JSON.stringify(data)).not.toMatch(/—/);
    for (const c of data.categories) expect(data.entries.some((e) => e.category === c.id), c.id).toBe(true);
  });

  it('matches a representative encryption question against the real library', () => {
    const matches = matchQuestion(data, 'How is customer data encrypted at rest and in transit?');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].entry.category).toBe('encryption');
  });
});
