/**
 * Render the Open Graph card for the /about/ page (1200x630 PNG) into public/,
 * matching the static section OG images. Uses the same satori + resvg pipeline
 * and bundled IBM Plex Sans as og-images.ts, so the output is self-contained.
 * Run once with `tsx scripts/og-about.ts`; the PNG is committed to public/.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('..', import.meta.url));

const fontDir = require.resolve('@fontsource/ibm-plex-sans/package.json').replace(/package\.json$/, 'files');
const bold = readFileSync(`${fontDir}/ibm-plex-sans-latin-700-normal.woff`);
const regular = readFileSync(`${fontDir}/ibm-plex-sans-latin-400-normal.woff`);

const PAPER = '#f7efe2';
const INK = '#23303a';
const INK_SOFT = '#5c6a72';
const TOMATO = '#c8401f';
const LINE = '#ded1bb';

type Node = { type: string; props: { style: Record<string, unknown>; children?: unknown } };
const node = (type: string, style: Record<string, unknown>, children?: unknown): Node => ({
  type,
  props: { style, children },
});

const card = node(
  'div',
  {
    width: '1200px',
    height: '630px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    backgroundColor: PAPER,
    padding: '64px 72px',
    fontFamily: 'IBM Plex Sans',
  },
  [
    node('div', { display: 'flex' }, [
      node(
        'div',
        {
          display: 'flex',
          fontSize: '26px',
          letterSpacing: '4px',
          textTransform: 'uppercase',
          color: TOMATO,
          border: `2px solid ${TOMATO}`,
          borderRadius: '999px',
          padding: '8px 22px',
        },
        'About the builder',
      ),
    ]),
    node('div', { display: 'flex', flexDirection: 'column' }, [
      node('div', { display: 'flex', fontSize: '104px', fontWeight: 700, color: INK, lineHeight: 1 }, 'Parker Brissette'),
      node(
        'div',
        { display: 'flex', fontSize: '40px', color: INK_SOFT, marginTop: '20px' },
        'Cybersecurity leader, translating security into plain English',
      ),
    ]),
    node(
      'div',
      { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '26px', color: INK_SOFT, borderTop: `2px solid ${LINE}`, paddingTop: '22px' },
      [
        node('div', { display: 'flex', fontWeight: 700, color: INK }, 'Cybersecurity Alphabet Soup'),
        node('div', { display: 'flex' }, 'cybersecurityalphabetsoup.com'),
      ],
    ),
  ],
);

const fonts = [
  { name: 'IBM Plex Sans', data: bold, weight: 700 as const, style: 'normal' as const },
  { name: 'IBM Plex Sans', data: regular, weight: 400 as const, style: 'normal' as const },
];

const svg = await satori(card as never, { width: 1200, height: 630, fonts });
const png = new Resvg(svg).render().asPng();
writeFileSync(`${root}public/og-about.png`, png);
console.log('Wrote public/og-about.png');
