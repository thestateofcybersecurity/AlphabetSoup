import { describe, expect, it } from 'vitest';
import rawAcronyms from '../src/data/acronyms.json';
import affiliates from '../src/data/affiliates.json';

const partners = affiliates.partners as Record<
  string,
  { name: string; url: string; network: string; blurb: string }
>;
const placements = affiliates.placements as Record<string, string[]>;

describe('affiliate dataset', () => {
  it('every placement key is a real acronym', () => {
    const keys = new Set(Object.keys(rawAcronyms));
    for (const key of Object.keys(placements)) {
      expect(keys.has(key), `placement key ${key}`).toBe(true);
    }
  });

  it('every placement references a defined partner', () => {
    for (const [key, ids] of Object.entries(placements)) {
      expect(ids.length, `placement ${key}`).toBeGreaterThan(0);
      for (const id of ids) {
        expect(partners[id], `placement ${key} partner ${id}`).toBeDefined();
      }
    }
  });

  it('partners have https tracking URLs and complete copy', () => {
    for (const [id, partner] of Object.entries(partners)) {
      expect(partner.url, id).toMatch(/^https:\/\//);
      expect(partner.name.trim(), id).not.toBe('');
      expect(partner.network.trim(), id).not.toBe('');
      expect(partner.blurb.trim(), id).not.toBe('');
      expect(partner.blurb, `${id} blurb has an em dash`).not.toContain('—');
    }
  });
});
