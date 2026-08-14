// On narrow screens the site nav is a scrollable row and the current link can
// sit off-screen (Tools is the tenth link). Center it on load so mobile
// visitors keep their sense of place. Instant, not smooth, so the page does
// not appear to move on its own. Kept as a same-origin external script: the
// site ships no inline scripts (see e2e/csp.spec.ts).
if (matchMedia('(max-width: 640px)').matches) {
  const current = document.querySelector('.site-nav [aria-current]');
  if (current) current.scrollIntoView({ inline: 'center', block: 'nearest' });
}
