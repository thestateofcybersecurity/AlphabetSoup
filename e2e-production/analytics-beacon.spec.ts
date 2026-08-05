import { expect, test } from '@playwright/test';

/**
 * Guards the one part of analytics that lives outside this repo.
 *
 * Analytics is Cloudflare Web Analytics with Automatic setup enabled on the
 * zone. Cloudflare injects the beacon into proxied HTML at the edge, so it
 * appears in no build output and no other test can see it. If the dashboard
 * setting is ever switched off, every other check in this repo still passes
 * and the site silently stops being measured. This is the only thing that
 * would notice.
 *
 * It therefore runs against production on a schedule rather than against the
 * preview server, and lives outside `e2e/` so the normal suite (which points
 * at localhost) does not pick it up.
 *
 * Note that a plain curl will never see the beacon: Cloudflare only injects
 * for browser-like requests. Headless Chromium does get it, which is what
 * makes this check possible. Do not "simplify" this into a curl in CI.
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
  test(`Cloudflare injects the analytics beacon into the ${what}`, async ({ page }) => {
    const beaconRequests: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes(BEACON_HOST)) beaconRequests.push(r.url());
    });

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

    // Zero means Automatic setup is off for the zone, or the site was deleted.
    expect(tokens, `${path}: no beacon injected, check Web Analytics is enabled on the zone`).toHaveLength(1);

    // A second beacon means something re-added a manual snippet to the source,
    // which double-counts every page view into a second dashboard.
    expect(tokens[0], `${path}: unexpected beacon token`).toBe(EXPECTED_TOKEN);

    // The tag being present is not enough; the script has to actually load.
    expect(beaconRequests.length, `${path}: beacon tag present but script never requested`).toBeGreaterThan(0);
  });
}
