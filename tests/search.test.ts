import { describe, expect, it } from 'vitest';
import { searchEntries } from '../src/lib/search';
import { allData } from '../src/data';

const data = allData();

describe('searchEntries', () => {
  it('returns everything alphabetically for an empty query', () => {
    const keys = searchEntries(data, '');
    expect(keys.length).toBe(Object.keys(data).length);
    expect(keys).toEqual([...keys].sort());
  });

  it('puts an exact key match first', () => {
    expect(searchEntries(data, 'siem')[0]).toBe('SIEM');
    expect(searchEntries(data, 'SIEM')[0]).toBe('SIEM');
  });

  it('matches display forms with punctuation', () => {
    expect(searchEntries(data, 'pci dss')[0]).toBe('PCIDSS');
    expect(searchEntries(data, 'att&ck')[0]).toBe('ATTCK');
  });

  it('ranks key prefixes above expansion mentions', () => {
    const results = searchEntries(data, 'sso');
    expect(results[0]).toBe('SSO');
  });

  it('finds entries by expansion words', () => {
    expect(searchEntries(data, 'kill chain').length + searchEntries(data, 'firewall').length).toBeGreaterThan(0);
    expect(searchEntries(data, 'firewall')).toContain('NGFW');
  });

  it('finds entries by explanation text', () => {
    expect(searchEntries(data, 'eternalblue')).toContain('SMB');
  });

  it('applies category and difficulty filters', () => {
    const crypto = searchEntries(data, '', { category: 'crypto' });
    expect(crypto.length).toBeGreaterThan(0);
    expect(crypto.every((key) => data[key].category === 'crypto')).toBe(true);
    const hard = searchEntries(data, '', { difficulty: 'hard' });
    expect(hard.every((key) => data[key].difficulty === 'hard')).toBe(true);
  });

  it('applies the letter filter', () => {
    const z = searchEntries(data, '', { letter: 'Z' });
    expect(z.length).toBeGreaterThan(0);
    expect(z.every((key) => key.startsWith('Z'))).toBe(true);
  });

  it('returns nothing for gibberish', () => {
    expect(searchEntries(data, 'zzqqxxyy')).toEqual([]);
  });
});
