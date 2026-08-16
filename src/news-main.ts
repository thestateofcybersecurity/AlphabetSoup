import {
  AGG_JSON_URL,
  AGG_XML_URL,
  DIRECTORY_JSON_URL,
  FEED_JSON_URL,
  FEED_XML_URL,
  parseDirectory,
  parseFeed,
  parseHeadlines,
  renderDirectory,
  renderHeadlines,
  renderItems,
  renderStatus,
} from './lib/news';

const HEADLINE_LIMIT = 40;

/**
 * All three payloads live on GitHub Pages (which sends
 * `access-control-allow-origin: *`) rather than in the build, so the page
 * shows live data without a site deploy. Each section loads and fails
 * independently: ad blockers, offline readers, or a Pages outage land in a
 * per-section fallback that still points at the raw feed.
 */

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);
  return response.json();
}

function feedDownMessage(feedUrl: string): string {
  return (
    'This section could not be loaded right now. ' +
    `You can still <a href="${feedUrl}" rel="noopener">open the raw feed</a> or try again shortly.`
  );
}

async function loadHeadlines(): Promise<void> {
  const list = document.getElementById('hl-list') as HTMLOListElement;
  const status = document.getElementById('hl-status') as HTMLParagraphElement;
  try {
    const feed = parseHeadlines(await fetchJson(AGG_JSON_URL));
    if (feed.items.length === 0) throw new Error('feed empty after parsing');
    const now = new Date();
    const shown = feed.items.slice(0, HEADLINE_LIMIT);
    list.innerHTML = renderHeadlines(shown, now);
    status.textContent = `${shown.length} of ${feed.items.length} stories from the past week`;
  } catch {
    status.innerHTML = feedDownMessage(AGG_XML_URL);
  }
}

async function loadRansomwatch(): Promise<void> {
  const list = document.getElementById('news-list') as HTMLOListElement;
  const status = document.getElementById('news-status') as HTMLParagraphElement;
  try {
    const feed = parseFeed(await fetchJson(FEED_JSON_URL));
    if (feed.items.length === 0) throw new Error('feed empty after parsing');
    const now = new Date();
    list.innerHTML = renderItems(feed.items, now);
    status.textContent = renderStatus(feed, now);
  } catch {
    status.innerHTML = feedDownMessage(FEED_XML_URL);
  }
}

async function loadDirectory(): Promise<void> {
  const wrap = document.getElementById('dir-wrap') as HTMLDivElement;
  const status = document.getElementById('dir-status') as HTMLParagraphElement;
  try {
    const feeds = parseDirectory(await fetchJson(DIRECTORY_JSON_URL));
    if (feeds.length === 0) throw new Error('directory empty after parsing');
    wrap.innerHTML = renderDirectory(feeds);
    status.textContent = `${feeds.length} feeds, hand-picked and checked`;
  } catch {
    status.innerHTML =
      'The directory could not be loaded right now, but the same list is in ' +
      '<a href="https://thestateofcybersecurity.github.io/ransomwareRSS/feeds.opml" rel="noopener">the OPML file</a>.';
  }
}

void loadHeadlines();
void loadRansomwatch();
void loadDirectory();
