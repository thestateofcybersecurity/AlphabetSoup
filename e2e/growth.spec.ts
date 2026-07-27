import { expect, test } from '@playwright/test';

/**
 * The static pages carry most of the organic search traffic, and until now they
 * mostly dead-ended: 25 of 646 definition pages offered anywhere to go next, and
 * there was no way to see a whole category or subscribe to the blog.
 */

test('the RSS feed is served and well formed', async ({ page }) => {
  const res = await page.request.get('/feed.xml');
  expect(res.status()).toBe(200);
  const xml = await res.text();
  expect(xml).toContain('<rss version="2.0"');
  expect(xml).toContain('<channel>');
  // Self-reference, which readers use to re-find a moved feed.
  expect(xml).toContain('rel="self"');
  const items = xml.match(/<item>/g) ?? [];
  expect(items.length).toBeGreaterThan(0);
  // Every item needs a stable identity and a date.
  expect((xml.match(/<guid isPermaLink="true">/g) ?? []).length).toBe(items.length);
  expect((xml.match(/<pubDate>/g) ?? []).length).toBe(items.length);
});

test('feed items point at real post pages', async ({ page }) => {
  const xml = await (await page.request.get('/feed.xml')).text();
  const links = [...xml.matchAll(/<link>([^<]+\/blog\/[^<]+)<\/link>/g)].map((m) => m[1]);
  expect(links.length).toBeGreaterThan(0);
  for (const link of links.slice(0, 3)) {
    const path = new URL(link).pathname;
    expect((await page.request.get(path)).status()).toBe(200);
  }
});

test('the feed is discoverable from the blog and from definition pages', async ({ page }) => {
  for (const path of ['/blog/', '/definitions/siem.html']) {
    await page.goto(path);
    const alt = page.locator('link[rel="alternate"][type="application/rss+xml"]');
    await expect(alt).toHaveCount(1);
    await expect(alt).toHaveAttribute('href', /\/feed\.xml$/);
  }
  // And a human-visible way to subscribe.
  await page.goto('/blog/');
  await expect(page.getByRole('link', { name: /subscribe by rss/i })).toBeVisible();
});

test('every category has a hub page listing its acronyms', async ({ page }) => {
  const categories = [
    'certifications', 'protocols', 'attacks', 'crypto', 'governance',
    'cloud', 'operations', 'identity', 'appsec', 'network',
  ];
  for (const category of categories) {
    const res = await page.request.get(`/categories/${category}.html`);
    expect(res.status(), category).toBe(200);
  }
  await page.goto('/categories/cloud.html');
  await expect(page.locator('h1')).toHaveText('Cloud');
  const items = page.locator('.cat-list li');
  expect(await items.count()).toBeGreaterThan(5);
  // Entries link to their definition pages.
  await expect(items.first().locator('a')).toHaveAttribute('href', /^\.\.\/definitions\/.+\.html$/);
});

test('a category hub only lists acronyms from that category', async ({ page }) => {
  await page.goto('/categories/certifications.html');
  const hrefs = await page.locator('.cat-list li a').evaluateAll((els) =>
    els.map((e) => e.getAttribute('href') ?? ''),
  );
  expect(hrefs.length).toBeGreaterThan(5);
  // Spot-check a few of the linked pages actually carry the category chip.
  for (const href of hrefs.slice(0, 4)) {
    const path = `/categories/${href}`.replace('/categories/../', '/');
    const html = await (await page.request.get(path)).text();
    expect(html, path).toContain('<span class="chip cat">certifications</span>');
  }
});

test('category hubs cross-link to each other', async ({ page }) => {
  await page.goto('/categories/attacks.html');
  const others = page.locator('.related a');
  // Nine siblings, and not a self-link.
  await expect(others).toHaveCount(9);
  const hrefs = await others.evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  expect(hrefs).not.toContain('./attacks.html');
});

test('definition pages link to their category hub', async ({ page }) => {
  await page.goto('/definitions/siem.html');
  const link = page.getByRole('link', { name: /All operations acronyms/i });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/categories\/operations\.html$/);
  await expect(page.locator('h1')).toHaveText('Operations');
});

test('definition pages surface the quiz decks that test the term', async ({ page }) => {
  // CVSS is asked about in several decks, none of which were hand-mapped.
  await page.goto('/definitions/cvss.html');
  const deeper = page.locator('h2', { hasText: 'Go deeper' });
  await expect(deeper).toHaveCount(1);
  const quizLinks = page.locator('a[href*="quiz/?deck="]');
  expect(await quizLinks.count()).toBeGreaterThan(0);
  await expect(quizLinks.first()).toContainText(/Tested on the .+ quiz/);
});

test('a derived quiz link actually opens that deck', async ({ page }) => {
  await page.goto('/definitions/cvss.html');
  const link = page.locator('a[href*="quiz/?deck="]').first();
  const href = (await link.getAttribute('href')) ?? '';
  const slug = new URLSearchParams(href.split('?')[1]).get('deck');
  expect(slug, 'the link should name a deck').toBeTruthy();

  await link.click();
  await expect(page).toHaveURL(new RegExp(`/quiz/\\?deck=${slug}$`));
  // A ?deck= link starts that round immediately, so the player replaces the
  // deck grid rather than the grid staying on screen.
  await expect(page.locator('#player')).toBeVisible();
  await expect(page.locator('.quiz-question').first()).not.toBeEmpty();
  await expect(page.locator('#deck-grid')).toBeHidden();
});

test('the sitemap includes the category hubs', async ({ page }) => {
  const xml = await (await page.request.get('/sitemap.xml')).text();
  for (const category of ['cloud', 'attacks', 'identity']) {
    expect(xml).toContain(`/categories/${category}.html`);
  }
});

test('category hubs are indexable and not orphaned', async ({ page }) => {
  await page.goto('/categories/crypto.html');
  // Canonical, description, and structured data, same as every other page type.
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    /\/categories\/crypto\.html$/,
  );
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /crypto/i);
  const ld = await page.locator('script[type="application/ld+json"]').innerText();
  expect(JSON.parse(ld)['@type']).toBe('CollectionPage');
});
