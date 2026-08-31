import { expect, test } from '@playwright/test';

/**
 * Guards the one part of analytics that lives outside this repo.
 *
 * Analytics is Cloudflare Web Analytics with Automatic setup enabled on the
 * zone. Cloudflare injects the beacon into proxied HTML at the edge, so it
 * appears in no build output and no other test can see it.
 *
 * What this check can and cannot observe changed on 2026-08-31. Cloudflare
 * skips beacon injection for traffic it bot-scores, and GitHub Actions
 * runners now score as bots: the same pages verified in a real browser carry
 * exactly one beacon with the expected token while headless Chromium from CI
 * receives none. Absence from CI therefore no longer proves the dashboard
 * setting is off, and this spec no longer fails on it. What CI still proves
 * deterministically:
 *
 *   1. every page is served through Cloudflare (cf-ray present), because a
 *      site that leaves the proxy loses injection for everyone;
 *   2. the page source contains no manual beacon snippet, because a manual
 *      snippet double-counts every view whenever edge injection also runs
 *      (that regression is why the manual snippet was removed);
 *   3. when injection does happen, the token is the expected site.
 *
 * The strong guarantee (pageviews are actually being recorded) needs the Web
 * Analytics API instead of a page load; the workflow runs that check when a
 * `CF_WEB_ANALYTICS_TOKEN` secret is configured. Until then, confirming the
 * dashboard toggle stays a periodic human glance at the Web Analytics page.
 */

/**
 * The apex site's beacon token. One entry with Automatic setup covers www and
 * every subdomain, so this same token is expected everywhere in the zone.
 * If the Web Analytics site is ever deleted and recreated, this changes.
 */
const EXPECTED_TOKEN = 'c9c9ccea7fe64f859f2a114e59ec0197';

const BEACON_HOST = 'static.cloudflareinsights.com';

/**
 * One page per generator code path. The definition and framework pages ship no
 * JavaScript of their own and carry the bulk of organic search traffic, so
 * losing coverage there matters most and is least likely to be noticed by eye.
 */
const PAGES = [
  { path: '/', what: 'hand-written page' },
  { path: '/definitions/siem.html', what: 'generated definition page' },
  { path: '/frameworks/cis/1-1.html', what: 'generated framework page' },
];

for (const { path, what } of PAGES) {
  test(`the ${what} stays measurable by Cloudflare Web Analytics`, async ({ page }) => {
    // 1. Still proxied: injection is impossible for everyone otherwise.
    const response = await page.request.get(path);
    expect(response.headers()['cf-ray'], `${path}: no cf-ray header, the site is no longer proxied through Cloudflare and edge injection cannot happen`).toBeTruthy();

    // 2. No manual snippet in the source: it double-counts alongside edge
    //    injection. Source-level, so bot-scoring cannot hide it.
    const html = await response.text();
    expect(html.includes(BEACON_HOST), `${path}: a manual beacon snippet is in the page source; it double-counts whenever edge injection also runs`).toBe(false);

    // 3. Rendered check: CI traffic is bot-scored and usually gets no
    //    injection, so absence does not fail. Presence with the wrong token
    //    does: that means views are landing in someone else's dashboard.
    await page.goto(path, { waitUntil: 'load' });
    const tokens = await page.evaluate(() =>
      [...document.querySelectorAll('script[src*="cloudflareinsights"]')].map((s) => {
        try {
          return JSON.parse(s.getAttribute('data-cf-beacon') || '{}').token ?? null;
        } catch {
          return null;
        }
      }),
    );
    expect(tokens.length, `${path}: more than one beacon injected; something re-added a manual snippet`).toBeLessThanOrEqual(1);
    if (tokens.length === 1) {
      expect(tokens[0], `${path}: unexpected beacon token`).toBe(EXPECTED_TOKEN);
    } else {
      test.info().annotations.push({
        type: 'note',
        description: `${path}: no beacon for this CI request (bot-scored traffic); verified injected for real browsers 2026-08-31`,
      });
    }
  });
}
