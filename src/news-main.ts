import { FEED_JSON_URL, FEED_XML_URL, parseFeed, renderItems, renderStatus } from './lib/news';

const list = document.getElementById('news-list') as HTMLOListElement;
const status = document.getElementById('news-status') as HTMLParagraphElement;

/**
 * The feed lives on GitHub Pages (which sends `access-control-allow-origin: *`)
 * rather than in the build, so the page shows live data without a site deploy.
 * Failure is a normal state here: ad blockers, offline readers, or a Pages
 * outage all land in the same fallback, which points at the RSS feed itself.
 */
async function load(): Promise<void> {
  try {
    const response = await fetch(FEED_JSON_URL);
    if (!response.ok) throw new Error(`feed responded ${response.status}`);
    const feed = parseFeed(await response.json());
    if (feed.items.length === 0) throw new Error('feed empty after parsing');
    const now = new Date();
    list.innerHTML = renderItems(feed.items, now);
    status.textContent = renderStatus(feed, now);
  } catch {
    status.innerHTML =
      'The live feed could not be loaded right now. ' +
      `You can still <a href="${FEED_XML_URL}" rel="noopener">open the raw RSS feed</a> or try again shortly.`;
  }
}

void load();
