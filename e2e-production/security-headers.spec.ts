import { expect, test } from '@playwright/test';

/**
 * Guards the security headers that live outside this repository.
 *
 * GitHub Pages cannot set response headers, so they come from a Cloudflare
 * Transform Rule and the zone's HSTS setting, documented in
 * docs/cloudflare-headers.md. Nothing in the build can observe them, and a
 * dashboard edit could silently drop them, so this checks the live site.
 *
 * Skipped unless PROD_HEADER_CHECK=1: the rule does not exist until the
 * owner creates it, and a scheduled canary that fails on a known gap gets
 * muted. Turn it on in verify-analytics.yml once the rule is live. During
 * the report-only week either CSP header form is accepted.
 */

const ENABLED = process.env.PROD_HEADER_CHECK === '1';

/** Directives the policy must carry, from docs/cloudflare-headers.md. */
const CSP_DIRECTIVES: Record<string, string[]> = {
  'default-src': ["'self'"],
  'script-src': ["'self'", 'https://static.cloudflareinsights.com', 'https://challenges.cloudflare.com'],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'https:'],
  'font-src': ["'self'"],
  'connect-src': [
    "'self'",
    'https://thestateofcybersecurity.github.io',
    'https://alerts.cybersecurityalphabetsoup.com',
    'https://cloudflareinsights.com',
  ],
  'frame-src': ['https://challenges.cloudflare.com'],
  'frame-ancestors': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'", 'https://alerts.cybersecurityalphabetsoup.com'],
  'object-src': ["'none'"],
};

/** Values that would undo the point of the policy if they crept in. */
const FORBIDDEN_IN_SCRIPT_SRC = ["'unsafe-inline'", "'unsafe-eval'", '*', 'http:', 'https:', 'data:'];

const PAGES = ['/', '/news/', '/tools/ai-threat-model/', '/my/'];

function parseCsp(value: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const part of value.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) out[name.toLowerCase()] = sources;
  }
  return out;
}

test.describe('security headers set at the Cloudflare edge', () => {
  test.skip(!ENABLED, 'Set PROD_HEADER_CHECK=1 once the Transform Rule in docs/cloudflare-headers.md exists');

  for (const path of PAGES) {
    test(`${path} carries the documented headers`, async ({ request }) => {
      const response = await request.get(path);
      expect(response.status(), `${path} should be served`).toBe(200);
      const headers = response.headers();
      expect(headers['cf-ray'], `${path}: not proxied through Cloudflare, so no edge headers are possible`).toBeTruthy();

      const enforced = headers['content-security-policy'];
      const reportOnly = headers['content-security-policy-report-only'];
      const csp = enforced ?? reportOnly;
      expect(csp, `${path}: no Content-Security-Policy or report-only header`).toBeTruthy();
      if (!enforced) {
        test.info().annotations.push({ type: 'note', description: `${path}: CSP is still report-only; enforce it after the clean week` });
      }
      const policy = parseCsp(csp!);
      for (const [directive, sources] of Object.entries(CSP_DIRECTIVES)) {
        expect(policy[directive], `${path}: CSP is missing ${directive}`).toBeDefined();
        for (const source of sources) {
          expect(policy[directive], `${path}: ${directive} should include ${source}`).toContain(source);
        }
      }
      for (const bad of FORBIDDEN_IN_SCRIPT_SRC) {
        expect(policy['script-src'], `${path}: script-src must not include ${bad}`).not.toContain(bad);
      }
      expect(policy['upgrade-insecure-requests'], `${path}: upgrade-insecure-requests missing`).toBeDefined();

      expect(headers['x-content-type-options'], `${path}`).toBe('nosniff');
      expect(headers['referrer-policy'], `${path}`).toBe('strict-origin-when-cross-origin');
      expect(headers['x-frame-options']?.toUpperCase(), `${path}`).toBe('DENY');
      const permissions = headers['permissions-policy'] ?? '';
      for (const feature of ['camera=()', 'microphone=()', 'geolocation=()', 'payment=()']) {
        expect(permissions, `${path}: Permissions-Policy should include ${feature}`).toContain(feature);
      }

      const hsts = headers['strict-transport-security'] ?? '';
      const maxAge = Number(/max-age=(\d+)/.exec(hsts)?.[1] ?? 0);
      expect(maxAge, `${path}: HSTS max-age should be at least one year (got "${hsts}")`).toBeGreaterThanOrEqual(31536000);
      expect(hsts.toLowerCase(), `${path}: HSTS should include subdomains`).toContain('includesubdomains');
    });
  }
});
