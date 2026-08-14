import { expect, test } from '@playwright/test';

/**
 * The site ships no executable inline scripts and no external scripts of its
 * own. Analytics is Cloudflare Web Analytics, whose beacon is injected at the
 * edge on proxied responses rather than built into these pages, so it is
 * deliberately absent from the built HTML these tests inspect.
 *
 * Keeping both counts at zero means a future policy needs neither a script
 * hash nor an origin allowlist, so anything added here is a conscious choice.
 */

/** The bodies of every inline <script> that the browser would execute. */
async function executableInlineScripts(page: import('@playwright/test').Page, path: string) {
  const html = await (await page.request.get(path)).text();
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)];
  return blocks
    // ld+json is a data block, not executed, and is not what the hash covers.
    .filter((m) => !/type\s*=\s*["']application\/ld\+json["']/.test(m[1]))
    .map((m) => m[2])
    .filter((body) => body.trim().length > 0);
}

const PAGES = [
  '/',
  '/quiz/',
  '/assess/',
  '/my/',
  '/tools/skills-matrix/',
  '/definitions/siem.html',
  '/frameworks/cis/1-1.html',
  '/categories/cloud.html',
  '/blog/',
];

test('every page type ships no executable inline script', async ({ page }) => {
  for (const path of PAGES) {
    const scripts = await executableInlineScripts(page, path);
    expect(scripts, `${path} should have no inline script`).toHaveLength(0);
  }
});

test('no page uses an inline event handler or a javascript: url', async ({ page }) => {
  // Either would need 'unsafe-hashes' or 'unsafe-inline' in a future policy.
  for (const path of PAGES) {
    const html = await (await page.request.get(path)).text();
    expect(html, `${path} inline handler`).not.toMatch(/\son(?:click|load|error|submit|change|input)\s*=/i);
    expect(html, `${path} javascript: url`).not.toContain('javascript:');
  }
});

test('the built pages reference no external script origin', async ({ page }) => {
  const origins = new Set<string>();
  for (const path of PAGES) {
    const html = await (await page.request.get(path)).text();
    for (const m of html.matchAll(/<script[^>]+src="(https?:\/\/[^"]+)"/g)) {
      origins.add(new URL(m[1]).origin);
    }
  }
  // Anything new here has to be added to script-src before it is deployed.
  expect([...origins].sort()).toEqual([]);
});

test('styles and fonts are fully self-hosted: no external origins', async ({ page }) => {
  const styleOrigins = new Set<string>();
  for (const path of PAGES) {
    const html = await (await page.request.get(path)).text();
    for (const m of html.matchAll(/<link[^>]+href="(https?:\/\/[^"]+)"[^>]*rel="stylesheet"/g)) {
      styleOrigins.add(new URL(m[1]).origin);
    }
    for (const m of html.matchAll(/<link[^>]+rel="stylesheet"[^>]*href="(https?:\/\/[^"]+)"/g)) {
      styleOrigins.add(new URL(m[1]).origin);
    }
    // The old third-party font setup also needed preconnects; none should survive.
    expect(html, `on ${path}`).not.toContain('fonts.googleapis.com');
    expect(html, `on ${path}`).not.toContain('fonts.gstatic.com');
  }
  expect([...styleOrigins].sort()).toEqual([]);
});
