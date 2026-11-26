import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
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
  '/blog/mitre-atlas-tactics-explained.html',
  // Carried an inline script until the 2026-11-22 pentest; its credential
  // links now come from /about.js.
  '/about/',
  '/tools/ai-threat-model/',
  // The subscribe form's Turnstile script is injected at runtime, and only
  // when a visitor first touches the form, so the built page stays clean.
  '/news/',
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

/**
 * The page list above samples one page per type. This walks the whole build
 * instead, so a single generated page cannot carry what the samples miss.
 * Pentest 2026-11-22: /about/ shipped an inline script the samples never
 * loaded, and a scheduled blog post could publish href="javascript:..." in
 * its "Go deeper" chips (finding N2) because only the blog index was sampled.
 */
function builtHtmlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...builtHtmlFiles(full));
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

test('no built page anywhere ships an inline script, an inline handler, or a script-scheme url', () => {
  const dist = path.resolve('dist');
  const files = builtHtmlFiles(dist);
  // Definitions, framework pages, blog posts, tools: well over a thousand files.
  expect(files.length).toBeGreaterThan(1000);

  const offenders: string[] = [];
  for (const file of files) {
    const html = readFileSync(file, 'utf8');
    const rel = path.relative(dist, file);
    for (const m of html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/type\s*=\s*["']application\/ld\+json["']/i.test(m[1])) continue;
      if (m[2].trim().length > 0) offenders.push(`${rel}: inline script`);
    }
    if (/<[a-z][^<>]*\son[a-z]+\s*=/i.test(html)) offenders.push(`${rel}: inline event handler`);
    if (/\b(?:href|src|action|formaction|xlink:href)\s*=\s*["']?\s*(?:javascript|vbscript|data):/i.test(html)) {
      offenders.push(`${rel}: script-scheme url`);
    }
  }
  expect(offenders).toEqual([]);
});

test('the credential pills on /about/ get their links from the external script', async ({ page }) => {
  await page.goto('/about/');
  const linked = page.locator('.cred-pill[data-cred="CCSK"]');
  await expect(linked).toHaveAttribute('href', /^https:\/\/www\.credly\.com\/badges\//);
  await expect(linked).toHaveAttribute('target', '_blank');
  await expect(linked).toHaveAttribute('rel', /noopener/);
  // A credential with no verification URL stays plain text.
  await expect(page.locator('.cred-pill[data-cred="CISSP"]')).not.toHaveAttribute('href', /.+/);
});
