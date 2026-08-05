/**
 * Generate a per-acronym Open Graph image (1200x630 PNG) for every definition
 * page, so links unfurl with the term and its expansion instead of one generic
 * card. Runs after generate-pages.ts in the build. Text is shaped to paths by
 * satori (using a bundled IBM Plex Sans), then rasterized by resvg, so the
 * output is self-contained.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { slugForKey } from '../src/lib/slug';
import type { AcronymData } from '../src/lib/types';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('..', import.meta.url));
const data = JSON.parse(readFileSync(`${root}src/data/acronyms.json`, 'utf8')) as AcronymData;

interface BlogPostMeta {
  slug: string;
  title: string;
  category: string;
  author: string;
  date: string;
  readingMinutes: number;
}
const blogPosts = JSON.parse(readFileSync(`${root}src/data/blog-posts.json`, 'utf8')) as BlogPostMeta[];

const fontDir = require.resolve('@fontsource/ibm-plex-sans/package.json').replace(/package\.json$/, 'files');
const bold = readFileSync(`${fontDir}/ibm-plex-sans-latin-700-normal.woff`);
const regular = readFileSync(`${fontDir}/ibm-plex-sans-latin-400-normal.woff`);

const outDir = `${root}dist/og`;
mkdirSync(outDir, { recursive: true });

const PAPER = '#f7efe2';
const INK = '#23303a';
const INK_SOFT = '#5c6a72';
const TOMATO = '#c8401f';
const LINE = '#ded1bb';

/** satori element helper (no JSX). */
type Node = { type: string; props: { style: Record<string, unknown>; children?: unknown } };
const node = (type: string, style: Record<string, unknown>, children?: unknown): Node => ({
  type,
  props: { style, children },
});

function termSize(display: string): number {
  if (display.length <= 6) return 150;
  if (display.length <= 10) return 116;
  if (display.length <= 16) return 82;
  return 60;
}

function card(key: string): Node {
  const entry = data[key];
  const expansion = entry.expansion.length > 78 ? entry.expansion.slice(0, 76) + '…' : entry.expansion;
  return node(
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
          entry.category,
        ),
      ]),
      node('div', { display: 'flex', flexDirection: 'column' }, [
        node('div', { display: 'flex', fontSize: `${termSize(entry.display)}px`, fontWeight: 700, color: INK, lineHeight: 1 }, entry.display),
        node('div', { display: 'flex', fontSize: '46px', color: INK_SOFT, marginTop: '18px' }, expansion),
      ]),
      node('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '26px', color: INK_SOFT, borderTop: `2px solid ${LINE}`, paddingTop: '22px' }, [
        node('div', { display: 'flex', fontWeight: 700, color: INK }, 'Cybersecurity Alphabet Soup'),
        node('div', { display: 'flex' }, 'cybersecurityalphabetsoup.com'),
      ]),
    ],
  );
}

/** Blog titles run far longer than acronyms; size down as length grows. */
function titleSize(title: string): number {
  if (title.length <= 40) return 76;
  if (title.length <= 60) return 64;
  if (title.length <= 80) return 56;
  return 48;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}, ${y}`;
}

/** Same card language as the definition images: kicker chip, big text, branded footer. */
function blogCard(post: BlogPostMeta): Node {
  return node(
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
          post.category,
        ),
      ]),
      node('div', { display: 'flex', flexDirection: 'column' }, [
        node('div', { display: 'flex', fontSize: `${titleSize(post.title)}px`, fontWeight: 700, color: INK, lineHeight: 1.12 }, post.title),
        node(
          'div',
          { display: 'flex', fontSize: '30px', color: INK_SOFT, marginTop: '26px' },
          `By ${post.author} · ${formatDate(post.date)} · ${post.readingMinutes} min read`,
        ),
      ]),
      node('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '26px', color: INK_SOFT, borderTop: `2px solid ${LINE}`, paddingTop: '22px' }, [
        node('div', { display: 'flex', fontWeight: 700, color: INK }, 'Cybersecurity Alphabet Soup'),
        node('div', { display: 'flex' }, 'cybersecurityalphabetsoup.com/blog'),
      ]),
    ],
  );
}

const fonts = [
  { name: 'IBM Plex Sans', data: bold, weight: 700 as const, style: 'normal' as const },
  { name: 'IBM Plex Sans', data: regular, weight: 400 as const, style: 'normal' as const },
];

let count = 0;
for (const key of Object.keys(data)) {
  // eslint-disable-next-line no-await-in-loop
  const svg = await satori(card(key) as never, { width: 1200, height: 630, fonts });
  const png = new Resvg(svg).render().asPng();
  writeFileSync(`${outDir}/${slugForKey(key)}.png`, png);
  count += 1;
}

mkdirSync(`${outDir}/blog`, { recursive: true });
let blogCount = 0;
for (const post of blogPosts) {
  // eslint-disable-next-line no-await-in-loop
  const svg = await satori(blogCard(post) as never, { width: 1200, height: 630, fonts });
  const png = new Resvg(svg).render().asPng();
  writeFileSync(`${outDir}/blog/${post.slug}.png`, png);
  blogCount += 1;
}
console.log(`OG images: ${count} definition + ${blogCount} blog rendered into dist/og/`);
