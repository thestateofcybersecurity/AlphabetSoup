/**
 * Build-time site configuration. Everything here ships in the bundle, so it
 * is public by definition; secrets never belong in this file.
 */

/**
 * Cloudflare Turnstile site key for the /news/ subscribe form.
 *
 * Empty (the default) disables the widget entirely: no script is loaded, no
 * element is rendered, and the subscribe request body is unchanged. Set it
 * to the site key from the Cloudflare dashboard (Turnstile, widget for
 * www.cybersecurityalphabetsoup.com) once the alerts Worker has its matching
 * secret; the Worker verifies the token server-side when that secret is set.
 * When this is non-empty the CSP must allow https://challenges.cloudflare.com
 * in script-src and frame-src (see docs/cloudflare-headers.md).
 */
export const TURNSTILE_SITE_KEY = '';
