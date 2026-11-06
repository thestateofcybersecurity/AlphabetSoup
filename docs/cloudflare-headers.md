# Security headers for www.cybersecurityalphabetsoup.com

The site is static files on GitHub Pages behind Cloudflare. GitHub Pages cannot set response headers, so every security header comes from a Cloudflare **Modify Response Header** Transform Rule on the zone, and HSTS comes from the zone's SSL/TLS setting. Nothing in this repository can add or remove them; this file is the source of truth for what the rule should say, and `e2e-production/security-headers.spec.ts` asserts it on the live site once `PROD_HEADER_CHECK=1` is set.

Pentest reference: 2026-10-07, finding M2.

## What the site actually needs

Checked against the built `dist/` and the e2e CSP guard (`e2e/csp.spec.ts`) on 2026-10-08:

| Need | Source | Directive |
|---|---|---|
| Site scripts and styles | Vite bundles under `/assets/`, inline `<style>` blocks in generated pages, inline `style=""` on a few tool elements | `script-src 'self'`, `style-src 'self' 'unsafe-inline'` |
| Cloudflare Web Analytics beacon | Injected at the edge, loads `https://static.cloudflareinsights.com/beacon.min.js` and posts to `https://cloudflareinsights.com/cdn-cgi/rum` | `script-src https://static.cloudflareinsights.com`, `connect-src https://cloudflareinsights.com` |
| News feeds | `src/news-main.ts` fetches JSON from `https://thestateofcybersecurity.github.io/ransomwareRSS/` (host-allowlisted in `buildValidatedUrl`) | `connect-src https://thestateofcybersecurity.github.io` |
| Alert subscription | `src/news-main.ts` POSTs JSON to `https://alerts.cybersecurityalphabetsoup.com/subscribe` | `connect-src https://alerts.cybersecurityalphabetsoup.com`, `form-action https://alerts.cybersecurityalphabetsoup.com` |
| Turnstile (opt-in, off until `TURNSTILE_SITE_KEY` is set in `src/lib/config.ts`) | Loads `https://challenges.cloudflare.com/turnstile/v0/api.js` and renders an iframe from the same origin | `script-src https://challenges.cloudflare.com`, `frame-src https://challenges.cloudflare.com` |
| Fonts | Self-hosted woff2 under `/fonts/` (`e2e/csp.spec.ts` fails the build on any external font origin) | `font-src 'self'` |
| Images | Site images, OG images, favicons; `https:` left open for blog and tool content that references third-party images | `img-src 'self' data: https:` |
| Downloads | Exports use `URL.createObjectURL` on an `<a download>`; downloads are not governed by CSP, nothing needed | |
| Framing | Nothing on the site needs to be framed by anyone | `frame-ancestors 'none'` and `X-Frame-Options: DENY` |

The site ships no inline `<script>` and no inline event handlers (enforced by `e2e/csp.spec.ts`), so `script-src` needs neither `'unsafe-inline'` nor hashes. That is what makes finding M1's class of bug non-executable under this policy.

## Step 1: Transform Rule, report-only first

Cloudflare dashboard: the zone `cybersecurityalphabetsoup.com` > **Rules** > **Transform Rules** > **Modify Response Header** > **Create rule**.

- Rule name: `Security headers (www)`
- When incoming requests match: **Custom filter expression**

```
(http.host eq "www.cybersecurityalphabetsoup.com") or (http.host eq "cybersecurityalphabetsoup.com")
```

- Then: **Set static** for each header below. Add them one at a time; the dashboard shows one row per header.

Report-only policy (one line, no line breaks when pasted):

```
Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self' https://static.cloudflareinsights.com https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https://thestateofcybersecurity.github.io https://alerts.cybersecurityalphabetsoup.com https://cloudflareinsights.com; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://alerts.cybersecurityalphabetsoup.com; object-src 'none'; upgrade-insecure-requests
```

The other headers can be enforced from day one; none of them has a report-only mode and none can break the site:

```
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()
X-Frame-Options: DENY
```

Deploy the rule. Then, for about a week, open the site in a real browser with devtools open on the console and exercise: the homepage search, `/news/` (all three tabs and the subscribe form), `/tools/ai-threat-model/` including a CSV export and a report download, `/my/` backup export and restore, `/assess/` and `/roadmap/` import and export, and a blog post with images. A CSP violation shows as a `[Report Only]` console line naming the blocked URL and directive. Expected: none. If one appears, add that origin to the matching directive here first, then in the rule.

To collect reports without watching a console, add `report-to` with a Cloudflare or third-party reporting endpoint; the site does not run one, so the manual check above is the intended path.

## Step 2: enforce

After a clean week, edit the same rule: delete the `Content-Security-Policy-Report-Only` row and add the enforce form with the identical value.

```
Content-Security-Policy: default-src 'self'; script-src 'self' https://static.cloudflareinsights.com https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https://thestateofcybersecurity.github.io https://alerts.cybersecurityalphabetsoup.com https://cloudflareinsights.com; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://alerts.cybersecurityalphabetsoup.com; object-src 'none'; upgrade-insecure-requests
```

Keep `X-Frame-Options: DENY` alongside `frame-ancestors 'none'`: modern browsers use the CSP directive, older ones use the header, and they agree.

## Step 3: HSTS at the zone

Dashboard: **SSL/TLS** > **Edge Certificates** > **HTTP Strict Transport Security (HSTS)** > **Enable HSTS**.

- Max Age: 12 months (`max-age=31536000`)
- Apply HSTS policy to subdomains (includeSubDomains): **on**
- Preload: optional; leave off until the policy has been live for a month
- No-Sniff Header: on (harmless duplicate of the Transform Rule's `X-Content-Type-Options`)

`includeSubDomains` means every host under `cybersecurityalphabetsoup.com` is pinned to HTTPS in browsers that have visited the apex or `www`: `alerts`, `bia`, `lantern`, `mitre`, `cyberdle`, and the `cis`, `nistcsf`, `flashcards` redirect stubs. Every one of them was HTTPS-only during the 2026-10-07 test (HTTP 301s to HTTPS, TLS 1.2+), so this is safe to enable now. The one thing it rules out for the future is standing up a new subdomain on plain HTTP, which was never going to happen on this zone.

Expected header afterwards:

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

## Step 4: turn on the production check

Once the rule and HSTS are live:

```
PROD_HEADER_CHECK=1 npm run check:analytics
```

`check:analytics` runs the whole `e2e-production/` directory against the live site; the new `security-headers.spec.ts` is skipped unless `PROD_HEADER_CHECK=1` is set, so the scheduled `verify-analytics.yml` run keeps passing until then. After confirming it passes by hand, add `PROD_HEADER_CHECK: '1'` to the `env:` of the `npm run check:analytics` step in `.github/workflows/verify-analytics.yml` so the weekly run guards the Cloudflare setting the same way it guards the analytics beacon. The spec accepts either the report-only or the enforce header during the transition, and checks every directive above plus the four static headers and HSTS.

## Alternative: the Rulesets API

For a scripted setup, the same rule through the API (needs an API token with Zone > Transform Rules > Edit; `ZONE_ID` is on the zone overview page):

```
curl -X PUT "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets/phases/http_response_headers_transform/entrypoint" \
  -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
  --data @- <<'JSON'
{
  "rules": [
    {
      "description": "Security headers (www)",
      "expression": "(http.host eq \"www.cybersecurityalphabetsoup.com\") or (http.host eq \"cybersecurityalphabetsoup.com\")",
      "action": "rewrite",
      "action_parameters": {
        "headers": {
          "Content-Security-Policy-Report-Only": { "operation": "set", "value": "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https://thestateofcybersecurity.github.io https://alerts.cybersecurityalphabetsoup.com https://cloudflareinsights.com; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://alerts.cybersecurityalphabetsoup.com; object-src 'none'; upgrade-insecure-requests" },
          "X-Content-Type-Options": { "operation": "set", "value": "nosniff" },
          "Referrer-Policy": { "operation": "set", "value": "strict-origin-when-cross-origin" },
          "Permissions-Policy": { "operation": "set", "value": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
          "X-Frame-Options": { "operation": "set", "value": "DENY" }
        }
      }
    }
  ]
}
JSON
```

Note that `PUT` on the phase entrypoint replaces every rule in that phase; if the zone already has other response-header rules, use `POST .../rulesets/{ruleset_id}/rules` to add instead.

## When the policy has to change

- A new third-party script, font, or fetch target fails `e2e/csp.spec.ts` first (it allowlists nothing), which is the prompt to update this file and the rule together.
- Setting `TURNSTILE_SITE_KEY` needs no change: `challenges.cloudflare.com` is already in `script-src` and `frame-src`.
- `cyberdle.cybersecurityalphabetsoup.com` is also GitHub Pages behind this zone; the same rule with a `cyberdle` host match and that site's own origins applies there (its policy is not covered by this file).
