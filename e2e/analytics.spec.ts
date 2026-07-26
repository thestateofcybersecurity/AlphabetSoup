import { expect, test } from '@playwright/test';

/**
 * Analytics must be present on every real page type, including the ~900
 * generated pages that ship no other JavaScript. Those pages are the bulk of
 * organic search traffic, and a bundled tracker would never have run on them.
 *
 * Redirect stubs are deliberately excluded: they meta-refresh away instantly,
 * so counting them would double-count the destination.
 */

const TRACKED = [
  '/',
  '/tools/',
  '/tools/crosswalk/',
  '/quiz/',
  '/assess/',
  '/definitions/siem.html',
  '/frameworks/cis/1-1.html',
  '/blog/',
];

for (const path of TRACKED) {
  test(`analytics snippet is present on ${path}`, async ({ page }) => {
    await page.goto(path);
    const tag = page.locator('script[src="https://plausible.io/js/pa-UZmn_OAyYtbL_nYn1CTQv.js"]');
    await expect(tag).toHaveCount(1);
    await expect(tag).toHaveAttribute('async', '');
    // The queue shim must be defined so events fire before the remote script lands.
    expect(await page.evaluate(() => typeof (window as unknown as { plausible?: unknown }).plausible)).toBe('function');
  });
}

test('the static definition pages carry analytics despite shipping no other JS', async ({ page }) => {
  await page.goto('/definitions/siem.html');
  const otherScripts = await page.evaluate(() =>
    [...document.querySelectorAll('script[src]')]
      .map((s) => s.getAttribute('src') ?? '')
      .filter((s) => !s.includes('plausible')),
  );
  expect(otherScripts).toEqual([]);
  await expect(page.locator('script[src*="plausible.io"]')).toHaveCount(1);
});

test('redirect stubs are not tracked', async ({ page }) => {
  // A legacy alias that meta-refreshes to its canonical page.
  const res = await page.request.get('/definitions/acas.html');
  const html = await res.text();
  expect(html).toContain('http-equiv="refresh"');
  expect(html).not.toContain('plausible');
});

test('privacy policy discloses analytics and the opt-out', async ({ page }) => {
  await page.goto('/privacy/');
  const body = await page.locator('body').innerText();
  expect(body).toContain('Plausible');
  expect(body).toContain('plausible_ignore');
  // The old claim must be gone; it is now false.
  expect(body).not.toContain('no analytics scripts');
});
