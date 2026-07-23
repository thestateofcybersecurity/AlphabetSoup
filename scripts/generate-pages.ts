import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveLegacySlug, slugForKey } from '../src/lib/slug';
import { frameworkSlug } from '../src/lib/frameworks';
import { relatedFor } from '../src/lib/related';
import type { AcronymData, AcronymEntry } from '../src/lib/types';
import type { AiData, CisData, CsfData } from '../src/lib/frameworks';

const SITE = 'https://cybersecurityalphabetsoup.com';
const CYBERDLE = 'https://thestateofcybersecurity.github.io/cyberdle/';

const root = fileURLToPath(new URL('..', import.meta.url));
const data = JSON.parse(readFileSync(`${root}src/data/acronyms.json`, 'utf8')) as AcronymData;
const csf = JSON.parse(readFileSync(`${root}src/data/nist-csf.json`, 'utf8')) as CsfData;
const cis = JSON.parse(readFileSync(`${root}src/data/cis.json`, 'utf8')) as CisData;
const ai = JSON.parse(readFileSync(`${root}src/data/ai-frameworks.json`, 'utf8')) as AiData;
const cisIgs = JSON.parse(readFileSync(`${root}src/data/cis-igs.json`, 'utf8')) as Record<string, number>;
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

const dist = `${root}dist`;
mkdirSync(`${dist}/definitions`, { recursive: true });
mkdirSync(`${dist}/frameworks/nist-csf`, { recursive: true });
mkdirSync(`${dist}/frameworks/cis`, { recursive: true });
mkdirSync(`${dist}/frameworks/ai`, { recursive: true });

const esc = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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
a:focus-visible,button:focus-visible{outline:2px solid var(--tomato);outline-offset:2px;border-radius:4px}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.001ms!important;transition-duration:.001ms!important}}
`.trim();

const CYBERDLE_NAV = 'https://thestateofcybersecurity.github.io/cyberdle/';
const MITRE_NAV = 'https://mitre.cybersecurityalphabetsoup.com/';
const BIA_NAV = 'https://bia.cybersecurityalphabetsoup.com/';

/** Compact site nav for generated pages; prefix is the relative path to site root. */
function navHtml(prefix: string): string {
  const links: Array<[string, string]> = [
    [`${prefix}`, 'Acronyms'],
    [`${prefix}frameworks/nist-csf/`, 'NIST CSF'],
    [`${prefix}frameworks/cis/`, 'CIS Controls'],
    [`${prefix}frameworks/ai/`, 'AI Security'],
    [`${prefix}quiz/`, 'Quiz'],
    [`${prefix}assess/`, 'Assess'],
    [`${prefix}roadmap/`, 'Roadmap'],
  ];
  return `<nav class="gnav">${links
    .map(([href, label]) => `<a href="${href}">${label}</a>`)
    .join('')}<a href="${MITRE_NAV}" rel="noopener" target="_blank">MITRE ATT&amp;CK</a><a href="${BIA_NAV}" rel="noopener" target="_blank" title="Business Impact Assessment">BIA</a><a class="play-link" href="${CYBERDLE_NAV}" rel="noopener" target="_blank">Cyberdle</a></nav>`;
}

const relatedKeys = (key: string): string[] => relatedFor(key, data);

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
  <title>${esc(entry.display)} - ${esc(entry.expansion)} | Cybersecurity Alphabet Soup</title>
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
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,900;1,9..144,500&family=IBM+Plex+Mono:wght@500;600&family=IBM+Plex+Sans:ital,wght@0,400;0,600;1,400&display=swap" rel="stylesheet">
  <style>${PAGE_CSS}</style>
  <script type="application/ld+json">${jsonLd}</script>
</head>
<body>
  <div class="wrap">
    ${navHtml('../')}
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
    ${
      FRAMEWORK_LINKS[key] || QUIZ_LINKS[key] || BIA_LINKS.has(key)
        ? `<h2>Go deeper</h2>\n    <div class="related">${
            FRAMEWORK_LINKS[key]
              ? `<a href="../frameworks/${FRAMEWORK_LINKS[key].path}/">${esc(FRAMEWORK_LINKS[key].label)} &rarr;</a>`
              : ''
          }${
            QUIZ_LINKS[key]
              ? `<a href="../quiz/?deck=${QUIZ_LINKS[key]}">Practice ${esc(entry.display)} questions &rarr;</a>`
              : ''
          }${
            BIA_LINKS.has(key)
              ? `<a href="${BIA_NAV}" rel="noopener" target="_blank">Assess business impact with the BIA tool &rarr;</a>`
              : ''
          }</div>`
        : ''
    }
    <footer>
      <p class="play">Think you could have guessed it? <a href="${CYBERDLE}" rel="noopener" target="_blank">Play Cyberdle, the daily acronym game &rarr;</a></p>
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
  sectionPath: 'nist-csf' | 'cis' | 'ai';
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
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,900;1,9..144,500&family=IBM+Plex+Mono:wght@500;600&family=IBM+Plex+Sans:ital,wght@0,400;0,600;1,400&display=swap" rel="stylesheet">
  <style>${PAGE_CSS}
:root{--tomato:${input.accent}}
@media(prefers-color-scheme:dark){:root{--tomato:${input.accentDark}}}
${FW_EXTRA_CSS}</style>
  <script type="application/ld+json">${jsonLd}</script>
</head>
<body>
  <div class="wrap">
    ${navHtml('../../')}
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
    </footer>
  </div>
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

// 5. Sitemap and robots.
const urls = [
  `${SITE}/`,
  `${SITE}/frameworks/nist-csf/`,
  `${SITE}/frameworks/cis/`,
  `${SITE}/frameworks/ai/`,
  `${SITE}/quiz/`,
  `${SITE}/assess/`,
  `${SITE}/roadmap/`,
  `${SITE}/tools/ai-risk/`,
  `${SITE}/careers/`,
  `${SITE}/about/`,
  `${SITE}/assess/cmmc/`,
  ...keys.map((key) => `${SITE}/definitions/${slugForKey(key)}.html`),
  ...csfIds.map((id) => `${SITE}/frameworks/nist-csf/${frameworkSlug(id)}.html`),
  ...cisIds.map((id) => `${SITE}/frameworks/cis/${frameworkSlug(id)}.html`),
  ...ai.map((entry) => `${SITE}/frameworks/ai/${frameworkSlug(entry.code)}.html`),
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${esc(url)}</loc></url>`).join('\n')}
</urlset>
`;
writeFileSync(`${dist}/sitemap.xml`, sitemap);
writeFileSync(`${dist}/robots.txt`, `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);

console.log(
  `Generated ${keys.length} definition pages, ${csfIds.length} CSF pages, ${cisIds.length} CIS pages, ${ai.length} AI pages, ${aliases} legacy aliases, ${fallbacks} search fallbacks, ${rootRedirects} root redirects, sitemap with ${urls.length} URLs.`,
);
