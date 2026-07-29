import { describe, expect, it } from 'vitest';
import iso from '../src/data/iso-27001.json';
import crosswalk from '../src/data/crosswalk.json';

/**
 * ISO/IEC 27001 is copyrighted, so this dataset deliberately holds no text from
 * the standard: only the control identifier, which is a factual reference, and
 * an original subject line written for this site.
 *
 * The four-theme structure was corroborated before being relied on, and is
 * pinned here so that a future correction is a single visible change rather
 * than a silent drift. The strongest evidence is that curated crosswalk
 * identifiers land exactly on the assumed maxima for two themes.
 */

interface Control {
  id: string;
  theme: string;
  themeName: string;
  subject: string;
  metaphor: string;
  translation: string;
}

const controls = iso.controls as Control[];
const themes = iso.meta.themes as { code: string; name: string; blurb: string; count: number }[];

describe('ISO 27001 Annex A structure', () => {
  it('holds 93 controls across four themes', () => {
    expect(controls).toHaveLength(93);
    expect(themes.map((t) => t.code)).toEqual(['5', '6', '7', '8']);
  });

  it('splits them 37 / 8 / 14 / 34', () => {
    const counts = Object.fromEntries(themes.map((t) => [t.code, t.count]));
    expect(counts).toEqual({ '5': 37, '6': 8, '7': 14, '8': 34 });
    for (const t of themes) {
      expect(controls.filter((c) => c.theme === t.code), `A.${t.code}`).toHaveLength(t.count);
    }
  });

  it('numbers each theme contiguously from 1', () => {
    for (const t of themes) {
      const nums = controls
        .filter((c) => c.theme === t.code)
        .map((c) => Number(c.id.split('.')[2]))
        .sort((a, b) => a - b);
      expect(nums, `A.${t.code}`).toEqual(Array.from({ length: t.count }, (_, i) => i + 1));
    }
  });

  it('uses well-formed unique identifiers', () => {
    for (const c of controls) expect(c.id, c.id).toMatch(/^A\.[5-8]\.\d{1,2}$/);
    expect(new Set(controls.map((c) => c.id)).size).toBe(controls.length);
  });
});

describe('original content only', () => {
  it('gives every control a subject line written for this site', () => {
    for (const c of controls) {
      expect(c.subject.length, c.id).toBeGreaterThan(20);
      // Subject lines are labels, not sentences lifted from a standard.
      expect(c.subject.endsWith('.'), c.id).toBe(false);
      expect(c.subject[0], c.id).toBe(c.subject[0].toUpperCase());
    }
  });

  it('does not repeat a subject line', () => {
    // Duplicates usually mean a control was filled in by pattern rather than
    // by thinking about what it actually covers.
    expect(new Set(controls.map((c) => c.subject)).size).toBe(controls.length);
  });

  it('records the copyright position and links to the source', () => {
    expect(iso.meta.note).toMatch(/copyright/i);
    expect(iso.meta.note).toMatch(/no control text|No control text/);
    expect(iso.meta.officialUrl).toContain('iso.org');
  });

  it('avoids em dashes, per the house style', () => {
    expect(JSON.stringify(iso)).not.toContain('—');
  });
});

describe('plain-English content', () => {
  it('gives every control a metaphor and a translation', () => {
    for (const c of controls) {
      expect(c.metaphor, `${c.id} metaphor`).toBeTruthy();
      expect(c.translation, `${c.id} translation`).toBeTruthy();
    }
  });

  it('writes them as complete sentences', () => {
    for (const c of controls) {
      for (const [field, text] of [['metaphor', c.metaphor], ['translation', c.translation]] as const) {
        expect(text.endsWith('.'), `${c.id} ${field}: ${text}`).toBe(true);
        expect(text[0], `${c.id} ${field}`).toBe(text[0].toUpperCase());
      }
    }
  });

  it('keeps them in the length range the CIS and CSF pages established', () => {
    // Matching the existing voice matters: these pages sit alongside those.
    for (const c of controls) {
      expect(c.metaphor.length, `${c.id} metaphor`).toBeGreaterThan(35);
      expect(c.metaphor.length, `${c.id} metaphor`).toBeLessThan(150);
      expect(c.translation.length, `${c.id} translation`).toBeGreaterThan(75);
      expect(c.translation.length, `${c.id} translation`).toBeLessThan(230);
    }
  });

  it('never repeats a metaphor or a translation', () => {
    // Repetition is the tell that a control was filled in by pattern rather
    // than by working out what it actually covers.
    expect(new Set(controls.map((c) => c.metaphor)).size).toBe(controls.length);
    expect(new Set(controls.map((c) => c.translation)).size).toBe(controls.length);
  });

  it('holds the household framing the rest of the site uses', () => {
    // Not every line needs the word, but the voice should be recognisably the
    // same one readers meet on the CIS and CSF pages.
    const household = controls.filter((c) =>
      /famil|house|home|kitchen|door|room/i.test(`${c.metaphor} ${c.translation}`),
    );
    expect(household.length / controls.length).toBeGreaterThan(0.6);
  });
});

describe('crosswalk alignment', () => {
  const curated = new Set(
    (crosswalk.controls as { mappings: Record<string, string[]> }[]).flatMap(
      (c) => c.mappings.iso ?? [],
    ),
  );

  it('resolves every identifier the crosswalk already cites', () => {
    // The crosswalk was curated before this dataset existed. Every id it uses
    // must exist here, or a mapped control would point at nothing.
    const ids = new Set(controls.map((c) => c.id));
    const dangling = [...curated].filter((id) => !ids.has(id));
    expect(dangling).toEqual([]);
  });

  it('still leaves some controls unmapped, which the crosswalk total reflects', () => {
    // 78 of 93 are mapped. If this ever reached 93 the crosswalk total would
    // need to move with it, and the policy generator's denominator too.
    const fw = (crosswalk.frameworks as { id: string; total: number }[]).find((f) => f.id === 'iso')!;
    expect(fw.total).toBe(curated.size);
    expect(curated.size).toBeLessThan(controls.length);
  });
});
