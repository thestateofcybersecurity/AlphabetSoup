import { expect, test } from '@playwright/test';

/**
 * Analytics is Cloudflare Web Analytics, enabled on the zone rather than built
 * into these pages. Cloudflare injects the beacon into proxied HTML responses,
 * which covers every page type including the ~900 generated pages that ship no
 * other JavaScript, and it covers them without the repo carrying a snippet.
 *
 * That injection cannot be observed from the dev server or the built output,
 * so there is nothing here asserting the beacon's presence; the checks below
 * cover what this repo still controls. Note that a plain curl will not see the
 * beacon on production either: Cloudflare only injects for browser-like
 * requests, which is why it is easy to conclude wrongly that it is missing.
 */

test('the static definition pages ship no JavaScript of their own', async ({ page }) => {
  await page.goto('/definitions/siem.html');
  const scripts = await page.evaluate(() =>
    [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src') ?? ''),
  );
  expect(scripts).toEqual([]);
});

test('redirect stubs meta-refresh rather than running a script', async ({ page }) => {
  // A legacy alias that meta-refreshes to its canonical page. Counting these
  // would double-count the destination.
  const res = await page.request.get('/definitions/acas.html');
  const html = await res.text();
  expect(html).toContain('http-equiv="refresh"');
  expect(html).not.toContain('<script');
});

test('privacy policy discloses the analytics provider', async ({ page }) => {
  await page.goto('/privacy/');
  const body = await page.locator('body').innerText();
  expect(body).toContain('Cloudflare Web Analytics');
  // Plausible was removed; the policy must not still name it.
  expect(body).not.toContain('Plausible');
  // The older claim must stay gone; it is false.
  expect(body).not.toContain('no analytics scripts');
});
