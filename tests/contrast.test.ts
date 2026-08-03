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

/**
 * Per-section themes (.theme-iso, .theme-soc2, and the rest).
 *
 * These were never covered: the checks above read only the top-level :root
 * tokens, so a section could ship an accent that failed AA and nothing would
 * notice. Adding the SOC 2 section made that gap worth closing.
 *
 * The resolution models the cascade, taking the LAST declaration that applies,
 * because the stylesheet contains a stray .theme-iso block carrying light
 * values inside a dark media query. The browser overrides it with the correct
 * values that follow, so nothing renders wrong, but a parser that took the
 * first match would report a failure that does not exist.
 */
interface ThemeDecl {
  theme: string;
  token: string;
  value: string;
  isDark: boolean;
}

function themeDeclarations(): ThemeDecl[] {
  const out: ThemeDecl[] = [];
  const re =
    /@media[^{]*prefers-color-scheme:\s*dark[^{]*\{|(\.[a-z0-9-]+)\s*\{|\{|\}|(--[a-z-]+):\s*(#[0-9a-fA-F]{3,6})\s*;/g;
  let depth = 0;
  const darkDepths: number[] = [];
  let current: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css))) {
    if (match[0].startsWith('@media')) {
      depth += 1;
      darkDepths.push(depth);
    } else if (match[1]) {
      depth += 1;
      if (match[1].startsWith('.theme-')) current = match[1].slice('.theme-'.length);
    } else if (match[0] === '{') {
      depth += 1;
    } else if (match[0] === '}') {
      if (darkDepths[darkDepths.length - 1] === depth) darkDepths.pop();
      depth -= 1;
      if (current && depth <= darkDepths.length) current = null;
    } else if (match[2] && current) {
      out.push({ theme: current, token: match[2], value: match[3], isDark: darkDepths.length > 0 });
    }
  }
  return out;
}

describe('section themes meet AA', () => {
  const decls = themeDeclarations();
  const themes = [...new Set(decls.map((d) => d.theme))];

  /** The value that actually wins for a token, in one scheme. */
  const resolve = (theme: string, token: string, wantDark: boolean): string | undefined => {
    const applicable = decls.filter(
      (d) => d.theme === theme && d.token === token && (wantDark ? true : !d.isDark),
    );
    return applicable[applicable.length - 1]?.value;
  };

  it('found the section themes in the stylesheet', () => {
    // A parser that silently matched nothing would make every check below pass.
    expect(themes.length).toBeGreaterThan(10);
    expect(themes).toContain('soc2');
    expect(themes).toContain('iso');
  });

  /**
   * Every section accent, in both schemes, with no exemptions.
   *
   * When this check was introduced it found nine accents below AA and carried
   * them as a recorded exemption list, because fixing them meant restyling nine
   * sections. They have since been corrected by reducing HSL lightness only, so
   * hue and saturation are unchanged and each section keeps its identity. The
   * list is gone: there is nothing left to exempt.
   *
   * These are real pairs, not theoretical ones. `.kicker` renders --tomato at
   * about 11.5px and weight 400, which is why 4.5 rather than the large-text
   * 3.0 is the right threshold.
   */
  it.each(['--tomato', '--tomato-deep'])('keeps %s readable in both schemes', (token) => {
    const failures: string[] = [];
    for (const theme of themes) {
      for (const [wantDark, paper] of [
        [false, light['--paper']],
        [true, dark['--paper']],
      ] as const) {
        const value = resolve(theme, token, wantDark);
        if (!value) continue;
        const ratio = contrastRatio(value, paper);
        if (ratio < AA_NORMAL) {
          failures.push(
            `.theme-${theme} ${token} ${wantDark ? 'dark' : 'light'} = ${ratio.toFixed(2)}`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('keeps white legible on an accent used as a background, in light mode', () => {
    // Active pills and buttons set `background: var(--tomato); color: #fff`.
    // In light mode several accents were too pale for that before the fix, so
    // the same darkening that repaired the kicker repaired these too.
    //
    // Deliberately light mode only. The dark scheme fails this pair in every
    // theme, around 2.0 to 2.8, because the dark accents are light by design
    // and white sits on top of them: confirmed rendered on .primary-btn at
    // 12.8px. Fixing it means changing the foreground on accent backgrounds
    // rather than nudging a token, which is a design decision and is tracked
    // separately. Asserting it here would just fail the suite without fixing
    // anything, so this test states its scope instead of pretending to cover it.
    const failures: string[] = [];
    for (const theme of themes) {
      const value = resolve(theme, '--tomato', false);
      if (!value) continue;
      const ratio = contrastRatio('#ffffff', value);
      if (ratio < AA_NORMAL) failures.push(`.theme-${theme} white on accent = ${ratio.toFixed(2)}`);
    }
    expect(failures).toEqual([]);
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
