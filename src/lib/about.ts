/**
 * Build-time fragments for the About page.
 *
 * The About page carries a proof strip ("545 acronyms explained ...") and a
 * "Latest writing" list. Hardcoding either would drift the moment an acronym
 * or a blog post lands, so the page keeps `<!--about-stats-->` and
 * `<!--about-latest-writing-->` markers and a Vite plugin (vite.config.ts)
 * replaces them from the same data files everything else reads. Runs in dev
 * and build, so the numbers on screen are always the numbers in the data.
 */

export const ABOUT_STATS_MARKER = '<!--about-stats-->';
export const ABOUT_LATEST_WRITING_MARKER = '<!--about-latest-writing-->';

/** How many posts "Latest writing" shows. */
export const LATEST_POST_COUNT = 3;

export interface AboutStatCounts {
  /** Entries in acronyms.json. */
  acronyms: number;
  /** NIST CSF subcategories plus CIS safeguards. */
  controls: number;
  /** Questions across every quiz deck. */
  questions: number;
  /** Companion apps, from the nav's EXTERNAL_LINKS. */
  apps: number;
}

export interface AboutPost {
  slug: string;
  title: string;
  description: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
}

/**
 * Newest first, ties broken by title. The same ordering the blog index uses
 * (scripts/generate-pages.ts imports this comparator), so "Latest writing"
 * can never disagree with /blog/ about what is newest.
 */
export function byDateDesc(a: { date: string; title: string }, b: { date: string; title: string }): number {
  return a.date < b.date ? 1 : a.date > b.date ? -1 : a.title.localeCompare(b.title);
}

export function latestPosts<T extends { date: string; title: string }>(posts: T[], count = LATEST_POST_COUNT): T[] {
  return [...posts].sort(byDateDesc).slice(0, count);
}

/** Escape for text and quoted-attribute context. Pure, so it runs in Node. */
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-08-03" -> "August 3, 2026", matching the blog index. */
export function formatPostDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}, ${y}`;
}

export function renderProofStrip(counts: AboutStatCounts): string {
  const n = (value: number): string => value.toLocaleString('en-US');
  const stats = [
    `${n(counts.acronyms)} acronyms explained`,
    `${n(counts.controls)} framework controls translated`,
    `${n(counts.questions)}+ practice questions`,
    `${n(counts.apps)} companion apps`,
    '100% free, no accounts',
  ];
  const items = stats.map((stat) => `<li>${stat}</li>`).join('\n        ');
  return `<ul class="proof-strip" aria-label="The site by the numbers">
        ${items}
      </ul>`;
}

/** Rendered with links relative to /about/, the only page that embeds this. */
export function renderLatestWriting(posts: AboutPost[]): string {
  const items = posts
    .map(
      (post) => `<li>
          <h3><a href="../blog/${esc(post.slug)}.html">${esc(post.title)}</a></h3>
          <span class="when">${esc(formatPostDate(post.date))}</span>
          <p>${esc(post.description)}</p>
        </li>`,
    )
    .join('\n        ');
  return `<h2 class="about-h2">Latest writing</h2>
      <ul class="latest-writing">
        ${items}
      </ul>
      <p class="all-posts"><a href="../blog/">All posts &rarr;</a></p>`;
}

/**
 * Replace both About-page markers. Pages without the markers pass through
 * untouched, so the plugin can run on every hand-written page.
 */
export function withAboutSections(html: string, counts: AboutStatCounts, posts: AboutPost[]): string {
  if (!html.includes(ABOUT_STATS_MARKER) && !html.includes(ABOUT_LATEST_WRITING_MARKER)) return html;
  return html
    .replace(ABOUT_STATS_MARKER, renderProofStrip(counts))
    .replace(ABOUT_LATEST_WRITING_MARKER, renderLatestWriting(latestPosts(posts)));
}
