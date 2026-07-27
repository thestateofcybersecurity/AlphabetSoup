/**
 * Plausible analytics snippet, in one place.
 *
 * This is a raw <head> snippet rather than the npm tracker on purpose: the site
 * is static, and ~900 of its pages (the 545 definition pages, the framework
 * pages, the blog) ship no JavaScript at all. A bundled tracker would only ever
 * run on the 23 hand-written pages and would miss the pages that get most of
 * the organic search traffic. A plain script tag covers every page and keeps the
 * project at zero production dependencies.
 *
 * Consumed by:
 *  - the analytics Vite plugin, for the hand-written pages
 *  - scripts/generate-pages.ts, for every generated page
 * so the snippet can never drift between the two the way the nav did.
 *
 * Plausible is cookie-free and collects no personal data. /privacy/ discloses it.
 * To exclude your own visits, run in the console:
 *   localStorage.plausible_ignore = 'true'
 *
 * CSP note: this is the site's only inline <script> that executes. Its hash is
 * exported below and asserted against the built HTML by e2e/csp.spec.ts, because
 * the value here was previously hand-computed and wrong: it hashed the snippet
 * as authored rather than as shipped, so a policy built from it would have
 * blocked analytics on every page.
 *
 * Note that a hash alone is not a complete policy for this site. Cloudflare's
 * JavaScript Detections feature injects its own inline script carrying a
 * per-request ray id, so its hash differs on every response and cannot be
 * allowlisted. See the CSP section of docs, or turn that feature off.
 */
export const ANALYTICS_SNIPPET = `  <!-- Privacy-friendly analytics by Plausible -->
  <script async src="https://plausible.io/js/pa-UZmn_OAyYtbL_nYn1CTQv.js"></script>
  <script>
    window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};
    plausible.init()
  </script>
`;

/**
 * SHA-256 of the inline script body above, as it appears in the built HTML.
 *
 * Kept as a literal rather than computed at runtime, since the value is needed
 * by a CSP header configured outside this repo. e2e/csp.spec.ts recomputes it
 * from the built pages so it cannot silently go stale again.
 */
export const INLINE_SCRIPT_SHA256 = 'sha256-XVj80uUSzt3JWa6FTzTaafmEiRYXOb5edzL/N5F/s6U=';

/** Insert the snippet immediately before </head>. */
export function withAnalytics(html: string): string {
  if (html.includes('plausible.init()')) return html;
  return html.replace('</head>', `${ANALYTICS_SNIPPET}</head>`);
}
