import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AA_NORMAL, contrastRatio, mix, parseHex, relativeLuminance } from '../src/lib/contrast';

/**
 * Reads the real stylesheet and recomputes every colour pair the UI actually
 * renders, in both themes. Editing a token to a value that fails WCAG AA breaks
 * this test rather than shipping.
 *
 * Before this pass: 9 of 10 category chips failed in light mode, 7 of 10 in
 * dark, and 5 of 8 status-colour combinations failed, one of them in both
 * themes at once.
 */

const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

/** Pull `--name: #hex;` pairs out of a block of CSS text. */
function tokensIn(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[a-z-]+):\s*(#[0-9a-fA-F]{3,6})\s*;/g)) {
    out[m[1]] = m[2];
  }
  return out;
}

/** The top-level `:root { ... }` declaration block. */
function rootBlock(): string {
  const start = css.indexOf(':root {');
  return css.slice(start, css.indexOf('\n}', start));
}

/** The `:root` block inside the first dark-scheme media query. */
function darkRootBlock(): string {
  const media = css.indexOf('@media (prefers-color-scheme: dark)');
  const start = css.indexOf(':root {', media);
  return css.slice(start, css.indexOf('\n  }', start));
}

const light = tokensIn(rootBlock());
const dark = tokensIn(darkRootBlock());

const CATEGORIES = [
  'certifications',
  'protocols',
  'attacks',
  'crypto',
  'governance',
  'cloud',
  'operations',
  'identity',
  'appsec',
  'network',
];
const STATUSES = ['bad', 'good', 'warn', 'neutral'];

describe('contrast maths', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // Known reference pair from the WCAG examples.
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#c8401f', '#f7efe2')).toBeCloseTo(contrastRatio('#f7efe2', '#c8401f'), 10);
  });

  it('parses shorthand hex and rejects junk', () => {
    expect(parseHex('#abc')).toEqual(parseHex('#aabbcc'));
    expect(() => parseHex('rebeccapurple')).toThrow();
  });

  it('mixes toward the base colour', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#ffffff');
    expect(mix('#000000', '#ffffff', 100)).toBe('#000000');
    expect(relativeLuminance(mix('#000000', '#ffffff', 50))).toBeLessThan(
      relativeLuminance('#ffffff'),
    );
  });
});

describe('category chips', () => {
  // .cat-dot paints `color: var(--paper)` on `background: var(--cat-*)`.
  it.each(CATEGORIES)('--cat-%s is readable in light mode', (name) => {
    const bg = light[`--cat-${name}`];
    expect(bg, `--cat-${name} missing from :root`).toBeTruthy();
    expect(contrastRatio(bg, light['--paper'])).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it.each(CATEGORIES)('--cat-%s is readable in dark mode', (name) => {
    const bg = dark[`--cat-${name}`];
    expect(bg, `--cat-${name} missing from the dark :root`).toBeTruthy();
    expect(contrastRatio(bg, dark['--paper'])).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('overrides every category for dark mode', () => {
    // The original bug: the light palette was inherited into dark mode wholesale.
    for (const name of CATEGORIES) expect(dark[`--cat-${name}`]).toBeTruthy();
  });
});

describe('status colours', () => {
  // Tools use these as text colours over --paper and --paper-raised.
  it.each(STATUSES)('--status-%s is readable on both surfaces in light mode', (name) => {
    const fg = light[`--status-${name}`];
    expect(fg, `--status-${name} missing from :root`).toBeTruthy();
    expect(contrastRatio(fg, light['--paper'])).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(contrastRatio(fg, light['--paper-raised'])).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it.each(STATUSES)('--status-%s is readable on both surfaces in dark mode', (name) => {
    const fg = dark[`--status-${name}`];
    expect(fg, `--status-${name} missing from the dark :root`).toBeTruthy();
    expect(contrastRatio(fg, dark['--paper'])).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(contrastRatio(fg, dark['--paper-raised'])).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it.each(STATUSES)('--status-%s stays readable on a 5%% tint of itself', (name) => {
    // .sm-warn draws status-coloured text inside a box tinted with that colour.
    for (const theme of [light, dark]) {
      const fg = theme[`--status-${name}`];
      expect(contrastRatio(fg, mix(fg, theme['--paper'], 5))).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });

  it('keeps body text readable on the tinted skills-matrix cells', () => {
    for (const theme of [light, dark]) {
      for (const pct of [6, 10, 12, 14, 26]) {
        for (const name of STATUSES) {
          const bg = mix(theme[`--status-${name}`], theme['--paper'], pct);
          expect(contrastRatio(theme['--ink'], bg)).toBeGreaterThanOrEqual(AA_NORMAL);
        }
      }
    }
  });
});

describe('core text', () => {
  it('keeps body and muted text readable on both surfaces', () => {
    for (const theme of [light, dark]) {
      for (const surface of ['--paper', '--paper-raised'] as const) {
        expect(contrastRatio(theme['--ink'], theme[surface])).toBeGreaterThanOrEqual(AA_NORMAL);
        expect(contrastRatio(theme['--ink-soft'], theme[surface])).toBeGreaterThanOrEqual(
          AA_NORMAL,
        );
      }
    }
  });
});

describe('tool pages use the tokens', () => {
  it('has no literal status hex values left in the tool stylesheets', () => {
    const stale = ['#b0402e', '#3e7d4f', '#b07d2e', '#8a8a8a'];
    const files = import.meta.glob('../tools/*/index.html', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    const offenders: string[] = [];
    for (const [path, text] of Object.entries(files)) {
      for (const hex of stale) if (text.includes(hex)) offenders.push(`${path} -> ${hex}`);
    }
    expect(offenders).toEqual([]);
  });
});
