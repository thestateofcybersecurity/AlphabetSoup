/**
 * Build-time site configuration. Everything here ships in the bundle, so it
 * is public by definition; secrets never belong in this file.
 */

/**
 * Cloudflare Turnstile site key for the /news/ subscribe form. Site keys are
 * public; the matching secret lives only on the alerts Worker
 * (TURNSTILE_SECRET_KEY), which verifies every token server-side.
 *
 * The widget "Alphabet Soup and TSOC forms" is shared with
 * thestateofcybersecurity.us and allows both domains. The Turnstile script
 * is loaded only when a visitor first touches the form, so pages stay free
 * of third-party requests for everyone else.
 *
 * Set this to '' to switch the widget off: nothing loads, nothing renders,
 * and the request carries no token. Only do that after removing the Worker
 * secret, or every subscription is refused.
 *
 * The CSP must allow https://challenges.cloudflare.com in script-src and
 * frame-src (see docs/cloudflare-headers.md).
 */
export const TURNSTILE_SITE_KEY = '0x4AAAAAAGTgelu-VKr5BSIY';
