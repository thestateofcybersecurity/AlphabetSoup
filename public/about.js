// Verification links for the credential pills on /about/. Paste a Credly (or
// issuer) URL next to a credential and its pill becomes a link; leave it
// empty and the pill stays plain text. No other wiring needed.
//
// Kept as a same-origin external script, like /nav.js: the site ships no
// executable inline script, so a Content-Security-Policy with script-src
// 'self' (docs/cloudflare-headers.md) does not need 'unsafe-inline' or a hash.
// This block used to sit inline at the bottom of about/index.html, where an
// enforced policy would have silently blocked it.
const CRED_LINKS = {
  'CISSP': '',
  'CISSP-ISSMP': '',
  'CISM': '',
  'CCSK': 'https://www.credly.com/badges/24988584-4c83-4885-8fe9-fe53fe22efb1',
  'CCZT': 'https://www.credly.com/badges/ff4f4f9b-d775-4ca8-aa68-d4fee83d4a7f',
  'CEH': '',
  'CHFI': '',
};

for (const pill of document.querySelectorAll('.cred-pill[data-cred]')) {
  const url = CRED_LINKS[pill.getAttribute('data-cred')];
  if (url) {
    pill.setAttribute('href', url);
    pill.setAttribute('target', '_blank');
  }
}
