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
 * CSP note: this is the only inline <script> on the site, so a future strict
 * policy does not need 'unsafe-inline'. Allowlist it by hash instead:
 *   script-src 'self' https://plausible.io 'sha256-CHqfv2WdfeI0ouOfFc5y657SDeBcVrPOADSf19C5ODo='
 *   connect-src https://plausible.io
 * Recompute the hash if the snippet below changes (it covers the inline body only).
 */
export const ANALYTICS_SNIPPET = `  <!-- Privacy-friendly analytics by Plausible -->
  <script async src="https://plausible.io/js/pa-UZmn_OAyYtbL_nYn1CTQv.js"></script>
  <script>
    window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};
    plausible.init()
  </script>
`;

/** Insert the snippet immediately before </head>. */
export function withAnalytics(html: string): string {
  if (html.includes('plausible.init()')) return html;
  return html.replace('</head>', `${ANALYTICS_SNIPPET}</head>`);
}
