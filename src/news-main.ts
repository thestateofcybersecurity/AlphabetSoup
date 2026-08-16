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

/**
 * The alert subscription is the one feature on the site with a server side: a
 * Cloudflare Worker at alerts.cybersecurityalphabetsoup.com storing email +
 * watch terms, double opt-in, documented in /privacy/. The form degrades to a
 * clear error message when the Worker is unreachable.
 */
const ALERTS_URL = 'https://alerts.cybersecurityalphabetsoup.com/subscribe';

function wireAlertForm(): void {
  const form = document.getElementById('alert-form') as HTMLFormElement | null;
  const status = document.getElementById('alert-status') as HTMLParagraphElement | null;
  if (!form || !status) return;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const submit = form.querySelector('button') as HTMLButtonElement;
    const email = (form.elements.namedItem('email') as HTMLInputElement).value;
    const terms = (form.elements.namedItem('terms') as HTMLInputElement).value;
    submit.disabled = true;
    status.textContent = 'Subscribing…';
    void fetch(ALERTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, terms }),
    })
      .then(async (response) => {
        const body = (await response.json()) as { ok?: boolean; message?: string; error?: string };
        if (response.ok && body.ok) {
          form.hidden = true;
          status.textContent = body.message ?? 'Check your inbox to confirm.';
        } else {
          status.textContent = body.error ?? 'Something went wrong. Try again shortly.';
        }
      })
      .catch(() => {
        status.textContent = 'The alert service could not be reached. Try again shortly.';
      })
      .finally(() => {
        submit.disabled = false;
      });
  });
}

void loadHeadlines();
void loadRansomwatch();
void loadDirectory();
wireAlertForm();
