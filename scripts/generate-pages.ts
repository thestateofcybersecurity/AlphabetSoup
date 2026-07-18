import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveLegacySlug, slugForKey } from '../src/lib/slug';
import type { AcronymData, AcronymEntry } from '../src/lib/types';

const SITE = 'https://cybersecurityalphabetsoup.com';
const CYBERDLE = 'https://thestateofcybersecurity.github.io/cyberdle/';

const root = fileURLToPath(new URL('..', import.meta.url));
const data = JSON.parse(readFileSync(`${root}src/data/acronyms.json`, 'utf8')) as AcronymData;
const legacy = JSON.parse(readFileSync(`${root}src/data/legacy-slugs.json`, 'utf8')) as {
  definitions: string[];
  root: string[];
};

const dist = `${root}dist`;
mkdirSync(`${dist}/definitions`, { recursive: true });

const esc = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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
`.trim();

function relatedKeys(key: string): string[] {
  const category = data[key].category;
  const siblings = Object.keys(data)
    .filter((k) => k !== key && data[k].category === category)
    .sort();
  const start = siblings.findIndex((k) => k > key);
  const picks: string[] = [];
  for (let i = 0; i < Math.min(4, siblings.length); i++) {
    picks.push(siblings[(Math.max(start, 0) + i) % siblings.length]);
  }
  return picks;
}

function definitionPage(key: string, entry: AcronymEntry): string {
  const slug = slugForKey(key);
  const url = `${SITE}/definitions/${slug}.html`;
  const description = esc(entry.explanation.split('. ')[0] + '.');
  const jsonLd = JSON.stringify({
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
  <title>${esc(entry.display)} - ${esc(entry.expansion)} | Cybersecurity Alphabet Soup</title>
  <meta name="description" content="${description}">
  <link rel="canonical" href="${url}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${esc(entry.display)}: ${esc(entry.expansion)}">
  <meta property="og:description" content="${description}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${SITE}/og-image.png">
  <meta name="twitter:card" content="summary">
  <link rel="icon" href="../icon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,900;1,9..144,500&family=IBM+Plex+Mono:wght@500;600&family=IBM+Plex+Sans:ital,wght@0,400;0,600;1,400&display=swap" rel="stylesheet">
  <style>${PAGE_CSS}</style>
  <script type="application/ld+json">${jsonLd}</script>
</head>
<body>
  <div class="wrap">
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
    <div class="related">${related}</div>
    <footer>
      <p class="play">Think you could have guessed it? <a href="${CYBERDLE}" rel="noopener">Play Cyberdle, the daily acronym game &rarr;</a></p>
      <p>Part of <a href="../">Cybersecurity Alphabet Soup</a>, a plain-English dictionary of ${Object.keys(data).length} cybersecurity acronyms.</p>
    </footer>
  </div>
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

// 4. Sitemap and robots.
const urls = [`${SITE}/`, ...keys.map((key) => `${SITE}/definitions/${slugForKey(key)}.html`)];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${esc(url)}</loc></url>`).join('\n')}
</urlset>
`;
writeFileSync(`${dist}/sitemap.xml`, sitemap);
writeFileSync(`${dist}/robots.txt`, `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);

console.log(
  `Generated ${keys.length} definition pages, ${aliases} legacy aliases, ${fallbacks} search fallbacks, ${rootRedirects} root redirects, sitemap with ${urls.length} URLs.`,
);
