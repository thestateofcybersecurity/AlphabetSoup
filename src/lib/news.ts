/**
 * Ransomware Watch feed: parsing and rendering.
 *
 * The news page consumes feed.json from the ransomwareRSS companion repo
 * (github.com/thestateofcybersecurity/ransomwareRSS), which regenerates hourly
 * on GitHub Actions from the ransomware.live v2 API and publishes to GitHub
 * Pages alongside the RSS feed itself.
 *
 * Every string in the feed originates on criminal leak sites, so this module
 * treats the payload as hostile: fields are coerced and escaped, and links are
 * dropped unless they point at ransomware.live. Escaping is done with pure
 * string replacement rather than src/lib/escape.ts because that helper needs a
 * DOM and this module is unit-tested under Node.
 */

export interface NewsItem {
  group: string;
  victim: string;
  sector: string;
  country: string;
  /** ISO 8601 timestamp of when the claim was discovered. */
  discovered: string;
  /** Link to the ransomware.live victim page, or '' when absent. */
  link: string;
}

export interface NewsFeed {
  /** ISO 8601 timestamp of the last feed regeneration. */
  updated: string;
  items: NewsItem[];
}

const FEED_BASE = 'https://thestateofcybersecurity.github.io/ransomwareRSS/';
export const FEED_JSON_URL = `${FEED_BASE}feed.json`;
export const FEED_XML_URL = `${FEED_BASE}feed.xml`;
export const AGG_JSON_URL = `${FEED_BASE}cybersecurity-feed.json`;
export const AGG_XML_URL = `${FEED_BASE}cybersecurity-feed.xml`;
export const OPML_URL = `${FEED_BASE}feeds.opml`;
export const DIRECTORY_JSON_URL = `${FEED_BASE}feeds.json`;

/** Only links into ransomware.live survive parsing; anything else becomes ''. */
const LINK_PREFIX = 'https://www.ransomware.live/';

/** Escape for text context (between tags). */
function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escape for a quoted attribute value. */
function escAttr(value: string): string {
  return esc(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Validates the fetched payload into a NewsFeed. Items missing a group or a
 * parseable timestamp are dropped rather than rendered half-empty; a payload
 * that is not shaped like the feed at all yields an empty feed, which the page
 * renders as its error state.
 */
export function parseFeed(raw: unknown): NewsFeed {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { items?: unknown }).items)) {
    return { updated: '', items: [] };
  }
  const { updated, items } = raw as { updated?: unknown; items: unknown[] };
  const parsed: NewsItem[] = [];
  for (const entry of items) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const group = asString(record.group).trim();
    const discovered = asString(record.discovered);
    if (!group || Number.isNaN(Date.parse(discovered))) continue;
    const link = asString(record.link);
    parsed.push({
      group,
      victim: asString(record.victim).trim() || 'Unnamed victim',
      sector: asString(record.sector).trim(),
      country: asString(record.country).trim(),
      discovered,
      link: link.startsWith(LINK_PREFIX) ? link : '',
    });
  }
  return { updated: Number.isNaN(Date.parse(asString(updated))) ? '' : asString(updated), items: parsed };
}

/** "3 hours ago" style timestamps, coarse on purpose: the feed is hourly. */
export function relativeTime(iso: string, now: Date): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const minutes = Math.max(0, Math.round((now.getTime() - then) / 60_000));
  if (minutes < 60) return minutes <= 1 ? 'just now' : `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return `${days} days ago`;
}

/** One claim as a list row. Victim name links out only when a link survived parsing. */
function renderItem(item: NewsItem, now: Date): string {
  const victim = item.link
    ? `<a href="${escAttr(item.link)}" rel="noopener" target="_blank">${esc(item.victim)}</a>`
    : esc(item.victim);
  const meta = [item.sector, item.country].filter(Boolean).map(esc).join(' &middot; ');
  return `<li class="news-item">
    <span class="news-group">${esc(item.group)}</span>
    <span class="news-victim">${victim}</span>
    <span class="news-meta">${meta}</span>
    <time class="news-time" datetime="${escAttr(item.discovered)}">${esc(relativeTime(item.discovered, now))}</time>
  </li>`;
}

export function renderItems(items: NewsItem[], now: Date): string {
  return items.map((item) => renderItem(item, now)).join('\n');
}

/** The status line above the list: claim count and feed freshness. */
export function renderStatus(feed: NewsFeed, now: Date): string {
  const count = feed.items.length;
  const freshness = feed.updated ? `, updated ${relativeTime(feed.updated, now)}` : '';
  return `${count} recent claim${count === 1 ? '' : 's'}${freshness}`;
}

/**
 * The aggregated headlines feed (cybersecurity-feed.json): one item per story
 * across the curated sources. Sources are reputable publishers, but the
 * payload still transits our feed pipeline, so it gets the same hostile
 * treatment; links must be https to survive.
 */

export interface Headline {
  source: string;
  sourceUrl: string;
  title: string;
  link: string;
  /** ISO 8601 publication timestamp. */
  date: string;
  excerpt: string;
}

export interface HeadlineFeed {
  updated: string;
  items: Headline[];
}

function httpsOnly(url: string): string {
  return url.startsWith('https://') ? url : '';
}

export function parseHeadlines(raw: unknown): HeadlineFeed {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { items?: unknown }).items)) {
    return { updated: '', items: [] };
  }
  const { updated, items } = raw as { updated?: unknown; items: unknown[] };
  const parsed: Headline[] = [];
  for (const entry of items) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const title = asString(record.title).trim();
    const link = httpsOnly(asString(record.link));
    const date = asString(record.date);
    if (!title || !link || Number.isNaN(Date.parse(date))) continue;
    parsed.push({
      source: asString(record.source).trim(),
      sourceUrl: httpsOnly(asString(record.sourceUrl)),
      title,
      link,
      date,
      excerpt: asString(record.excerpt).trim(),
    });
  }
  return { updated: Number.isNaN(Date.parse(asString(updated))) ? '' : asString(updated), items: parsed };
}

export function renderHeadlines(items: Headline[], now: Date): string {
  return items
    .map(
      (item) => `<li class="hl-item">
    <a class="hl-title" href="${escAttr(item.link)}" rel="noopener" target="_blank">${esc(item.title)}</a>
    <span class="hl-meta">${esc(item.source)}${item.source ? ' &middot; ' : ''}<time datetime="${escAttr(item.date)}">${esc(relativeTime(item.date, now))}</time></span>
  </li>`,
    )
    .join('\n');
}

/** The recommended-feeds directory (feeds.json), grouped by category. */

export interface FeedInfo {
  name: string;
  category: string;
  url: string;
  homepage: string;
  blurb: string;
}

export function parseDirectory(raw: unknown): FeedInfo[] {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { feeds?: unknown }).feeds)) {
    return [];
  }
  const parsed: FeedInfo[] = [];
  for (const entry of (raw as { feeds: unknown[] }).feeds) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const name = asString(record.name).trim();
    const url = httpsOnly(asString(record.url));
    if (!name || !url) continue;
    parsed.push({
      name,
      category: asString(record.category).trim() || 'More',
      url,
      homepage: httpsOnly(asString(record.homepage)),
      blurb: asString(record.blurb).trim(),
    });
  }
  return parsed;
}

export function renderDirectory(feeds: FeedInfo[]): string {
  const categories = [...new Set(feeds.map((feed) => feed.category))];
  return categories
    .map((category) => {
      const rows = feeds
        .filter((feed) => feed.category === category)
        .map((feed) => {
          const name = feed.homepage
            ? `<a href="${escAttr(feed.homepage)}" rel="noopener">${esc(feed.name)}</a>`
            : esc(feed.name);
          return `<li class="dir-item">
      <span class="dir-name">${name}</span>
      <span class="dir-blurb">${esc(feed.blurb)}</span>
      <a class="dir-rss" href="${escAttr(feed.url)}" rel="noopener">RSS</a>
    </li>`;
        })
        .join('\n');
      return `<section class="dir-group">
    <h3>${esc(category)}</h3>
    <ul class="dir-list">
${rows}
    </ul>
  </section>`;
    })
    .join('\n');
}
