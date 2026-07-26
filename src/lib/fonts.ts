/**
 * The webfont request, in one place.
 *
 * This URL was pasted into 23 hand-written pages plus two templates in the page
 * generator, and had already drifted into three different variants: some pages
 * loaded Fraunces 700 and IBM Plex Sans 500, others did not, so headings were
 * rendered by the browser's synthetic bolding on those pages instead.
 *
 * The weights are requested as ranges rather than as discrete values. Asking for
 * `wght@500;700;900` makes Google Fonts serve three separate static instances of
 * Fraunces at ~66 KB each; asking for `wght@500..900` serves the variable font
 * once. Measured over the latin subset: 426 KB across 10 files becomes 205 KB
 * across 6, on every page of the site.
 *
 * IBM Plex Mono deliberately keeps discrete weights. Google does not publish a
 * variable version of it, and a range request returns no latin @font-face at
 * all, which would silently drop the monospace face sitewide.
 */
export const FONT_CSS_URL =
  'https://fonts.googleapis.com/css2' +
  '?family=Fraunces:ital,opsz,wght@0,9..144,500..900;1,9..144,500' +
  '&family=IBM+Plex+Mono:wght@500;600' +
  '&family=IBM+Plex+Sans:ital,wght@0,400..600;1,400' +
  '&display=swap';

/** The preconnect + stylesheet links, for templates that build their own head. */
export function renderFontLinks(selfClosing = false): string {
  const end = selfClosing ? ' />' : '>';
  return (
    `<link rel="preconnect" href="https://fonts.googleapis.com"${end}\n` +
    `  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin${end}\n` +
    `  <link href="${FONT_CSS_URL}" rel="stylesheet"${end}`
  );
}

/**
 * Rewrite any Google Fonts stylesheet link in a page to the canonical one.
 *
 * Normalising rather than requiring a marker means a page that is copied from an
 * older template, or hand-edited back to discrete weights, is corrected at build
 * time instead of quietly regressing the font payload.
 */
export function withCanonicalFonts(html: string): string {
  return html.replace(
    /<link[^>]*href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]*"[^>]*>/g,
    `<link href="${FONT_CSS_URL}" rel="stylesheet" />`,
  );
}
