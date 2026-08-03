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

  it.each(STATUSES)('--status-%s carries --on-accent when used as a background', (name) => {
    // The answer-state, KPI and attainment chips paint these as backgrounds.
    // They were literal hex, so white sat on them at 3.96:1 (good) and 2.94:1
    // (warn) in both schemes at once.
    for (const theme of [light, dark]) {
      expect(contrastRatio(theme['--on-accent'], theme[`--status-${name}`])).toBeGreaterThanOrEqual(
        AA_NORMAL,
      );
    }
  });

  it('has no literal semantic hex left in style.css', () => {
    // The greens, ambers and reds that these tokens replaced. --tomato is the
    // brand accent, not a status colour, so its declaration is the one pass.
    const stale = ['#3f8f5f', '#c98a1a', '#b23b2e'];
    const offenders: string[] = [];
    for (const hex of stale) if (css.includes(hex)) offenders.push(hex);
    // #c8401f is legitimate only as the --tomato token itself.
    const tomatoUses = css.match(/#c8401f/g) ?? [];
    if (tomatoUses.length > 1) offenders.push(`#c8401f x${tomatoUses.length}`);
    expect(offenders).toEqual([]);
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

  /**
   * The other direction: the accent used as a *background*, with --on-accent
   * painted on top (.primary-btn, .seg-btn.active, .az.active, .path-num, and
   * the button rules inlined into the tool pages).
   *
   * Every one of these was a literal `color: #fff`. The light accents were
   * darkened until white cleared AA on them, but that fix could not reach the
   * dark scheme: its accents are light by design, so white landed between 2.00
   * and 2.76:1 on all eighteen themes, confirmed rendered on .primary-btn at
   * 12.8px. Darkening them instead would break them against the dark paper,
   * which is the pair they exist to satisfy, so the foreground flips instead.
   * Both schemes are asserted here; there is no longer a scope to state.
   */
  it.each(['--tomato', '--tomato-deep'])('keeps --on-accent legible on %s', (token) => {
    const failures: string[] = [];
    for (const theme of themes) {
      for (const [wantDark, palette] of [
        [false, light],
        [true, dark],
      ] as const) {
        const bg = resolve(theme, token, wantDark);
        if (!bg) continue;
        const ratio = contrastRatio(palette['--on-accent'], bg);
        if (ratio < AA_NORMAL) {
          failures.push(
            `.theme-${theme} ${token} ${wantDark ? 'dark' : 'light'} = ${ratio.toFixed(2)}`,
          );
        }
      }
    }
    // The root accent is what an unthemed page renders.
    for (const [name, palette] of [
      ['light', light],
      ['dark', dark],
    ] as const) {
      const ratio = contrastRatio(palette['--on-accent'], palette[token]);
      if (ratio < AA_NORMAL) failures.push(`:root ${token} ${name} = ${ratio.toFixed(2)}`);
    }
    expect(failures).toEqual([]);
  });

  it('flips --on-accent to the dark paper colour rather than reusing white', () => {
    expect(light['--on-accent']).toBe('#ffffff');
    expect(dark['--on-accent']).toBe(dark['--paper']);
  });

  it('keeps the hover step visible after the accents were darkened', () => {
    // .primary-btn:hover swaps --tomato for --tomato-deep. Darkening only
    // --tomato collapsed that gap to almost nothing on automation, so the
    // hover state rendered as the base colour.
    const tooClose: string[] = [];
    for (const theme of themes) {
      for (const wantDark of [false, true]) {
        const base = resolve(theme, '--tomato', wantDark);
        const deep = resolve(theme, '--tomato-deep', wantDark);
        if (!base || !deep) continue;
        const step = contrastRatio(base, deep);
        if (step < 1.2) {
          tooClose.push(`.theme-${theme} ${wantDark ? 'dark' : 'light'} = ${step.toFixed(3)}`);
        }
      }
    }
    expect(tooClose).toEqual([]);
  });

  it('has no literal #fff left on an accent background', () => {
    // The rules this replaced were spread over style.css and twelve inlined
    // <style> blocks; a new one would silently reintroduce the dark-mode bug.
    const files = {
      '../style.css': css,
      ...(import.meta.glob('../{tools,assess,about,quiz,roadmap,my,frameworks}/**/index.html', {
        query: '?raw',
        import: 'default',
        eager: true,
      }) as Record<string, string>),
    };
    const offenders: string[] = [];
    for (const [path, text] of Object.entries(files)) {
      // Declaration blocks, so a `#fff` next to an unrelated rule is not a hit.
      for (const block of text.matchAll(/\{[^{}]*\}/g)) {
        const body = block[0];
        if (/background:\s*var\(--tomato(-deep)?\)/.test(body) && /#fff\b/.test(body)) {
          offenders.push(`${path} -> ${body.replace(/\s+/g, ' ').trim().slice(0, 80)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
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
