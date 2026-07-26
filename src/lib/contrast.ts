/**
 * WCAG contrast maths.
 *
 * The site had 16 of 20 category-chip combinations and 5 of 8 status-colour
 * combinations below the 4.5:1 minimum, because the palette was authored once
 * for the light theme and the dark theme reused the same values against an
 * inverted text colour. These helpers let tests/contrast.test.ts recompute the
 * ratios straight from style.css, so the palette cannot drift back.
 *
 * Formulas from WCAG 2.2: relative luminance and contrast ratio.
 * https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parse `#rgb` or `#rrggbb` into 0-255 channels. Throws on anything else. */
export function parseHex(hex: string): Rgb {
  const h = hex.trim().replace(/^#/, '');
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`not a hex colour: ${hex}`);
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(color: string | Rgb): number {
  const { r, g, b } = typeof color === 'string' ? parseHex(color) : color;
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast ratio between two colours, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string | Rgb, b: string | Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Simulate `color-mix(in srgb, <color> <pct>%, <base>)`, which several tools use
 * to tint a status colour into the page background. Mixing in sRGB is a plain
 * per-channel weighted average, which is what the browser does for this syntax.
 */
export function mix(color: string, base: string, percent: number): string {
  const c = parseHex(color);
  const b = parseHex(base);
  const p = percent / 100;
  const chan = (x: number, y: number): string =>
    Math.round(x * p + y * (1 - p))
      .toString(16)
      .padStart(2, '0');
  return `#${chan(c.r, b.r)}${chan(c.g, b.g)}${chan(c.b, b.b)}`;
}

/** WCAG 2.2 AA minimum for normal-size text. */
export const AA_NORMAL = 4.5;
