import { expect, test } from '@playwright/test';

/**
 * Budget guards for the homepage split.
 *
 * The homepage used to ship all 545 full acronym records, 103 KB gzipped of
 * mostly prose, to render a search box and 60 collapsed rows. It now ships a
 * 10 KB index and fetches the prose behind first paint.
 *
 * These assert on what the browser actually requests, not on what the build log
 * claims, so a future import that quietly pulls the prose back into the entry
 * chunk fails here.
 */

/**
 * The assets the entry HTML tells the browser to load up front: classic
 * scripts, module preloads, and stylesheets. This is the set that gates
 * rendering. The prose chunk is fetched by a dynamic import instead, so it
 * overlaps with rendering rather than gating it, and is deliberately not here.
 */
async function blockingAssets(page: import('@playwright/test').Page, url: string) {
  await page.goto(url);
  return page.evaluate(() => {
    const sel = 'script[src], link[rel="modulepreload"], link[rel="stylesheet"]';
    return [...document.querySelectorAll(sel)]
      .map((n) => n.getAttribute('src') ?? n.getAttribute('href') ?? '')
      .filter((h) => h && !h.startsWith('http'));
  });
}

test('the homepage does not block rendering on the acronym prose', async ({ page }) => {
  const assets = await blockingAssets(page, '/');
  expect(assets.filter((a) => /acronyms-.*\.js$/.test(a))).toEqual([]);
});

test('the homepage critical path stays under budget', async ({ page }) => {
  const assets = await blockingAssets(page, '/');
  let total = 0;
  for (const asset of assets) {
    const res = await page.request.get(new URL(asset, page.url()).href);
    total += (await res.body()).length;
  }
  // Uncompressed. This was ~378 KB before the split; the budget leaves room to
  // grow while still failing loudly if the dataset gets pulled back in.
  expect(total).toBeLessThan(150_000);
});

test('opening an entry fetches the prose and renders it', async ({ page }) => {
  await page.goto('/');
  const first = page.locator('details.entry').first();
  // Collapsed rows carry no prose at all until opened.
  expect((await first.locator('.entry-body').innerText()).trim()).toBe('');

  await first.locator('summary').click();
  await expect(first.locator('.entry-body p').first()).not.toBeEmpty();
  await expect(first.locator('.entry-links a.permalink')).toHaveCount(1);
});

test('reopening an entry does not duplicate its body', async ({ page }) => {
  await page.goto('/');
  const first = page.locator('details.entry').first();
  await first.locator('summary').click();
  await expect(first.locator('.entry-body p').first()).not.toBeEmpty();
  await first.locator('summary').click();
  await first.locator('summary').click();
  await expect(first.locator('.entry-links a.permalink')).toHaveCount(1);
});

test('soup of the day paints immediately and fills in its blurb', async ({ page }) => {
  await page.goto('/');
  // Acronym and expansion come from the index, so they are there on first paint.
  await expect(page.locator('#sotd .sotd-key')).not.toBeEmpty();
  await expect(page.locator('#sotd .sotd-expansion')).not.toBeEmpty();
  // The blurb arrives with the deferred chunk.
  await expect(page.locator('#sotd .sotd-blurb')).not.toBeEmpty();
});

test('search works on the index before the prose arrives', async ({ page }) => {
  // Block the prose chunk entirely: key and expansion search must still work.
  await page.route(/acronyms-.*\.js$/, (route) => route.abort());
  await page.goto('/');
  await page.fill('#search', 'siem');
  await expect(page.locator('details.entry').first()).toContainText('SIEM');
  await expect(page.locator('#result-meta')).toContainText('match');
});

test('the prose chunk is fetched without being a blocking asset', async ({ page }) => {
  // Arm the wait before navigating: the dynamic import fires during the entry
  // script's execution, so the response can land before goto() resolves.
  const prose = page.waitForResponse(/acronyms-.*\.js$/);
  await page.goto('/');
  const res = await prose;
  expect(res.status()).toBe(200);
  // Same chunk, still absent from the markup that gates rendering.
  const assets = await blockingAssets(page, '/');
  expect(assets.filter((a) => /acronyms-.*\.js$/.test(a))).toEqual([]);
});

test('every page uses the self-hosted fonts with above-the-fold preloads', async ({ page }) => {
  for (const path of ['/', '/quiz/', '/definitions/siem.html', '/blog/']) {
    await page.goto(path);
    // Exactly one same-origin font stylesheet, and no third-party font hosts.
    const sheets = await page.evaluate(() =>
      [...document.querySelectorAll('link[rel="stylesheet"]')]
        .map((l) => new URL(l.getAttribute('href') ?? '', document.baseURI))
        .filter((u) => u.pathname.endsWith('/fonts.css')),
    );
    expect(sheets, `on ${path}`).toHaveLength(1);
    const external = await page.evaluate(() =>
      [...document.querySelectorAll('link[href]')]
        .map((l) => new URL(l.getAttribute('href') ?? '', document.baseURI).host)
        // Exact host comparison, not substring: evil.com/fonts.googleapis.com
        // must not satisfy (or, here, violate) the assertion.
        .filter((h) => h === 'fonts.googleapis.com' || h === 'fonts.gstatic.com'),
    );
    expect(external, `on ${path}`).toEqual([]);
    // The two above-the-fold faces are preloaded so they beat CSS parsing.
    const preloads = await page.evaluate(() =>
      [...document.querySelectorAll('link[rel="preload"][as="font"]')].map(
        (l) => new URL(l.getAttribute('href') ?? '', document.baseURI).pathname,
      ),
    );
    expect(preloads, `on ${path}`).toContain('/fonts/fraunces-latin-opsz-normal.woff2');
    expect(preloads, `on ${path}`).toContain('/fonts/ibm-plex-sans-latin-wght-normal.woff2');
    // And the variable Fraunces file actually loads.
    const loaded = await page.evaluate(async () => {
      await document.fonts.load('700 40px Fraunces');
      return document.fonts.check('700 40px Fraunces');
    });
    expect(loaded, `on ${path}`).toBe(true);
  }
});
