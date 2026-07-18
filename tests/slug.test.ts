import { describe, expect, it } from 'vitest';
import { keyFromLegacySlug, resolveLegacySlug, slugForKey } from '../src/lib/slug';
import { allData } from '../src/data';
import legacy from '../src/data/legacy-slugs.json';

describe('slugForKey', () => {
  it('lowercases keys', () => {
    expect(slugForKey('PCIDSS')).toBe('pcidss');
    expect(slugForKey('3DES')).toBe('3des');
  });
});

describe('keyFromLegacySlug', () => {
  it('normalizes hyphenated legacy slugs', () => {
    expect(keyFromLegacySlug('pci-dss')).toBe('PCIDSS');
    expect(keyFromLegacySlug('iso-27001')).toBe('ISO27001');
    expect(keyFromLegacySlug('cipp-us')).toBe('CIPPUS');
    expect(keyFromLegacySlug('NERC CIP')).toBe('NERCCIP');
  });
});

describe('legacy slug coverage', () => {
  it('maps most legacy definition slugs to current entries', () => {
    const keys = new Set(Object.keys(allData()));
    const mapped = legacy.definitions.filter((slug) => resolveLegacySlug(slug, keys));
    // The old site had entries we deliberately dropped (tool names, plain words),
    // but the large majority must still resolve directly or via alias.
    expect(mapped.length / legacy.definitions.length).toBeGreaterThan(0.7);
  });

  it('resolves curated aliases', () => {
    const keys = new Set(Object.keys(allData()));
    expect(resolveLegacySlug('iso 27002', keys)).toBe('ISO27001');
    expect(resolveLegacySlug('soc 3', keys)).toBe('SOC2');
    expect(resolveLegacySlug('fido', keys)).toBe('FIDO2');
    expect(resolveLegacySlug('wireshark', keys)).toBeNull();
  });
});
