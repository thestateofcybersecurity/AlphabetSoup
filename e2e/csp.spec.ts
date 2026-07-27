import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { INLINE_SCRIPT_SHA256 } from '../src/lib/analytics';

/**
 * The recorded hash of the inline analytics script has to match what actually
 * ships, because a CSP built from it lives outside this repo and a mismatch
 * blocks analytics on every page rather than failing loudly.
 *
 * It was wrong once already: hand-computed against the snippet as authored
 * rather than as built. This recomputes it from the served HTML.
 */

/** SHA-256 of a string, in the base64 form CSP expects. */
function cspHash(body: string): string {
  return `sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}`;
}

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

test('the recorded hash matches the inline script as built', async ({ page }) => {
  const scripts = await executableInlineScripts(page, '/');
  expect(scripts).toHaveLength(1);
  expect(cspHash(scripts[0])).toBe(INLINE_SCRIPT_SHA256);
});

test('every page type ships exactly that one executable inline script', async ({ page }) => {
  for (const path of PAGES) {
    const scripts = await executableInlineScripts(page, path);
    expect(scripts, `${path} should have one inline script`).toHaveLength(1);
    expect(cspHash(scripts[0]), path).toBe(INLINE_SCRIPT_SHA256);
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

test('the only external script origin is plausible', async ({ page }) => {
  const origins = new Set<string>();
  for (const path of PAGES) {
    const html = await (await page.request.get(path)).text();
    for (const m of html.matchAll(/<script[^>]+src="(https?:\/\/[^"]+)"/g)) {
      origins.add(new URL(m[1]).origin);
    }
  }
  // Anything new here has to be added to script-src before it is deployed.
  expect([...origins].sort()).toEqual(['https://plausible.io']);
});

test('external styles and fonts come only from Google Fonts', async ({ page }) => {
  const styleOrigins = new Set<string>();
  for (const path of PAGES) {
    const html = await (await page.request.get(path)).text();
    for (const m of html.matchAll(/<link[^>]+href="(https?:\/\/[^"]+)"[^>]*rel="stylesheet"/g)) {
      styleOrigins.add(new URL(m[1]).origin);
    }
    for (const m of html.matchAll(/<link[^>]+rel="stylesheet"[^>]*href="(https?:\/\/[^"]+)"/g)) {
      styleOrigins.add(new URL(m[1]).origin);
    }
  }
  expect([...styleOrigins].sort()).toEqual(['https://fonts.googleapis.com']);
});
