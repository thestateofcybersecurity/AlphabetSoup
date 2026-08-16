import { expect, test } from '@playwright/test';

/**
 * The news page renders three payloads fetched from GitHub Pages at runtime:
 * aggregated headlines, the ransomware victim feed, and the feed directory.
 * E2E must not depend on those remote feeds being up (or on their contents),
 * so every request is intercepted; each section is exercised in both its
 * success and failure state.
 */

const BASE = 'https://thestateofcybersecurity.github.io/ransomwareRSS/';
const RANSOM_URL = `${BASE}feed.json`;
const AGG_URL = `${BASE}cybersecurity-feed.json`;
const DIR_URL = `${BASE}feeds.json`;

const RANSOM_FIXTURE = {
  updated: new Date().toISOString(),
  items: [
    {
      group: 'testgroup',
      victim: 'Fixture Industries',
      sector: 'Manufacturing',
      country: 'US',
      discovered: new Date(Date.now() - 3 * 3_600_000).toISOString(),
      link: 'https://www.ransomware.live/id/fixture',
    },
    {
      group: 'othergroup',
      victim: '<script>alert(1)</script>',
      sector: '',
      country: 'DE',
      discovered: new Date(Date.now() - 26 * 3_600_000).toISOString(),
      link: '',
    },
  ],
};

const AGG_FIXTURE = {
  updated: new Date().toISOString(),
  items: [
    {
      source: 'Fixture News',
      sourceUrl: 'https://news.example/',
      title: 'Fixture story about a breach',
      link: 'https://news.example/story',
      date: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      excerpt: 'A short excerpt.',
    },
  ],
};

const DIR_FIXTURE = {
  feeds: [
    {
      name: 'Fixture Feed',
      category: 'News',
      url: 'https://news.example/feed/',
      homepage: 'https://news.example/',
      blurb: 'A fixture feed.',
    },
  ],
};

async function stubAll(page: import('@playwright/test').Page): Promise<void> {
  await Promise.all([
    page.route(RANSOM_URL, (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(RANSOM_FIXTURE) }),
    ),
    page.route(AGG_URL, (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(AGG_FIXTURE) }),
    ),
    page.route(DIR_URL, (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(DIR_FIXTURE) }),
    ),
  ]);
}

test('renders headlines, claims, and the directory from the feeds', async ({ page }) => {
  await stubAll(page);
  await page.goto('/news/');

  await expect(page.locator('.hl-item .hl-title')).toHaveText('Fixture story about a breach');
  await expect(page.locator('#hl-status')).toContainText('1 of 1 stories');

  const items = page.locator('.news-item');
  await expect(items).toHaveCount(2);
  await expect(items.first()).toContainText('Fixture Industries');
  await expect(items.first().locator('a')).toHaveAttribute(
    'href',
    'https://www.ransomware.live/id/fixture',
  );
  // The hostile victim name renders as text, not markup.
  await expect(items.nth(1)).toContainText('<script>alert(1)</script>');
  await expect(page.locator('#news-status')).toContainText('2 recent claims');

  await expect(page.locator('.dir-item .dir-name')).toContainText('Fixture Feed');
  await expect(page.locator('#dir-status')).toContainText('1 feeds');
});

test('each section falls back independently when its feed is down', async ({ page }) => {
  for (const url of [RANSOM_URL, AGG_URL, DIR_URL]) {
    await page.route(url, (route) => route.fulfill({ status: 503, body: 'nope' }));
  }
  await page.goto('/news/');

  await expect(page.locator('#hl-status')).toContainText('could not be loaded');
  await expect(page.locator('#hl-status a')).toHaveAttribute(
    'href',
    `${BASE}cybersecurity-feed.xml`,
  );
  await expect(page.locator('#news-status')).toContainText('could not be loaded');
  await expect(page.locator('#news-status a')).toHaveAttribute('href', `${BASE}feed.xml`);
  await expect(page.locator('#dir-status a')).toHaveAttribute('href', `${BASE}feeds.opml`);
});

test('alert form submits to the Worker and reports both outcomes', async ({ page }) => {
  await stubAll(page);
  let sentBody: unknown = null;
  await page.route('https://alerts.cybersecurityalphabetsoup.com/subscribe', (route) => {
    sentBody = route.request().postDataJSON();
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, message: 'Check your inbox: confirm to start alerts.' }),
    });
  });
  await page.goto('/news/');

  await page.fill('#alert-email', 'user@example.com');
  await page.fill('#alert-terms', 'Example Corp, example.com');
  await page.click('.alert-submit');
  await expect(page.locator('#alert-status')).toContainText('Check your inbox');
  await expect(page.locator('#alert-form')).toBeHidden();
  expect(sentBody).toEqual({ email: 'user@example.com', terms: 'Example Corp, example.com' });

  // Error path: a fresh page whose Worker rejects the request.
  await page.route('https://alerts.cybersecurityalphabetsoup.com/subscribe', (route) =>
    route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'Too many requests.' }) }),
  );
  await page.goto('/news/');
  await page.fill('#alert-email', 'user@example.com');
  await page.fill('#alert-terms', 'Example Corp');
  await page.click('.alert-submit');
  await expect(page.locator('#alert-status')).toContainText('Too many requests');
  await expect(page.locator('#alert-form')).toBeVisible();
});

test('advertises both RSS feeds in the head and marks News current in the nav', async ({
  page,
}) => {
  for (const url of [RANSOM_URL, AGG_URL, DIR_URL]) {
    await page.route(url, (route) => route.fulfill({ status: 503, body: '' }));
  }
  await page.goto('/news/');

  const alternates = page.locator('link[rel="alternate"][type="application/rss+xml"]');
  await expect(alternates).toHaveCount(2);
  await expect(alternates.first()).toHaveAttribute('href', `${BASE}cybersecurity-feed.xml`);
  await expect(alternates.nth(1)).toHaveAttribute('href', `${BASE}feed.xml`);
  await expect(page.locator('.site-nav [aria-current="page"]')).toHaveText('News');
});
