import { defineConfig } from '@playwright/test';

/**
 * Runs `e2e-production/` against the live site instead of the preview server.
 *
 * Separate from playwright.config.ts because these checks assert things the
 * build cannot produce: Cloudflare injects the analytics beacon at the edge,
 * so it exists only on production responses. Keeping them in their own
 * directory stops the normal suite from running them against localhost, where
 * they would always fail.
 *
 * Retries are on because a scheduled canary that cries wolf gets muted, and a
 * muted canary is worse than none.
 */
export default defineConfig({
  testDir: 'e2e-production',
  timeout: 60_000,
  retries: 2,
  // Serial: this is a handful of checks against someone else's infrastructure.
  workers: 1,
  use: {
    baseURL: 'https://www.cybersecurityalphabetsoup.com',
  },
});
