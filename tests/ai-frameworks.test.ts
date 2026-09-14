import { describe, expect, it } from 'vitest';
import aiRaw from '../src/data/ai-frameworks.json';
import { AI_FRAMEWORKS, frameworkSlug, validateAi } from '../src/lib/frameworks';
import type { AiData } from '../src/lib/frameworks';

const ai = aiRaw as AiData;

describe('AI frameworks dataset', () => {
  it('passes the structural validator', () => {
    expect(validateAi(ai)).toEqual([]);
  });

  it('covers the four frameworks with the expected counts', () => {
    const counts: Record<string, number> = {};
    for (const entry of ai) counts[entry.frameworkCode] = (counts[entry.frameworkCode] ?? 0) + 1;
    expect(counts).toEqual({ AIRMF: 19, 'OWASP-LLM': 10, ATLAS: 117, ISO42001: 9 });
    expect(ai).toHaveLength(155);
  });

  it('carries every ATLAS tactic and top-level technique', () => {
    const atlas = ai.filter((e) => e.frameworkCode === 'ATLAS');
    const tactics = atlas.filter((e) => /^AML\.TA\d+$/.test(e.code));
    const techniques = atlas.filter((e) => /^AML\.T\d+$/.test(e.code));
    // 16 tactics and 101 top-level techniques in ATLAS 2026.07. Subtechniques
    // (AML.TXXXX.NNN) are deliberately not enumerated.
    expect(tactics).toHaveLength(16);
    expect(techniques).toHaveLength(101);
    expect(tactics.length + techniques.length).toBe(atlas.length);
    for (const entry of tactics) expect(entry.category).toBe('ATLAS Tactics');
    for (const entry of techniques) expect(entry.category).toBe('ATLAS Techniques');
  });

  it('keeps framework entries contiguous so prev/next never crosses a boundary', () => {
    const seen = new Set<string>();
    let current = '';
    for (const entry of ai) {
      if (entry.frameworkCode === current) continue;
      expect(seen.has(entry.frameworkCode)).toBe(false);
      seen.add(entry.frameworkCode);
      current = entry.frameworkCode;
    }
  });

  it('uses only the registered framework codes', () => {
    const known = new Set(AI_FRAMEWORKS.map(([code]) => code));
    for (const entry of ai) expect(known.has(entry.frameworkCode)).toBe(true);
  });

  it('has unique, slug-safe codes and no em dashes anywhere', () => {
    const slugs = new Set<string>();
    for (const entry of ai) {
      const slug = frameworkSlug(entry.code);
      expect(slug).toMatch(/^[a-z0-9-]+$/);
      expect(slugs.has(slug)).toBe(false);
      slugs.add(slug);
      for (const field of ['title', 'official', 'metaphor', 'translation'] as const) {
        expect(entry[field]).not.toContain('—');
      }
    }
  });

  it('has the OWASP 2025 list LLM01 through LLM10', () => {
    const owasp = ai.filter((e) => e.frameworkCode === 'OWASP-LLM').map((e) => e.code);
    expect(owasp).toEqual(['LLM01', 'LLM02', 'LLM03', 'LLM04', 'LLM05', 'LLM06', 'LLM07', 'LLM08', 'LLM09', 'LLM10']);
  });

  it('every entry links to an authoritative https source', () => {
    for (const entry of ai) {
      expect(entry.sourceUrl).toMatch(/^https:\/\//);
      expect(entry.sourceLabel.trim().length).toBeGreaterThan(0);
    }
  });

  // The search-result overrides exist to control a snippet, so the thing worth
  // guarding is that they stay inside the generator's trim limits. A value over
  // the limit still builds, it just ships an ellipsis mid-phrase to searchers.
  describe('search-result overrides', () => {
    it('keeps every override inside the limit the generator would trim at', () => {
      for (const entry of ai) {
        if (entry.titleSubject !== undefined) expect(entry.titleSubject.length).toBeLessThanOrEqual(70);
        if (entry.metaDescription !== undefined) expect(entry.metaDescription.length).toBeLessThanOrEqual(160);
      }
    });

    // Site-wide, ~158 generated pages still ship a description trimmed with an
    // ellipsis, and clearing that is a content backlog rather than a test. The
    // 16 ATLAS tactic pages are held clean because they are the entry points to
    // the section and the only ones drawing measurable impressions.
    it('ships no truncated description on any ATLAS tactic page', () => {
      const tactics = ai.filter((e) => e.category === 'ATLAS Tactics');
      expect(tactics).toHaveLength(16);
      const truncated = tactics
        .filter((e) => (e.metaDescription ?? e.translation).length > 160)
        .map((e) => e.code);
      expect(truncated).toEqual([]);
    });

    it('rejects an override that is too long, empty, or carries an em dash', () => {
      const base = ai.find((e) => e.code === 'AML.TA0012');
      expect(base).toBeDefined();
      const errors = validateAi([
        { ...base!, code: 'AML.TA9001', metaDescription: 'x'.repeat(161) },
        { ...base!, code: 'AML.TA9002', titleSubject: 'y'.repeat(71) },
        { ...base!, code: 'AML.TA9003', titleSubject: '   ' },
        { ...base!, code: 'AML.TA9004', metaDescription: 'Tactic — explained' },
        // A fixture this small trips the "framework X: no entries" check too,
        // which is not what this test is about.
      ] as AiData).filter((e) => !e.startsWith('framework '));
      expect(errors).toEqual([
        '[AML.TA9001] metaDescription length 161 over 160',
        '[AML.TA9002] titleSubject length 71 over 70',
        '[AML.TA9003] titleSubject is empty',
        '[AML.TA9004] metaDescription contains an em dash',
      ]);
    });
  });
});
