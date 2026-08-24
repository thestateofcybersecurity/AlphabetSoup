import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveLegacySlug, slugForKey } from '../src/lib/slug';
import { frameworkSlug } from '../src/lib/frameworks';
import { relatedFor } from '../src/lib/related';
import { renderGeneratedNav } from '../src/lib/site-nav';
import { escHtml, renderInline } from '../src/lib/inline';
import { byDateDesc } from '../src/lib/about';
import { renderFontLinks } from '../src/lib/fonts';
import { categorySlug, categoryTitle, decksTesting, postsMentioning } from '../src/lib/deep-links';
import type { DeckLike, PostLike } from '../src/lib/deep-links';
import { CATEGORIES } from '../src/lib/types';
import type { AcronymData, AcronymEntry } from '../src/lib/types';
import type { AiData, CisData, CsfData } from '../src/lib/frameworks';
import { byFamily, relatedByCriterion } from '../src/lib/soc2';
import type { CrosswalkDomain, Soc2Data } from '../src/lib/soc2';

const SITE = 'https://www.cybersecurityalphabetsoup.com';
const CYBERDLE = 'https://thestateofcybersecurity.github.io/cyberdle/';

const root = fileURLToPath(new URL('..', import.meta.url));
const data = JSON.parse(readFileSync(`${root}src/data/acronyms.json`, 'utf8')) as AcronymData;
const csf = JSON.parse(readFileSync(`${root}src/data/nist-csf.json`, 'utf8')) as CsfData;
const cis = JSON.parse(readFileSync(`${root}src/data/cis.json`, 'utf8')) as CisData;
const ai = JSON.parse(readFileSync(`${root}src/data/ai-frameworks.json`, 'utf8')) as AiData;
const cisIgs = JSON.parse(readFileSync(`${root}src/data/cis-igs.json`, 'utf8')) as Record<string, number>;
const crosswalkControls = (
  JSON.parse(readFileSync(`${root}src/data/crosswalk.json`, 'utf8')) as {
    controls: { id: string; mappings: Record<string, string[]> }[];
  }
).controls;
const isoData = JSON.parse(readFileSync(`${root}src/data/iso-27001.json`, 'utf8')) as {
  meta: { themes: { code: string; name: string }[] };
  controls: { id: string; theme: string; themeName: string; subject: string; metaphor: string; translation: string }[];
};
const soc2Data = JSON.parse(readFileSync(`${root}src/data/soc2.json`, 'utf8')) as Soc2Data;

interface AffiliateData {
  /**
   * `direct: true` links the partner's URL straight from the page instead of
   * via a /go/ stub. Amazon requires it: their operating agreement forbids
   * obscuring link destinations, and the tag parameter must survive the click.
   */
  partners: Record<string, { name: string; url: string; network: string; blurb: string; direct?: boolean }>;
  placements: Record<string, string[]>;
}
const affiliates = JSON.parse(readFileSync(`${root}src/data/affiliates.json`, 'utf8')) as AffiliateData;

/** Quiz deck metadata and full decks, for deriving which decks test a term. */
const deckIndex = JSON.parse(
  readFileSync(`${root}src/data/quiz/index.json`, 'utf8'),
) as { slug: string; name: string }[];
const quizDecks: DeckLike[] = deckIndex.map((meta) => ({
  slug: meta.slug,
  questions: (
    JSON.parse(readFileSync(`${root}src/data/quiz/${meta.slug}.json`, 'utf8')) as {
      questions?: { q?: string; why?: string }[];
    }
  ).questions,
}));

interface BlogBlock {
  type: 'p' | 'h2' | 'list' | 'quote';
  text?: string;
  items?: string[];
}
interface BlogPost {
  slug: string;
  title: string;
  description: string;
  category: string;
  author: string;
  date: string;
  readingMinutes: number;
  tags: string[];
  body: BlogBlock[];
  related: { label: string; href: string }[];
}
const blogPosts = JSON.parse(readFileSync(`${root}src/data/blog-posts.json`, 'utf8')) as BlogPost[];
const legacy = JSON.parse(readFileSync(`${root}src/data/legacy-slugs.json`, 'utf8')) as {
  definitions: string[];
  root: string[];
};
const csfToCis = JSON.parse(readFileSync(`${root}src/data/csf-cis-map.json`, 'utf8')) as Record<
  string,
  string[]
>;
const cisToCsf = new Map<string, string[]>();
for (const [csfId, cisIds] of Object.entries(csfToCis)) {
  for (const cisId of cisIds) {
    const list = cisToCsf.get(cisId) ?? [];
    list.push(csfId);
    cisToCsf.set(cisId, list);
  }
}

/** Acronym keys whose definition pages link to a framework translation section. */
const FRAMEWORK_LINKS: Record<string, { path: string; label: string }> = {
  CSF: { path: 'nist-csf', label: 'NIST CSF 2.0 translated in plain English' },
  NIST: { path: 'nist-csf', label: 'NIST CSF 2.0 translated in plain English' },
  RMF: { path: 'nist-csf', label: 'NIST CSF 2.0 translated in plain English' },
  CIS: { path: 'cis', label: 'CIS Controls v8 translated in plain English' },
  CSC: { path: 'cis', label: 'CIS Controls v8 translated in plain English' },
};

/** Certification keys with a practice quiz deck. */
const QUIZ_LINKS: Record<string, string> = {
  CISSP: 'cissp',
  CEH: 'ceh',
  CHFI: 'chfi',
  CYSA: 'cysa',
  GSEC: 'gsec',
  SSCP: 'sscp',
  CISM: 'cism',
  CISA: 'cisa',
  CRISC: 'crisc',
  CCSP: 'ccsp',
  CCSK: 'ccsk',
  OSCP: 'oscp',
  CASP: 'casp',
  PNPT: 'pnpt',
};

/** Terms where the BIA (Business Impact Assessment) tool is a natural next step. */
const BIA_LINKS = new Set(['BIA', 'BCP', 'BCDR', 'DRP', 'RTO', 'RPO', 'ERM']);

/** Every tools/<slug>/index.html in the repo, so the sitemap self-maintains. */
const toolSlugs = readdirSync(`${root}tools`, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(`${root}tools/${d.name}/index.html`))
  .map((d) => d.name)
  .sort();

const dist = `${root}dist`;
mkdirSync(`${dist}/definitions`, { recursive: true });
mkdirSync(`${dist}/frameworks/nist-csf`, { recursive: true });
mkdirSync(`${dist}/frameworks/cis`, { recursive: true });
mkdirSync(`${dist}/frameworks/ai`, { recursive: true });
mkdirSync(`${dist}/frameworks/iso`, { recursive: true });
mkdirSync(`${dist}/frameworks/soc2`, { recursive: true });
mkdirSync(`${dist}/blog`, { recursive: true });

const esc = escHtml;

/**
 * A clean meta description: the full text if short, otherwise trimmed to ~157
 * chars on a word boundary with an ellipsis. Avoids the old bug of cutting at
 * the first ". " (which mangled entries like "NIST SP 800-63B. It requires...").
 */
const metaDescription = (text: string): string => {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= 160) return esc(clean);
  const cut = clean.slice(0, 157);
  const lastSpace = cut.lastIndexOf(' ');
  return esc((lastSpace > 120 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…');
};

/**
 * Serialize an object for embedding in an inline <script type="application/ld+json">.
 * JSON.stringify does not neutralize a literal "</script>" inside string fields, so
 * escape "<" as its JSON unicode form to prevent breaking out of the script element.
 */
const jsonLdScript = (obj: unknown): string => JSON.stringify(obj).replace(/</g, '\\u003c');

/**
 * BreadcrumbList JSON-LD for a generated page. The hierarchy is real on every
 * generated page (home > category > term, home > framework > control, home >
 * blog > post) but was previously undeclared, which left search and answer
 * engines to guess the site structure.
 */
const breadcrumbLd = (trail: { name: string; item: string }[]): string =>
  jsonLdScript({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((crumb, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: crumb.name,
      item: crumb.item,
    })),
  });

const PAGE_CSS = `
:root{--paper:#f7efe2;--paper-raised:#fdf8ee;--ink:#23303a;--ink-soft:#5c6a72;--tomato:#c8401f;--line:#ded1bb}
@media(prefers-color-scheme:dark){:root{--paper:#191410;--paper-raised:#221c16;--ink:#ede4d3;--ink-soft:#a89d8a;--tomato:#e86a45;--line:#3a3227}}
*{box-sizing:border-box}body{margin:0;font-family:'IBM Plex Sans',system-ui,sans-serif;background:var(--paper);color:var(--ink);line-height:1.65}
.wrap{max-width:680px;margin:0 auto;padding:32px 20px 60px}
.home{font-family:'IBM Plex Mono',monospace;font-size:.75rem;letter-spacing:.15em;text-transform:uppercase;color:var(--tomato);text-decoration:none}
h1{font-family:'Fraunces',Georgia,serif;font-weight:900;font-size:clamp(2.4rem,9vw,3.6rem);margin:18px 0 4px;line-height:1}
.expansion{font-family:'Fraunces',Georgia,serif;font-style:italic;font-size:1.25rem;color:var(--ink-soft);margin:0 0 18px}
.chips{display:flex;gap:8px;margin:0 0 22px}
.chip{font-family:'IBM Plex Mono',monospace;font-size:.68rem;letter-spacing:.08em;text-transform:uppercase;border:1.5px solid var(--line);border-radius:999px;padding:4px 12px;color:var(--ink-soft)}
.chip.cat{border-color:var(--tomato);color:var(--tomato)}
.card{background:var(--paper-raised);border:1.5px solid var(--line);border-radius:12px;padding:6px 20px;margin:0 0 18px}
h2{font-family:'IBM Plex Mono',monospace;font-size:.72rem;letter-spacing:.2em;text-transform:uppercase;color:var(--ink-soft);margin:18px 0 6px}
a{color:var(--tomato)}
ul{padding-left:18px;margin:8px 0}
.related{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 0}
.related a{font-family:'IBM Plex Mono',monospace;font-size:.8rem;text-decoration:none;border:1.5px solid var(--line);border-radius:999px;padding:5px 13px;color:var(--ink)}
.related a:hover{border-color:var(--tomato);color:var(--tomato)}
footer{margin-top:28px;border-top:2px solid var(--ink);padding-top:16px;font-size:.85rem;color:var(--ink-soft)}
footer .play{font-family:'Fraunces',Georgia,serif;font-style:italic;font-weight:700;font-size:1rem}
.gnav{display:flex;flex-wrap:wrap;gap:2px;margin:0 0 18px}
@media(max-width:640px){.gnav{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}.gnav::-webkit-scrollbar{display:none}.gnav a{flex:0 0 auto}}
.gnav a{font-family:'IBM Plex Mono',monospace;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-soft);text-decoration:none;padding:5px 10px;border-radius:999px;white-space:nowrap}
.gnav a:hover{color:var(--tomato)}
.gnav a.play-link{color:var(--tomato)}
.gnav-item{position:relative;display:inline-flex}
.gnav-caret{font-size:.6rem}
.gnav-menu{position:absolute;top:100%;left:0;z-index:60;min-width:180px;max-height:min(60vh,480px);overflow-y:auto;display:flex;flex-direction:column;gap:2px;padding:8px;background:var(--paper-raised);border:1.5px solid var(--line);border-radius:12px;box-shadow:0 12px 28px rgb(0 0 0 / .14);opacity:0;pointer-events:none}
.gnav-item:hover .gnav-menu,.gnav-item:focus-within .gnav-menu{opacity:1;pointer-events:auto}
.gnav-menu a{display:block;text-align:left}
@media(max-width:640px){.gnav-caret,.gnav-menu{display:none}}
.sponsor-list{list-style:none;padding:0;margin:12px 0}
.sponsor-list li{margin:0 0 10px}
.sponsor-note{font-size:.8rem;color:var(--ink-soft);margin:10px 0 12px}
.skip-link{position:absolute;left:8px;top:-48px;z-index:1000;background:var(--ink);color:var(--paper);font-family:'IBM Plex Mono',monospace;font-size:.8rem;padding:8px 14px;border-radius:8px;text-decoration:none}
.skip-link:focus{top:8px}
main:focus{outline:none}
a:focus-visible,button:focus-visible{outline:2px solid var(--tomato);outline-offset:2px;border-radius:4px}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.001ms!important;transition-duration:.001ms!important}}
`.trim();

const BIA_NAV = 'https://bia.cybersecurityalphabetsoup.com/';

/** Compact site nav for generated pages; prefix is the relative path to site root. */

const relatedKeys = (key: string): string[] => relatedFor(key, data);

/**
 * Onward links for a definition page.
 *
 * The curated maps above stay: they are hand-picked and better than anything
 * derived, so they lead. Everything after them is found in the content, which
 * took this block from 25 of 646 pages to most of them without adding a list
 * for anyone to maintain.
 */
function goDeeper(key: string, entry: AcronymEntry): string {
  const links: string[] = [];

  if (FRAMEWORK_LINKS[key]) {
    links.push(
      `<a href="../frameworks/${FRAMEWORK_LINKS[key].path}/">${esc(FRAMEWORK_LINKS[key].label)} &rarr;</a>`,
    );
  }
  if (QUIZ_LINKS[key]) {
    links.push(`<a href="../quiz/?deck=${QUIZ_LINKS[key]}">Practice ${esc(entry.display)} questions &rarr;</a>`);
  }
  if (BIA_LINKS.has(key)) {
    links.push(`<a href="${BIA_NAV}" rel="noopener" target="_blank">Assess business impact with the BIA tool &rarr;</a>`);
  }

  // Decks that actually ask about this term, minus any the curated map already
  // covers, so a certification page does not link its own deck twice.
  for (const slug of decksTesting(key, quizDecks)) {
    if (QUIZ_LINKS[key] === slug) continue;
    const meta = deckIndex.find((d) => d.slug === slug);
    if (!meta) continue;
    links.push(`<a href="../quiz/?deck=${slug}">Tested on the ${esc(meta.name)} quiz &rarr;</a>`);
  }

  for (const slug of postsMentioning(key, blogPosts as unknown as PostLike[])) {
    const post = blogPosts.find((p) => p.slug === slug);
    if (!post) continue;
    links.push(`<a href="../blog/${slug}.html">Read: ${esc(post.title)} &rarr;</a>`);
  }

  if (links.length === 0) return '';
  return `<h2>Go deeper</h2>\n    <div class="related">${links.join('')}</div>`;
}

/**
 * Affiliate recommendations for a definition page, driven by
 * src/data/affiliates.json so link IDs and placements live in one file.
 *
 * Links point at /go/<id>/ rather than the network URL directly: the tracking
 * URL can change without regenerating anchor text across pages, and each
 * click shows up in analytics as a /go/ pageview per partner. rel="sponsored"
 * is on the anchor because the destination is paid, even though the hop is
 * internal.
 */
function affiliateBlock(key: string): string {
  const ids = affiliates.placements[key];
  if (!ids?.length) return '';
  const items = ids
    .map((id) => {
      const partner = affiliates.partners[id];
      const href = partner.direct ? esc(partner.url) : `../go/${id}/`;
      const target = partner.direct ? ' target="_blank"' : '';
      return `<li><a href="${href}" rel="sponsored noopener"${target}>${esc(partner.name)} &rarr;</a> ${esc(partner.blurb)}</li>`;
    })
    .join('\n        ');
  const amazonNote = ids.some((id) => affiliates.partners[id].network === 'Amazon')
    ? ' As an Amazon Associate, this site earns from qualifying purchases.'
    : '';
  return `<h2>Tools worth considering</h2>
    <div class="card">
      <ul class="sponsor-list">
        ${items}
      </ul>
      <p class="sponsor-note">Affiliate links: the site may earn a commission at no extra cost to you (<a href="../disclosure/">how this works</a>).${amazonNote} No single tool is a silver bullet; treat each as one layer of coverage.</p>
    </div>`;
}

/**
 * The `<title>` for a definition page. Defaults to "KEY - Expansion", which is
 * accurate but rarely how the term is searched; entries carrying a `seoTitle`
 * lead with the phrasing Search Console shows landing on the page instead.
 */
function definitionTitle(entry: AcronymEntry): string {
  return entry.seoTitle?.trim() || `${entry.display} - ${entry.expansion}`;
}

function definitionPage(key: string, entry: AcronymEntry): string {
  const slug = slugForKey(key);
  const url = `${SITE}/definitions/${slug}.html`;
  const description = metaDescription(entry.explanation);
  const jsonLd = jsonLdScript({
    '@context': 'https://schema.org',
    '@type': 'DefinedTerm',
    name: entry.display,
    alternateName: entry.expansion,
    description: entry.explanation,
    url,
    inDefinedTermSet: { '@type': 'DefinedTermSet', name: 'Cybersecurity Alphabet Soup', url: SITE },
  });
  const sources = entry.sources
    .map((s) => `<li><a href="${esc(s.url)}" rel="noopener noreferrer">${esc(s.name)}</a></li>`)
    .join('\n          ');
  const related = relatedKeys(key)
    .map((k) => `<a href="${slugForKey(k)}.html">${esc(data[k].display)}</a>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <title>${esc(definitionTitle(entry))} | Cybersecurity Alphabet Soup</title>
  <meta name="description" content="${description}">
  <link rel="canonical" href="${url}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${esc(entry.display)}: ${esc(entry.expansion)}">
  <meta property="og:description" content="${description}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${SITE}/og/${slug}.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="../icon.svg" type="image/svg+xml">
  <link rel="alternate" type="application/rss+xml" title="Cybersecurity Alphabet Soup blog" href="${SITE}/feed.xml">
  ${renderFontLinks()}
  <style>${PAGE_CSS}</style>
  <script type="application/ld+json">${jsonLd}</script>
  <script type="application/ld+json">${breadcrumbLd([
    { name: 'Cybersecurity Alphabet Soup', item: `${SITE}/` },
    { name: `${categoryTitle(entry.category)} acronyms`, item: `${SITE}/categories/${categorySlug(entry.category)}.html` },
    { name: entry.display, item: url },
  ])}</script>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <main id="main" class="wrap" tabindex="-1">
    ${renderGeneratedNav('../')}
    <a class="home" href="../">&larr; Cybersecurity Alphabet Soup</a>
    <h1>${esc(entry.display)}</h1>
    <p class="expansion">${esc(entry.expansion)}</p>
    <div class="chips"><span class="chip cat">${entry.category}</span><span class="chip">${entry.difficulty}</span></div>
    <div class="card"><p>${esc(entry.explanation)}</p></div>
    <h2>Sources</h2>
    <ul>
          ${sources}
    </ul>
    <h2>More in ${entry.category}</h2>
    <div class="related">${related}<a class="cat-all" href="../categories/${categorySlug(entry.category)}.html">All ${esc(entry.category)} acronyms &rarr;</a></div>
    ${goDeeper(key, entry)}
    ${affiliateBlock(key)}
    <footer>
      <p class="play">Think you could have guessed it? <a href="${CYBERDLE}" rel="noopener" target="_blank">Play Cyberdle, the daily acronym game &rarr;</a></p>
      <p>Part of <a href="../">Cybersecurity Alphabet Soup</a>, a plain-English dictionary of ${Object.keys(data).length} cybersecurity acronyms.</p>
      <p><a href="../privacy/">Privacy</a> &middot; <a href="../disclosure/">Affiliate disclosure</a></p>
    </footer>
  </main>
</body>
</html>
`;
}

function redirectPage(target: string, label: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="0; url=${esc(target)}">
  <link rel="canonical" href="${esc(target)}">
  <title>Redirecting to ${esc(label)}</title>
</head>
<body>
  <p>This page has moved. Continue to <a href="${esc(target)}">${esc(label)}</a>.</p>
</body>
</html>
`;
}

// 1. Canonical definition pages.
const keys = Object.keys(data).sort();
for (const key of keys) {
  writeFileSync(`${dist}/definitions/${slugForKey(key)}.html`, definitionPage(key, data[key]));
}

// 2. Legacy definitions/<old-slug>.html aliases.
let aliases = 0;
let fallbacks = 0;
const canonicalSlugs = new Set(keys.map(slugForKey));
const keySet = new Set(keys);
for (const oldSlug of legacy.definitions) {
  if (canonicalSlugs.has(oldSlug)) continue; // real page already generated
  const candidate = resolveLegacySlug(oldSlug, keySet);
  if (candidate) {
    writeFileSync(
      `${dist}/definitions/${oldSlug}.html`,
      redirectPage(`${slugForKey(candidate)}.html`, data[candidate].display),
    );
    aliases++;
  } else {
    writeFileSync(
      `${dist}/definitions/${oldSlug}.html`,
      redirectPage(`../?q=${encodeURIComponent(oldSlug)}`, 'Cybersecurity Alphabet Soup'),
    );
    fallbacks++;
  }
}

// 3. Legacy root-level ACRONYM.html pages.
let rootRedirects = 0;
for (const name of legacy.root) {
  const candidate = resolveLegacySlug(name, keySet);
  const target = candidate
    ? `definitions/${slugForKey(candidate)}.html`
    : `./?q=${encodeURIComponent(name)}`;
  const label = candidate ? data[candidate].display : 'Cybersecurity Alphabet Soup';
  writeFileSync(`${dist}/${name}.html`, redirectPage(target, label));
  rootRedirects++;
}

// 4. Framework translation pages (NIST CSF 2.0 and CIS Controls v8).
const FW_EXTRA_CSS = `
.metaphor{border-left:3px solid var(--tomato);background:var(--paper-raised);padding:12px 16px;border-radius:0 10px 10px 0;margin:0 0 16px;font-family:'Fraunces',Georgia,serif;font-style:italic;font-size:1.05rem}
.metaphor .label{display:block;font-family:'IBM Plex Mono',monospace;font-style:normal;font-size:.62rem;letter-spacing:.16em;text-transform:uppercase;color:var(--tomato);margin-bottom:4px}
.pager{display:flex;justify-content:space-between;gap:10px;margin-top:20px;font-family:'IBM Plex Mono',monospace;font-size:.8rem}
.pager a{text-decoration:none;border:1.5px solid var(--line);border-radius:999px;padding:6px 14px;color:var(--ink)}
.pager a:hover{border-color:var(--tomato);color:var(--tomato)}
.ig-badge{font-family:'IBM Plex Mono',monospace;font-size:.62rem;font-weight:600;letter-spacing:.06em;vertical-align:middle;padding:2px 9px;border-radius:999px;border:1.5px solid var(--tomato);color:var(--tomato)}
.no-map{color:var(--ink-soft);font-style:italic;margin:6px 0 0}
`.trim();

interface FrameworkPageInput {
  id: string;
  kickerTop: string;
  heading: string;
  metaphor: string;
  translation: string;
  sectionPath: 'nist-csf' | 'cis' | 'ai' | 'iso' | 'soc2';
  sectionLabel: string;
  officialName: string;
  officialUrl: string;
  prev?: string;
  next?: string;
  accent: string;
  accentDark: string;
  /** Short badge shown by the heading (e.g. an IG level). */
  badge?: string;
  /** Cross-framework mapping links (unofficial). */
  mapped?: Array<{ label: string; href: string }>;
  mappedLabel?: string;
}

function frameworkPage(input: FrameworkPageInput): string {
  const slug = frameworkSlug(input.id);
  const url = `${SITE}/frameworks/${input.sectionPath}/${slug}.html`;
  const description = metaDescription(input.translation);
  const jsonLd = jsonLdScript({
    '@context': 'https://schema.org',
    '@type': 'DefinedTerm',
    name: input.id,
    description: `${input.heading} In plain English: ${input.translation}`,
    url,
    inDefinedTermSet: { '@type': 'DefinedTermSet', name: input.sectionLabel, url: `${SITE}/frameworks/${input.sectionPath}/` },
  });
  const pager = `${
    input.prev
      ? `<a href="${frameworkSlug(input.prev)}.html">&larr; ${esc(input.prev)}</a>`
      : '<span></span>'
  }${
    input.next
      ? `<a href="${frameworkSlug(input.next)}.html">${esc(input.next)} &rarr;</a>`
      : '<span></span>'
  }`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <title>${esc(input.id)} in plain English | ${esc(input.sectionLabel)} | Cybersecurity Alphabet Soup</title>
  <meta name="description" content="${description}">
  <link rel="canonical" href="${url}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${esc(input.id)} in plain English">
  <meta property="og:description" content="${description}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${SITE}/og-image.png">
  <meta name="twitter:card" content="summary">
  <link rel="icon" href="../../icon.svg" type="image/svg+xml">
  ${renderFontLinks()}
  <style>${PAGE_CSS}
:root{--tomato:${input.accent}}
@media(prefers-color-scheme:dark){:root{--tomato:${input.accentDark}}}
${FW_EXTRA_CSS}</style>
  <script type="application/ld+json">${jsonLd}</script>
  <script type="application/ld+json">${breadcrumbLd([
    { name: 'Cybersecurity Alphabet Soup', item: `${SITE}/` },
    { name: input.sectionLabel, item: `${SITE}/frameworks/${input.sectionPath}/` },
    { name: input.id, item: url },
  ])}</script>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <main id="main" class="wrap" tabindex="-1">
    ${renderGeneratedNav('../../')}
    <a class="home" href="./">&larr; ${esc(input.sectionLabel)}</a>
    <h1>${esc(input.id)}${input.badge ? ` <span class="ig-badge">${esc(input.badge)}</span>` : ''}</h1>
    <p class="expansion">${esc(input.kickerTop)}</p>
    <div class="card"><p>${esc(input.heading)}</p></div>
    <div class="metaphor"><span class="label">Think of it like</span>${esc(input.metaphor)}</div>
    <h2>In plain English</h2>
    <p>${esc(input.translation)}</p>
    ${
      input.mappedLabel
        ? `<h2>${esc(input.mappedLabel)}</h2>\n    ${
            input.mapped?.length
              ? `<div class="related">${input.mapped
                  .map((m) => `<a href="${esc(m.href)}"${m.label.length > 24 ? ` title="${esc(m.label)}"` : ''}>${esc(m.label)}</a>`)
                  .join('')}</div>`
              : '<p class="no-map">No direct mapping.</p>'
          }`
        : ''
    }
    <nav class="pager">${pager}</nav>
    <footer>
      <p class="play">Learn the language too: <a href="../../">browse the acronym glossary</a> or <a href="${CYBERDLE}" rel="noopener" target="_blank">play Cyberdle &rarr;</a></p>
      <p>Unofficial plain-English companion. Official source: <a href="${esc(input.officialUrl)}" rel="noopener">${esc(input.officialName)}</a>.</p>
      <p><a href="../../privacy/">Privacy</a> &middot; <a href="../../disclosure/">Affiliate disclosure</a></p>
    </footer>
  </main>
</body>
</html>
`;
}

// ------------------------------- blog ---------------------------------

const BLOG_CSS = `
.wrap.blog{max-width:720px}
.blog-intro{color:var(--ink-soft);font-size:1.05rem;margin:6px 0 24px}
.blog-list{list-style:none;padding:0;margin:0}
.blog-card{border-bottom:1.5px solid var(--line);padding:20px 0}
.blog-card:last-child{border-bottom:none}
.blog-card .cat{font-family:'IBM Plex Mono',monospace;font-size:.66rem;letter-spacing:.1em;text-transform:uppercase;color:var(--tomato)}
.blog-card h3{font-family:'Fraunces',Georgia,serif;font-weight:900;font-size:1.5rem;margin:4px 0 6px;line-height:1.1}
.blog-card h3 a{color:var(--ink);text-decoration:none}
.blog-card h3 a:hover{color:var(--tomato)}
.blog-card p{margin:0 0 8px;color:var(--ink-soft)}
.blog-card .when{font-family:'IBM Plex Mono',monospace;font-size:.72rem;color:var(--ink-soft)}
.post-kicker{font-family:'IBM Plex Mono',monospace;font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:var(--tomato);margin:0}
.post-meta{font-family:'IBM Plex Mono',monospace;font-size:.75rem;letter-spacing:.04em;color:var(--ink-soft);margin:6px 0 22px}
.post-body p{margin:0 0 16px;font-size:1.06rem}
.post-body .post-h2{font-family:'Fraunces',Georgia,serif;font-weight:700;text-transform:none;letter-spacing:0;font-size:1.5rem;color:var(--ink);margin:30px 0 10px}
.post-body .post-ul{padding-left:20px;margin:0 0 16px}
.post-body .post-ul li{margin:6px 0}
.post-body blockquote.post-quote{border-left:3px solid var(--tomato);margin:22px 0;padding:2px 0 2px 18px;font-family:'Fraunces',Georgia,serif;font-style:italic;font-size:1.2rem;color:var(--ink-soft)}
.post-body a{color:var(--tomato)}
.post-tags{display:flex;flex-wrap:wrap;gap:6px;margin:22px 0 0}
.post-tags .t{font-family:'IBM Plex Mono',monospace;font-size:.66rem;letter-spacing:.06em;text-transform:uppercase;border:1.5px solid var(--line);border-radius:999px;padding:3px 10px;color:var(--ink-soft)}
`.trim();

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}, ${y}`;
}

function blockHtml(block: BlogBlock): string {
  if (block.type === 'h2') return `<h2 class="post-h2">${renderInline(block.text ?? '')}</h2>`;
  if (block.type === 'quote') return `<blockquote class="post-quote">${renderInline(block.text ?? '')}</blockquote>`;
  if (block.type === 'list') return `<ul class="post-ul">${(block.items ?? []).map((i) => `<li>${renderInline(i)}</li>`).join('')}</ul>`;
  return `<p>${renderInline(block.text ?? '')}</p>`;
}

const relatedChip = (r: { label: string; href: string }): string => {
  const external = /^https?:\/\//.test(r.href);
  return `<a href="${esc(r.href)}"${external ? ' rel="noopener" target="_blank"' : ''}>${esc(r.label)} &rarr;</a>`;
};

function blogHead(
  title: string,
  description: string,
  url: string,
  jsonLds: string[] = [],
  ogImage: string = `${SITE}/og-image.png`,
): string {
  return `<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <title>${esc(title)}</title>
  <meta name="description" content="${metaDescription(description)}">
  <link rel="canonical" href="${url}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${metaDescription(description)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="../icon.svg" type="image/svg+xml">
  <link rel="alternate" type="application/rss+xml" title="Cybersecurity Alphabet Soup blog" href="${SITE}/feed.xml">
  ${renderFontLinks()}
  <style>${PAGE_CSS}${BLOG_CSS}</style>${jsonLds.map((ld) => `\n  <script type="application/ld+json">${ld}</script>`).join('')}
</head>`;
}

function blogIndexPage(posts: BlogPost[]): string {
  const url = `${SITE}/blog/`;
  const cards = posts
    .map(
      (p) => `<li class="blog-card">
        <span class="cat">${esc(p.category)}</span>
        <h3><a href="${esc(p.slug)}.html">${esc(p.title)}</a></h3>
        <p>${esc(p.description)}</p>
        <span class="when">${esc(formatDate(p.date))} &middot; ${p.readingMinutes} min read</span>
      </li>`,
    )
    .join('\n      ');
  return `<!DOCTYPE html>
<html lang="en">
${blogHead('Blog | Cybersecurity Alphabet Soup', 'Plain-English writing on cybersecurity frameworks, the tools that put them to work, careers, and the acronyms worth knowing.', url)}
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <main id="main" class="wrap blog" tabindex="-1">
    ${renderGeneratedNav('../')}
    <a class="home" href="../">&larr; Cybersecurity Alphabet Soup</a>
    <h1>Blog</h1>
    <p class="blog-intro">Plain-English writing on cybersecurity frameworks, the tools that put them to work, breaking into the field, and the acronyms worth knowing.</p>
    <p class="blog-sub"><a href="../feed.xml">Subscribe by RSS &rarr;</a></p>
    <ul class="blog-list">
      ${cards}
    </ul>
    <footer>
      <p class="play">Learn the language while you are here. <a href="${CYBERDLE}" rel="noopener" target="_blank">Play Cyberdle, the daily acronym game &rarr;</a></p>
      <p>Part of <a href="../">Cybersecurity Alphabet Soup</a>, a plain-English dictionary of ${Object.keys(data).length} cybersecurity acronyms.</p>
      <p><a href="../privacy/">Privacy</a> &middot; <a href="../disclosure/">Affiliate disclosure</a></p>
    </footer>
  </main>
</body>
</html>
`;
}

function blogPostPage(post: BlogPost): string {
  const url = `${SITE}/blog/${post.slug}.html`;
  const ogImage = `${SITE}/og/blog/${post.slug}.png`;
  const jsonLd = jsonLdScript({
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    author: { '@type': 'Person', name: post.author, url: `${SITE}/about/` },
    publisher: { '@type': 'Organization', name: 'Cybersecurity Alphabet Soup', url: SITE },
    mainEntityOfPage: url,
    image: ogImage,
    keywords: post.tags.join(', '),
  });
  const crumbs = breadcrumbLd([
    { name: 'Cybersecurity Alphabet Soup', item: `${SITE}/` },
    { name: 'Blog', item: `${SITE}/blog/` },
    { name: post.title, item: url },
  ]);
  const body = post.body.map(blockHtml).join('\n      ');
  const tags = post.tags.map((t) => `<span class="t">${esc(t)}</span>`).join('');
  const related = post.related.map(relatedChip).join('');
  return `<!DOCTYPE html>
<html lang="en">
${blogHead(`${esc(post.title)} | Cybersecurity Alphabet Soup`, post.description, url, [jsonLd, crumbs], ogImage)}
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <main id="main" class="wrap blog" tabindex="-1">
    ${renderGeneratedNav('../')}
    <a class="home" href="./">&larr; Blog</a>
    <p class="post-kicker">${esc(post.category)}</p>
    <h1>${esc(post.title)}</h1>
    <p class="post-meta">By <a href="../about/">${esc(post.author)}</a> &middot; ${esc(formatDate(post.date))} &middot; ${post.readingMinutes} min read</p>
    <div class="post-body">
      ${body}
    </div>
    <div class="post-tags">${tags}</div>
    ${related ? `<h2>Go deeper</h2>\n    <div class="related">${related}</div>` : ''}
    <footer>
      <p class="play">Think you could have guessed it? <a href="${CYBERDLE}" rel="noopener" target="_blank">Play Cyberdle, the daily acronym game &rarr;</a></p>
      <p>Part of <a href="../">Cybersecurity Alphabet Soup</a>. More writing on the <a href="./">blog</a>.</p>
      <p><a href="../privacy/">Privacy</a> &middot; <a href="../disclosure/">Affiliate disclosure</a></p>
    </footer>
  </main>
</body>
</html>
`;
}

const csfIds = Object.keys(csf).sort();
csfIds.forEach((id, i) => {
  const entry = csf[id];
  writeFileSync(
    `${dist}/frameworks/nist-csf/${frameworkSlug(id)}.html`,
    frameworkPage({
      id,
      kickerTop: `${entry.function} / ${entry.category}`,
      heading: entry.text,
      metaphor: entry.metaphor,
      translation: entry.translation,
      sectionPath: 'nist-csf',
      sectionLabel: 'NIST CSF 2.0 in plain English',
      officialName: 'NIST Cybersecurity Framework',
      officialUrl: 'https://www.nist.gov/cyberframework',
      // Keep prev/next within the same function (do not cross GV -> ID).
      prev: csfIds[i - 1]?.slice(0, 2) === id.slice(0, 2) ? csfIds[i - 1] : undefined,
      next: csfIds[i + 1]?.slice(0, 2) === id.slice(0, 2) ? csfIds[i + 1] : undefined,
      accent: '#2c6e91',
      accentDark: '#5da4c9',
      mappedLabel: 'Related CIS safeguards (unofficial mapping)',
      mapped: (csfToCis[id] ?? []).map((cisId) => ({
        label: `CIS ${cisId}: ${cis[cisId].title}`,
        href: `../cis/${frameworkSlug(cisId)}.html`,
      })),
    }),
  );
});

const cisIds = Object.keys(cis).sort((a, b) => {
  const [a1, a2] = a.split('.').map(Number);
  const [b1, b2] = b.split('.').map(Number);
  return a1 - b1 || a2 - b2;
});
cisIds.forEach((id, i) => {
  const entry = cis[id];
  writeFileSync(
    `${dist}/frameworks/cis/${frameworkSlug(id)}.html`,
    frameworkPage({
      id,
      kickerTop: `Control ${entry.control} / ${entry.controlName}`,
      heading: entry.title,
      metaphor: entry.metaphor,
      translation: entry.translation,
      sectionPath: 'cis',
      sectionLabel: 'CIS Controls v8 in plain English',
      officialName: 'CIS Critical Security Controls',
      officialUrl: 'https://www.cisecurity.org/controls',
      // Keep prev/next within the same control number (do not cross 1.x -> 2.x).
      prev: cisIds[i - 1]?.split('.')[0] === id.split('.')[0] ? cisIds[i - 1] : undefined,
      next: cisIds[i + 1]?.split('.')[0] === id.split('.')[0] ? cisIds[i + 1] : undefined,
      accent: '#3e7d4f',
      accentDark: '#6fb383',
      badge: `IG${cisIgs[id] ?? 3}`,
      mappedLabel: 'Related CSF subcategories (unofficial mapping)',
      mapped: (cisToCsf.get(id) ?? []).sort().map((csfId) => ({
        label: csf[csfId] ? `${csfId}: ${csf[csfId].text}` : csfId,
        href: `../nist-csf/${frameworkSlug(csfId)}.html`,
      })),
    }),
  );
});

// 4b. AI security framework pages (NIST AI RMF, OWASP LLM Top 10, MITRE ATLAS, ISO/IEC 42001).
ai.forEach((entry, i) => {
  const prevEntry = ai[i - 1];
  const nextEntry = ai[i + 1];
  writeFileSync(
    `${dist}/frameworks/ai/${frameworkSlug(entry.code)}.html`,
    frameworkPage({
      id: entry.code,
      kickerTop: `${entry.framework} / ${entry.title.length <= 40 ? entry.title : entry.category}`,
      heading: entry.official,
      metaphor: entry.metaphor,
      translation: entry.translation,
      sectionPath: 'ai',
      sectionLabel: 'AI security in plain English',
      officialName: entry.sourceLabel,
      officialUrl: entry.sourceUrl,
      // Keep prev/next within the same framework (do not cross AI RMF -> OWASP).
      prev: prevEntry?.frameworkCode === entry.frameworkCode ? prevEntry.code : undefined,
      next: nextEntry?.frameworkCode === entry.frameworkCode ? nextEntry.code : undefined,
      accent: '#6d4a9c',
      accentDark: '#b79be0',
    }),
  );
});

// 4b-iso. ISO/IEC 27001:2022 Annex A, one page per control.
//
// Only the identifier is borrowed from the standard. Heading, metaphor, and
// translation are original, and the footer says so on every page.
const isoSorted = [...isoData.controls].sort((a, b) => {
  const [, at, an] = a.id.split('.');
  const [, bt, bn] = b.id.split('.');
  return Number(at) - Number(bt) || Number(an) - Number(bn);
});
const isoRelated = new Map<string, { label: string; href: string }[]>();
for (const control of isoSorted) {
  const csf = new Set<string>();
  const cis = new Set<string>();
  for (const domain of crosswalkControls) {
    if (!(domain.mappings.iso ?? []).includes(control.id)) continue;
    for (const id of domain.mappings.csf ?? []) csf.add(id);
    for (const id of domain.mappings.cis ?? []) cis.add(id);
  }
  isoRelated.set(control.id, [
    ...[...csf].sort().slice(0, 6).map((id) => ({ label: id, href: `../nist-csf/${frameworkSlug(id)}.html` })),
    ...[...cis].sort().slice(0, 6).map((id) => ({ label: id, href: `../cis/${frameworkSlug(id)}.html` })),
  ]);
}
isoSorted.forEach((control, i) => {
  const prevEntry = isoSorted[i - 1];
  const nextEntry = isoSorted[i + 1];
  writeFileSync(
    `${dist}/frameworks/iso/${frameworkSlug(control.id)}.html`,
    frameworkPage({
      id: control.id,
      kickerTop: `${control.themeName} / ${control.id}`,
      heading: control.subject,
      metaphor: control.metaphor,
      translation: control.translation,
      sectionPath: 'iso',
      sectionLabel: 'ISO 27001 Annex A in plain English',
      officialName: 'ISO/IEC 27001:2022',
      officialUrl: 'https://www.iso.org/standard/27001',
      // Keep prev/next inside the same theme, so A.5 does not run into A.6.
      prev: prevEntry?.theme === control.theme ? prevEntry.id : undefined,
      next: nextEntry?.theme === control.theme ? nextEntry.id : undefined,
      accent: '#3a6b6b',
      accentDark: '#6fb0b0',
      badge: `A.${control.theme}`,
      mappedLabel: 'Related CSF and CIS controls (unofficial mapping)',
      mapped: isoRelated.get(control.id),
    }),
  );
});

// 4b-soc2. SOC 2 Trust Services Criteria, one page per criterion.
//
// Only the identifier is borrowed from the AICPA. Heading, metaphor, and
// translation are original, and the footer says so on every page.
//
// The related-control derivation is imported rather than repeated because it
// carries a rule: criteria this site does not enumerate produce no entry, so
// the Processing Integrity identifiers the crosswalk cites cannot generate
// links to pages that were never written.
const soc2Sorted = byFamily(soc2Data).flatMap((f) => f.criteria);
const soc2Related = relatedByCriterion(soc2Data, crosswalkControls as CrosswalkDomain[]);
soc2Sorted.forEach((criterion, i) => {
  const prevEntry = soc2Sorted[i - 1];
  const nextEntry = soc2Sorted[i + 1];
  const rel = soc2Related.get(criterion.id);
  const mapped = [
    ...(rel?.csf ?? []).slice(0, 6).map((id) => ({ label: id, href: `../nist-csf/${frameworkSlug(id)}.html` })),
    ...(rel?.cis ?? []).slice(0, 6).map((id) => ({ label: id, href: `../cis/${frameworkSlug(id)}.html` })),
    ...(rel?.iso ?? []).slice(0, 6).map((id) => ({ label: id, href: `../iso/${frameworkSlug(id)}.html` })),
  ];
  writeFileSync(
    `${dist}/frameworks/soc2/${frameworkSlug(criterion.id)}.html`,
    frameworkPage({
      id: criterion.id,
      kickerTop: `${criterion.familyName} / ${criterion.id}`,
      heading: criterion.subject,
      metaphor: criterion.metaphor,
      translation: criterion.translation,
      sectionPath: 'soc2',
      sectionLabel: 'SOC 2 Trust Services Criteria in plain English',
      officialName: 'AICPA Trust Services Criteria',
      officialUrl: soc2Data.meta.officialUrl,
      // Keep prev/next inside the same family, so CC6 does not run into CC7.
      prev: prevEntry?.family === criterion.family ? prevEntry.id : undefined,
      next: nextEntry?.family === criterion.family ? nextEntry.id : undefined,
      accent: '#6a4a7c',
      accentDark: '#b79ecb',
      badge: criterion.family,
      mappedLabel: 'Related CSF, CIS and ISO controls (unofficial mapping)',
      mapped,
    }),
  );
});

// 4c. Blog: index page plus one page per post, newest first.
// Shared with the About page's "Latest writing", so the two always agree.
const sortedPosts = [...blogPosts].sort(byDateDesc);
writeFileSync(`${dist}/blog/index.html`, blogIndexPage(sortedPosts));
for (const post of blogPosts) writeFileSync(`${dist}/blog/${post.slug}.html`, blogPostPage(post));

// 4d. Category hub pages: one landing page per category.
//
// Every definition page already said "More in <category>" and showed a few
// sibling chips, but there was nowhere to see the whole category. These give all
// 580 pages a real onward destination and add ten indexable landing pages for
// the category terms people actually search.
function categoryPage(category: string, entryKeys: string[]): string {
  const title = categoryTitle(category);
  const url = `${SITE}/categories/${categorySlug(category)}.html`;
  const description = `Every ${category} cybersecurity acronym in plain English: ${entryKeys.length} terms, each with a definition and sources.`;
  const items = entryKeys
    .map((key) => {
      const entry = data[key];
      return `      <li><a href="../definitions/${slugForKey(key)}.html"><strong>${esc(entry.display)}</strong> ${esc(entry.expansion)}</a></li>`;
    })
    .join('\n');
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${title} acronyms`,
    description,
    url,
    isPartOf: { '@type': 'WebSite', name: 'Cybersecurity Alphabet Soup', url: `${SITE}/` },
  });
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <title>${esc(title)} acronyms | Cybersecurity Alphabet Soup</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${url}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${esc(title)} cybersecurity acronyms">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${SITE}/og-image.png">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="../icon.svg" type="image/svg+xml">
  <link rel="alternate" type="application/rss+xml" title="Cybersecurity Alphabet Soup blog" href="${SITE}/feed.xml">
  ${renderFontLinks()}
  <style>${PAGE_CSS}
    .cat-list{list-style:none;padding:0;margin:0;display:grid;gap:2px}
    .cat-list li a{display:block;padding:9px 12px;border-radius:8px;text-decoration:none;color:var(--ink);border:1.5px solid transparent}
    .cat-list li a:hover{border-color:var(--line);background:var(--paper-raised)}
    .cat-list strong{font-family:'IBM Plex Mono',monospace;margin-right:10px}
  </style>
  <script type="application/ld+json">${jsonLd}</script>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <main id="main" class="wrap" tabindex="-1">
    ${renderGeneratedNav('../')}
    <a class="home" href="../">&larr; Cybersecurity Alphabet Soup</a>
    <h1>${esc(title)}</h1>
    <p class="expansion">${entryKeys.length} acronyms in this category, in plain English.</p>
    <ul class="cat-list">
${items}
    </ul>
    <h2>Other categories</h2>
    <div class="related">${CATEGORIES.filter((c) => c !== category)
      .map((c) => `<a href="./${categorySlug(c)}.html">${esc(categoryTitle(c))}</a>`)
      .join('')}</div>
    <footer>
      <p>Part of <a href="../">Cybersecurity Alphabet Soup</a>, a plain-English dictionary of ${Object.keys(data).length} cybersecurity acronyms.</p>
      <p><a href="../privacy/">Privacy</a> &middot; <a href="../disclosure/">Affiliate disclosure</a></p>
    </footer>
  </main>
</body>
</html>
`;
}

mkdirSync(`${dist}/categories`, { recursive: true });
const byCategory = new Map<string, string[]>();
for (const key of keys) {
  const list = byCategory.get(data[key].category) ?? [];
  list.push(key);
  byCategory.set(data[key].category, list);
}
for (const category of CATEGORIES) {
  const entryKeys = (byCategory.get(category) ?? []).sort();
  writeFileSync(`${dist}/categories/${categorySlug(category)}.html`, categoryPage(category, entryKeys));
}

// 4f. Affiliate /go/ redirect pages, one per partner in affiliates.json.
//
// Every affiliate anchor on the site points here instead of at the network
// URL, so a changed tracking link is a one-file edit and analytics counts a
// /go/<id>/ pageview per outbound click. Meta refresh rather than an inline
// script: the site ships no executable inline scripts, which e2e/csp.spec.ts
// asserts. The one-second delay gives Cloudflare's edge-injected Web Analytics
// beacon a moment to record the pageview before leaving.
// noindex + robots Disallow because a redirect stub has nothing to rank.
function goPage(partner: AffiliateData['partners'][string]): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta name="robots" content="noindex">
  <meta http-equiv="refresh" content="1; url=${esc(partner.url)}">
  <title>Sending you to ${esc(partner.name)}</title>
  ${renderFontLinks()}
  <style>${PAGE_CSS}</style>
</head>
<body>
  <main class="wrap">
    <a class="home" href="../../">&larr; Cybersecurity Alphabet Soup</a>
    <h1>One moment</h1>
    <p class="expansion">Sending you to ${esc(partner.name)}.</p>
    <div class="card"><p>This is an affiliate link: the site may earn a commission at no extra cost to you. If nothing happens, <a href="${esc(partner.url)}" rel="sponsored noopener">continue to ${esc(partner.name)}</a>. See <a href="../../disclosure/">how affiliate links work here</a>.</p></div>
  </main>
</body>
</html>
`;
}
for (const [id, partner] of Object.entries(affiliates.partners)) {
  if (partner.direct) continue; // linked in place; a stub would violate Amazon's no-cloaking rule
  mkdirSync(`${dist}/go/${id}`, { recursive: true });
  writeFileSync(`${dist}/go/${id}/index.html`, goPage(partner));
}

// 4e. RSS feed for the blog.
//
// Posts publish twice a week on a schedule, which is exactly the case a feed is
// for, and there was no way to subscribe.
const feedItems = sortedPosts
  .map((post) => {
    const link = `${SITE}/blog/${post.slug}.html`;
    return `    <item>
      <title>${esc(post.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${new Date(`${post.date}T09:00:00Z`).toUTCString()}</pubDate>
      <category>${esc(post.category)}</category>
      <description>${esc(post.description)}</description>
    </item>`;
  })
  .join('\n');
writeFileSync(
  `${dist}/feed.xml`,
  `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Cybersecurity Alphabet Soup</title>
    <link>${SITE}/blog/</link>
    <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml"/>
    <description>Plain-English writing on security frameworks, tooling, and building a security career.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date(`${sortedPosts[0].date}T09:00:00Z`).toUTCString()}</lastBuildDate>
${feedItems}
  </channel>
</rss>
`,
);

// 5. Sitemap and robots.
const urls = [
  ...CATEGORIES.map((c) => `${SITE}/categories/${categorySlug(c)}.html`),
  `${SITE}/`,
  `${SITE}/frameworks/`,
  `${SITE}/frameworks/nist-csf/`,
  `${SITE}/frameworks/cis/`,
  `${SITE}/frameworks/ai/`,
  `${SITE}/quiz/`,
  `${SITE}/assess/`,
  `${SITE}/roadmap/`,
  `${SITE}/tools/`,
  // Derived from the filesystem so a new tool can never be missed (was hardcoded).
  ...toolSlugs.map((slug) => `${SITE}/tools/${slug}/`),
  `${SITE}/careers/`,
  `${SITE}/news/`,
  `${SITE}/about/`,
  `${SITE}/assess/cmmc/`,
  `${SITE}/privacy/`,
  `${SITE}/disclosure/`,
  `${SITE}/blog/`,
  ...blogPosts.map((post) => `${SITE}/blog/${post.slug}.html`),
  ...keys.map((key) => `${SITE}/definitions/${slugForKey(key)}.html`),
  ...csfIds.map((id) => `${SITE}/frameworks/nist-csf/${frameworkSlug(id)}.html`),
  ...cisIds.map((id) => `${SITE}/frameworks/cis/${frameworkSlug(id)}.html`),
  ...ai.map((entry) => `${SITE}/frameworks/ai/${frameworkSlug(entry.code)}.html`),
  `${SITE}/frameworks/iso/`,
  ...isoSorted.map((c) => `${SITE}/frameworks/iso/${frameworkSlug(c.id)}.html`),
  `${SITE}/frameworks/soc2/`,
  ...soc2Sorted.map((c) => `${SITE}/frameworks/soc2/${frameworkSlug(c.id)}.html`),
];
// lastmod only where a truthful date exists (blog posts carry real dates).
// Stamping every URL with the build date would be fake freshness, which
// crawlers learn to distrust; partial lastmod is valid sitemap XML.
const lastmodByUrl = new Map(blogPosts.map((post) => [`${SITE}/blog/${post.slug}.html`, post.date]));
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map((url) => {
    const lastmod = lastmodByUrl.get(url);
    return `  <url><loc>${esc(url)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`;
  })
  .join('\n')}
</urlset>
`;
writeFileSync(`${dist}/sitemap.xml`, sitemap);
writeFileSync(
  `${dist}/robots.txt`,
  `User-agent: *\nAllow: /\nDisallow: /go/\n\nSitemap: ${SITE}/sitemap.xml\n`,
);

// 5b. Custom 404. GitHub Pages serves 404.html for any missing path (with a
// real 404 status, so it needs no noindex and stays out of the sitemap). For
// a lookup site the useful dead end is a search box: the form is plain HTML
// GET to the homepage, which already reads ?q=, so no script is involved.
writeFileSync(
  `${dist}/404.html`,
  `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <title>Not found | Cybersecurity Alphabet Soup</title>
  <meta name="description" content="That page is not in the soup. Search the ${Object.keys(data).length}-term cybersecurity glossary instead.">
  <link rel="icon" href="/icon.svg" type="image/svg+xml">
  ${renderFontLinks()}
  <style>${PAGE_CSS}
.search-404{display:flex;gap:10px;margin:22px 0 8px}
.search-404 input{flex:1;font:inherit;font-size:1.05rem;padding:12px 18px;border:2px solid var(--ink);border-radius:999px;background:var(--paper-raised);color:var(--ink)}
.search-404 button{font-family:'IBM Plex Mono',monospace;font-size:.8rem;letter-spacing:.1em;text-transform:uppercase;padding:12px 22px;border:2px solid var(--tomato);border-radius:999px;background:var(--tomato);color:var(--paper);cursor:pointer}
</style>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <main id="main" class="wrap" tabindex="-1">
    ${renderGeneratedNav('/')}
    <a class="home" href="/">&larr; Cybersecurity Alphabet Soup</a>
    <h1>404</h1>
    <p class="expansion">Not Found (the one acronym we never wanted you to see)</p>
    <div class="card"><p>That page is not in the soup. If you were hunting an acronym, the search below covers all ${Object.keys(data).length} terms; if you typed a URL by hand, the glossary index is one click away.</p></div>
    <form class="search-404" action="/" method="get" role="search">
      <input type="search" name="q" placeholder="Try SIEM, ZTNA, PCI DSS..." aria-label="Search acronyms" autofocus>
      <button type="submit">Search</button>
    </form>
    <h2>Or start somewhere useful</h2>
    <div class="related">
      <a href="/">All ${Object.keys(data).length} acronyms</a>
      <a href="/frameworks/">Framework translations</a>
      <a href="/quiz/">Practice quizzes</a>
      <a href="/blog/">Blog</a>
      <a href="/careers/">Careers</a>
    </div>
    <footer>
      <p>Part of <a href="/">Cybersecurity Alphabet Soup</a>, a plain-English dictionary of ${Object.keys(data).length} cybersecurity acronyms.</p>
      <p><a href="/privacy/">Privacy</a> &middot; <a href="/disclosure/">Affiliate disclosure</a></p>
    </footer>
  </main>
</body>
</html>
`,
);

// 6. llms.txt and llms-full.txt: the site condensed for AI systems.
//
// llms.txt is the emerging convention (llmstxt.org) for handing language
// models a curated map of a site. This site is the ideal case: the content is
// already structured data, so both files derive from the same JSON as the
// pages and can never drift from them. llms-full.txt inlines every definition
// so a single fetch puts the whole glossary in an agent's context.
const llmsIndex = `# Cybersecurity Alphabet Soup

> A free, plain-English cybersecurity dictionary and learning site: ${keys.length} acronyms explained with authoritative sources, control-by-control framework translations (NIST CSF 2.0, CIS Controls v8, ISO 27001 Annex A, SOC 2, AI security frameworks), certification practice quizzes, self-assessments, and career guides. Written by Parker Brissette, a security practitioner with 15+ years in the field.

Every definition page gives the acronym's expansion, a plain-English explanation of why it matters, and sources. Definition URLs follow ${SITE}/definitions/<term>.html.

## Glossary
- [Full glossary and search](${SITE}/): all ${keys.length} terms
${CATEGORIES.map((c) => `- [${categoryTitle(c)} acronyms](${SITE}/categories/${categorySlug(c)}.html): ${(byCategory.get(c) ?? []).length} terms`).join('\n')}
- [llms-full.txt](${SITE}/llms-full.txt): every definition in one plain-text file

## Framework translations
- [NIST CSF 2.0 in plain English](${SITE}/frameworks/nist-csf/): ${csfIds.length} subcategories
- [CIS Controls v8 in plain English](${SITE}/frameworks/cis/): ${cisIds.length} safeguards
- [ISO 27001 Annex A in plain English](${SITE}/frameworks/iso/): ${isoSorted.length} controls
- [SOC 2 Trust Services Criteria in plain English](${SITE}/frameworks/soc2/): ${soc2Sorted.length} criteria
- [AI security frameworks in plain English](${SITE}/frameworks/ai/): ${ai.length} entries

## Learn and practice
- [Certification practice quizzes](${SITE}/quiz/)
- [Security self-assessments](${SITE}/assess/)
- [Security career roadmap](${SITE}/roadmap/)
- [Security careers guide](${SITE}/careers/)
- [Blog](${SITE}/blog/): honest reviews and plain-English explainers, twice weekly
- [About the site and author](${SITE}/about/)
`;
writeFileSync(`${dist}/llms.txt`, llmsIndex);

const llmsFull = `${llmsIndex}
# Full glossary

${CATEGORIES.map(
  (c) =>
    `## ${categoryTitle(c)}\n\n${(byCategory.get(c) ?? [])
      .map((key) => `${data[key].display} (${data[key].expansion}): ${data[key].explanation}`)
      .join('\n\n')}`,
).join('\n\n')}
`;
writeFileSync(`${dist}/llms-full.txt`, llmsFull);

// 7. IndexNow key file. The key is public by design (the protocol verifies
// ownership by fetching this file from the host); deploy.yml pings the API
// with it after each deploy so Bing-family indexes hear about changes
// immediately instead of at the next crawl.
const INDEXNOW_KEY = 'cas2026indexnow8f41b2c7d5e9a638';
writeFileSync(`${dist}/${INDEXNOW_KEY}.txt`, `${INDEXNOW_KEY}\n`);

console.log(
  `Generated ${keys.length} definition pages, ${csfIds.length} CSF pages, ${cisIds.length} CIS pages, ${ai.length} AI pages, ${isoSorted.length} ISO pages, ${soc2Sorted.length} SOC 2 pages, ${blogPosts.length} blog posts, ${aliases} legacy aliases, ${fallbacks} search fallbacks, ${rootRedirects} root redirects, ${Object.values(affiliates.partners).filter((p) => !p.direct).length} affiliate redirects, llms.txt + llms-full.txt, IndexNow key, sitemap with ${urls.length} URLs.`,
);
