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
import { TURNSTILE_SITE_KEY } from './lib/config';

const HEADLINE_LIMIT = 40;
const CLAMP = 10;

/**
 * Tabs keep all three sections in the DOM (crawlable, hash-addressable) but
 * show one at a time; the lists themselves render clamped to 10 rows with a
 * show-all button. Both exist purely to cut scroll: the page previously
 * stacked ~90 rows in one column.
 */
const TAB_IDS = ['headlines', 'ransomware', 'feeds'] as const;
type TabId = (typeof TAB_IDS)[number];

function tabOf(id: TabId): HTMLButtonElement {
  return document.getElementById(`tab-${id}`) as HTMLButtonElement;
}

function selectTab(id: TabId): void {
  for (const other of TAB_IDS) {
    const selected = other === id;
    const tab = tabOf(other);
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    (document.getElementById(`panel-${other}`) as HTMLElement).hidden = !selected;
  }
}

function wireTabs(): void {
  const list = document.querySelector('.news-tabs') as HTMLElement;
  for (const id of TAB_IDS) {
    tabOf(id).addEventListener('click', () => {
      selectTab(id);
      history.replaceState(null, '', `#${id}`);
    });
  }
  // Roving focus per the WAI-ARIA tabs pattern: arrows move and select.
  list.addEventListener('keydown', (event) => {
    const current = TAB_IDS.findIndex((id) => tabOf(id) === document.activeElement);
    if (current === -1) return;
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (current + 1) % TAB_IDS.length;
    else if (event.key === 'ArrowLeft') next = (current + TAB_IDS.length - 1) % TAB_IDS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TAB_IDS.length - 1;
    if (next === null) return;
    event.preventDefault();
    selectTab(TAB_IDS[next]);
    tabOf(TAB_IDS[next]).focus();
  });

  // Deep links (#ransomware) select their tab on load and on hash-only
  // navigations, which also makes back/forward restore the tab.
  const applyHash = (): void => {
    const fromHash = location.hash.replace('#', '');
    if ((TAB_IDS as readonly string[]).includes(fromHash)) selectTab(fromHash as TabId);
  };
  window.addEventListener('hashchange', applyHash);
  applyHash();

  // The action pill jumps to the alert form inside the ransomware tab.
  document.getElementById('watch-org-pill')?.addEventListener('click', () => {
    selectTab('ransomware');
    history.replaceState(null, '', '#ransomware');
    const email = document.getElementById('alert-email') as HTMLInputElement | null;
    email?.scrollIntoView({ block: 'center' });
    email?.focus({ preventScroll: true });
  });
}

/** Reveal the show-all button when a clamped list has more rows than the clamp. */
function wireClamp(listId: string, buttonId: string, noun: string, total: number): void {
  const list = document.getElementById(listId) as HTMLOListElement;
  const button = document.getElementById(buttonId) as HTMLButtonElement;
  if (total <= CLAMP) return;
  button.hidden = false;
  button.textContent = `Show all ${total} ${noun}`;
  button.addEventListener('click', () => {
    list.classList.remove('clamped');
    button.hidden = true;
  });
}

/**
 * All three payloads live on GitHub Pages (which sends
 * `access-control-allow-origin: *`) rather than in the build, so the page
 * shows live data without a site deploy. Each section loads and fails
 * independently: ad blockers, offline readers, or a Pages outage land in a
 * per-section fallback that still points at the raw feed.
 */

function buildValidatedUrl(baseUrl: string): string {
  try {
    // Minimal path validation
    if (baseUrl.includes('/../') || /\/%2e%2e\//i.test(baseUrl)) {
      throw new Error('Invalid path');
    }
    
    const url = new URL(baseUrl);
    
    // Protocol check
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('Invalid protocol');
    }
    
    // Domain validation - allow GitHub Pages where the feeds are hosted
    const allowedDomains = ['thestateofcybersecurity.github.io'];
    if (!allowedDomains.includes(url.hostname)) {
      throw new Error('Invalid host');
    }
    
    return url.href;
  } catch {
    throw new Error('Invalid URL');
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const validatedUrl = buildValidatedUrl(url);
  const response = await fetch(validatedUrl);
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
    status.textContent = `${feed.items.length} stories from the past week`;
    wireClamp('hl-list', 'hl-more', 'headlines', shown.length);
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
    wireClamp('news-list', 'rw-more', 'claims', feed.items.length);
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
const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

declare global {
  interface Window {
    turnstile?: {
      render(
        container: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          'expired-callback'?: () => void;
          'error-callback'?: () => void;
        },
      ): string;
      reset(widgetId?: string): void;
    };
  }
}

/**
 * Optional bot check on the subscribe form, opt-in through TURNSTILE_SITE_KEY.
 * With an empty key this is a no-op: nothing loads, nothing renders, and the
 * request body is exactly what it was, so the site stays CSP-clean. With a
 * key, the Turnstile script is loaded on demand, the widget renders inside
 * the form, and the token is sent as `turnstileToken` for the Worker to
 * verify. Tokens are single-use, so the widget is reset after every attempt.
 */
function mountTurnstile(form: HTMLFormElement, onToken: (token: string | null) => void): { reset: () => void } {
  if (!TURNSTILE_SITE_KEY) return { reset: () => undefined };
  const slot = document.createElement('div');
  slot.className = 'alert-turnstile';
  form.querySelector('button')?.before(slot);
  let widgetId: string | undefined;
  const script = document.createElement('script');
  script.src = TURNSTILE_SCRIPT;
  script.async = true;
  script.addEventListener('load', () => {
    widgetId = window.turnstile?.render(slot, {
      sitekey: TURNSTILE_SITE_KEY,
      callback: (token) => onToken(token),
      'expired-callback': () => onToken(null),
      'error-callback': () => onToken(null),
    });
  });
  document.head.append(script);
  return {
    reset: () => {
      onToken(null);
      window.turnstile?.reset(widgetId);
    },
  };
}

function wireAlertForm(): void {
  const form = document.getElementById('alert-form') as HTMLFormElement | null;
  const status = document.getElementById('alert-status') as HTMLParagraphElement | null;
  if (!form || !status) return;
  let turnstileToken: string | null = null;
  const turnstile = mountTurnstile(form, (token) => {
    turnstileToken = token;
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const submit = form.querySelector('button') as HTMLButtonElement;
    const email = (form.elements.namedItem('email') as HTMLInputElement).value;
    const terms = (form.elements.namedItem('terms') as HTMLInputElement).value;
    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      status.textContent = 'Complete the verification check first.';
      return;
    }
    submit.disabled = true;
    status.textContent = 'Subscribing…';
    void fetch(ALERTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, terms, ...(turnstileToken ? { turnstileToken } : {}) }),
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
        turnstile.reset();
      });
  });
}

wireTabs();
void loadHeadlines();
void loadRansomwatch();
void loadDirectory();
wireAlertForm();
