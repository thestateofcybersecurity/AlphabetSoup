import { expect, test } from '@playwright/test';

/**
 * The Ransomware Watch page renders a feed fetched from GitHub Pages at
 * runtime. E2E must not depend on that remote feed being up (or on its
 * contents), so both the success and failure paths are exercised by
 * intercepting the request.
 */

const FEED_URL = 'https://thestateofcybersecurity.github.io/ransomwareRSS/feed.json';

const FIXTURE = {
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

test('renders claims from the feed, with hostile names inert', async ({ page }) => {
  await page.route(FEED_URL, (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(FIXTURE) }),
  );
  await page.goto('/news/');

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
});

test('falls back to the raw RSS link when the feed is down', async ({ page }) => {
  await page.route(FEED_URL, (route) => route.fulfill({ status: 503, body: 'nope' }));
  await page.goto('/news/');

  const status = page.locator('#news-status');
  await expect(status).toContainText('could not be loaded');
  await expect(status.locator('a')).toHaveAttribute(
    'href',
    'https://thestateofcybersecurity.github.io/ransomwareRSS/feed.xml',
  );
});

test('advertises the RSS feed in the head and marks News current in the nav', async ({ page }) => {
  await page.route(FEED_URL, (route) => route.fulfill({ status: 503, body: '' }));
  await page.goto('/news/');

  await expect(page.locator('link[rel="alternate"][type="application/rss+xml"]')).toHaveAttribute(
    'href',
    'https://thestateofcybersecurity.github.io/ransomwareRSS/feed.xml',
  );
  await expect(page.locator('.site-nav [aria-current="page"]')).toHaveText('News');
});
