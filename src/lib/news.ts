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
