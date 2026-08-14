/**
 * The webfont links, in one place.
 *
 * The site used to load fonts from fonts.googleapis.com with a render-blocking
 * stylesheet on every page: a DNS + TLS + CSS round trip to a third-party
 * origin before first styled paint, followed by font files from a second
 * origin. The fonts are now self-hosted latin-subset woff2 files (variable
 * where the family has one) under /fonts/, declared in /fonts.css, served from
 * the same origin and cached across the whole site.
 *
 * The two faces that render above the fold everywhere (Fraunces for the
 * headline, Plex Sans for body text) are preloaded so they start downloading
 * before the CSS is parsed. Font preloads require `crossorigin` even on the
 * same origin, because font fetches are CORS-mode requests.
 *
 * This module is the single source: hand-written pages get these links via the
 * fonts Vite plugin (which also rewrites any stale Google Fonts markup), and
 * generated pages get them from renderFontLinks in scripts/generate-pages.ts.
 */
export const FONT_CSS_URL = '/fonts.css';

const PRELOADS = [
  '/fonts/fraunces-latin-opsz-normal.woff2',
  '/fonts/ibm-plex-sans-latin-wght-normal.woff2',
];

/** The preload + stylesheet links, for templates that build their own head. */
export function renderFontLinks(selfClosing = false): string {
  const end = selfClosing ? ' />' : '>';
  return (
    PRELOADS.map(
      (href) => `<link rel="preload" href="${href}" as="font" type="font/woff2" crossorigin${end}\n  `,
    ).join('') + `<link href="${FONT_CSS_URL}" rel="stylesheet"${end}`
  );
}

/**
 * Rewrite any webfont markup in a page to the canonical self-hosted links.
 *
 * Normalising rather than requiring a marker means a page that is copied from
 * an older template, still pointing at Google Fonts (stylesheet or
 * preconnects), is corrected at build time instead of quietly shipping a
 * third-party request.
 */
export function withCanonicalFonts(html: string): string {
  return (
    html
      // Old third-party preconnects serve no purpose once fonts are same-origin.
      .replace(/[ \t]*<link[^>]*rel="preconnect"[^>]*href="https:\/\/fonts\.(googleapis|gstatic)\.com[^"]*"[^>]*>\n?/g, '')
      .replace(/[ \t]*<link[^>]*href="https:\/\/fonts\.(googleapis|gstatic)\.com[^"]*"[^>]*rel="preconnect"[^>]*>\n?/g, '')
      // A Google Fonts stylesheet link becomes the canonical self-hosted links.
      .replace(
        /<link[^>]*href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]*"[^>]*>/g,
        renderFontLinks(true),
      )
      // Already-canonical pages: leave the stylesheet link alone.
      .replace(/(<link[^>]*href=")\/fonts\.css("[^>]*>)/g, `$1${FONT_CSS_URL}$2`)
  );
}
