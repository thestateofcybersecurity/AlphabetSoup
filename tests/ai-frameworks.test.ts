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
    expect(counts).toEqual({ AIRMF: 19, 'OWASP-LLM': 10, ATLAS: 16, ISO42001: 9 });
    expect(ai).toHaveLength(54);
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
});
