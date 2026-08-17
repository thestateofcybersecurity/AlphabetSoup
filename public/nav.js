// Site-nav behaviors. Kept as a same-origin external script: the site ships
// no inline scripts (see e2e/csp.spec.ts), and it is loaded deferred so the
// nav exists when it runs.

// 1. On narrow screens the nav is a scrollable row and the current link can
//    sit off-screen (Tools is deep in the row). Center it on load so mobile
//    visitors keep their sense of place. Instant, not smooth, so the page
//    does not appear to move on its own.
if (matchMedia('(max-width: 640px)').matches) {
  const current = document.querySelector('.site-nav [aria-current]');
  if (current) current.scrollIntoView({ inline: 'center', block: 'nearest' });
}

// 2. Dropdown toggles. Hover and focus-within already open the menus in pure
//    CSS; the button adds an explicit click/tap affordance with aria-expanded,
//    Escape to close (returning focus to the button), and outside-click close.
const items = document.querySelectorAll('.site-nav .nav-item');

function closeAll(except) {
  for (const item of items) {
    if (item === except) continue;
    item.removeAttribute('data-open');
    item.querySelector('.nav-toggle')?.setAttribute('aria-expanded', 'false');
  }
}

for (const item of items) {
  const toggle = item.querySelector('.nav-toggle');
  if (!toggle) continue;
  toggle.addEventListener('click', () => {
    const open = item.getAttribute('data-open') === 'true';
    closeAll(item);
    if (open) {
      item.removeAttribute('data-open');
    } else {
      item.setAttribute('data-open', 'true');
    }
    toggle.setAttribute('aria-expanded', String(!open));
  });
  item.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || item.getAttribute('data-open') !== 'true') return;
    item.removeAttribute('data-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.focus();
  });
}

document.addEventListener('click', (event) => {
  if (!(event.target instanceof Element) || !event.target.closest('.nav-item')) closeAll(null);
});
