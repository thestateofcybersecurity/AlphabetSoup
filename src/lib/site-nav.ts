/**
 * Single source of truth for the site navigation.
 *
 * The nav used to be hand-copied into 23 HTML files plus a separate
 * implementation in scripts/generate-pages.ts, so it drifted: 12 pages were
 * missing the About link, two were missing AI Security, one marked the wrong
 * link as the current page, and adding a link broke a hard-coded E2E count.
 *
 * Both renderers below read the same lists. The two call sites keep their own
 * class names on purpose: hand-written pages use `.site-nav` (styled in
 * style.css) and generated pages use `.gnav` (styled by the inline PAGE_CSS
 * those pages ship). Only the link *content* is shared, which is what drifted.
 */

export interface NavLink {
  /** Path relative to the site root, '' for the homepage. */
  path: string;
  label: string;
}

/**
 * Internal sections, in nav order.
 *
 * The four framework sections sit behind a single Frameworks entry rather than
 * one link each. Four separate links took 448px of a nav with 1237px to spend,
 * and adding ISO as a fifteenth link pushed it onto a second row. Consolidating
 * frees far more than that and leaves room for the next framework, which the
 * per-framework approach did not.
 */
export const NAV_LINKS: NavLink[] = [
  { path: '', label: 'Acronyms' },
  { path: 'frameworks/', label: 'Frameworks' },
  { path: 'quiz/', label: 'Quiz' },
  { path: 'assess/', label: 'Assess' },
  { path: 'roadmap/', label: 'Roadmap' },
  { path: 'tools/', label: 'Tools' },
  { path: 'blog/', label: 'Blog' },
  { path: 'careers/', label: 'Careers' },
  { path: 'about/', label: 'About' },
];

export interface ExternalNavLink {
  href: string;
  label: string;
  title?: string;
  className?: string;
}

/**
 * Sibling properties, rendered after the internal links.
 *
 * Labels are kept short with a descriptive `title`, the pattern BIA already
 * used. Adding Tools and Careers pushed the nav to 14 links, and the two long
 * labels ("MITRE ATT&CK", "Play Cyberdle") were enough to wrap it onto a second
 * row at 1280px. Measured: full labels 84px, shortened 47px, matching the
 * single-row height the site shipped before. The generated pages already
 * labelled this link "Cyberdle", so this also makes the two navs agree.
 */
export const EXTERNAL_LINKS: ExternalNavLink[] = [
  {
    href: 'https://mitre.cybersecurityalphabetsoup.com/',
    label: 'MITRE',
    title: 'MITRE ATT&amp;CK explained',
  },
  {
    href: 'https://bia.cybersecurityalphabetsoup.com/',
    label: 'BIA',
    title: 'Business Impact Assessment',
  },
  {
    href: 'https://thestateofcybersecurity.github.io/cyberdle/',
    label: 'Cyberdle',
    title: 'Play Cyberdle, the daily acronym game',
    className: 'nav-play',
  },
];

/** Total link count, so tests assert against the source instead of a literal. */
export const NAV_LINK_COUNT = NAV_LINKS.length + EXTERNAL_LINKS.length;

function externalAnchor(link: ExternalNavLink, playClass: string): string {
  const cls = link.className ? ` class="${link.className === 'nav-play' ? playClass : link.className}"` : '';
  const title = link.title ? ` title="${link.title}"` : '';
  return `<a${cls} href="${link.href}"${title} rel="noopener" target="_blank">${link.label}</a>`;
}

/**
 * Nav for the hand-written pages (class `.site-nav`).
 * `prefix` is the relative path back to the site root ('' at the root,
 * '../' one level down). `currentPath` marks the active link.
 */
export function renderSiteNav(prefix: string, currentPath: string): string {
  const internal = NAV_LINKS.map((link) => {
    // Exactly this page, versus somewhere inside this section. Both get the
    // current marker, so /frameworks/iso/ highlights Frameworks rather than
    // leaving the reader with no sense of place. The home link has an empty
    // path and would prefix-match everything, so it is matched exactly.
    const isExact = link.path === currentPath;
    const isWithin = link.path !== '' && !isExact && currentPath.startsWith(link.path);
    const isCurrent = isExact || isWithin;
    // Only the exact page self-links. A section link on a sub-page has to keep
    // its real destination, or Frameworks on /frameworks/iso/ would point back
    // at /frameworks/iso/ instead of the hub.
    const href = isExact ? './' : `${prefix}${link.path}`;
    return `<a href="${href}"${isCurrent ? ' aria-current="page"' : ''}>${link.label}</a>`;
  });
  const external = EXTERNAL_LINKS.map((l) => externalAnchor(l, 'nav-play'));
  // /nav.js centers the current link when the nav is a scrollable row on
  // narrow screens. External rather than inline: the site ships no inline
  // scripts (see e2e/csp.spec.ts), and deferred so the nav exists when it runs.
  return `<nav class="site-nav" aria-label="Site">\n      ${[...internal, ...external].join('\n      ')}\n    </nav><script src="/nav.js" defer></script>`;
}

/** Nav for generator-produced pages (class `.gnav`). */
export function renderGeneratedNav(prefix: string): string {
  const internal = NAV_LINKS.map((l) => `<a href="${prefix}${l.path}">${l.label}</a>`);
  const external = EXTERNAL_LINKS.map((l) => externalAnchor(l, 'play-link'));
  return `<nav class="gnav" aria-label="Site">${[...internal, ...external].join('')}</nav>`;
}
