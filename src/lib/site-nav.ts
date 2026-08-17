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
 *
 * Sections with `children` render as dropdowns: the parent link still goes to
 * the section hub, and the menu jumps straight to a specific page, so reaching
 * one of the twelve tools no longer means hub, scroll, find. On `.site-nav`
 * the menu opens on hover, keyboard focus, or a toggle button wired by
 * /nav.js; on `.gnav` (generated pages ship no JS) it is hover and focus only.
 * On narrow screens both navs stay flat scrollable rows: the parent link
 * lands on the hub, which lists everything anyway.
 */

export interface NavLink {
  /** Path relative to the site root, '' for the homepage. */
  path: string;
  label: string;
  /** Sub-pages rendered as a dropdown menu under the parent link. */
  children?: NavLink[];
}

/**
 * Internal sections, in nav order.
 *
 * The four framework sections sit behind a single Frameworks entry rather than
 * one link each. Four separate links took 448px of a nav with 1237px to spend,
 * and adding ISO as a fifteenth link pushed it onto a second row. Consolidating
 * frees far more than that and leaves room for the next framework, which the
 * per-framework approach did not. The dropdowns give the consolidated entries
 * their direct links back without spending any row width.
 *
 * Tools children follow the scorecard's demand order (the same order the hub
 * page lists them), with the two supporting tools at the end.
 */
export const NAV_LINKS: NavLink[] = [
  { path: '', label: 'Acronyms' },
  {
    path: 'frameworks/',
    label: 'Frameworks',
    children: [
      { path: 'frameworks/nist-csf/', label: 'NIST CSF' },
      { path: 'frameworks/cis/', label: 'CIS Controls' },
      { path: 'frameworks/ai/', label: 'AI Security' },
      { path: 'frameworks/iso/', label: 'ISO 27001' },
      { path: 'frameworks/soc2/', label: 'SOC 2' },
    ],
  },
  { path: 'quiz/', label: 'Quiz' },
  { path: 'assess/', label: 'Assess' },
  { path: 'roadmap/', label: 'Roadmap' },
  {
    path: 'tools/',
    label: 'Tools',
    children: [
      { path: 'tools/crosswalk/', label: 'Control Crosswalk' },
      { path: 'tools/ai-risk/', label: 'AI Risk Tiering' },
      { path: 'tools/cloud-baseline/', label: 'Cloud Baseline' },
      { path: 'tools/runbook/', label: 'Runbook and Tabletop' },
      { path: 'tools/board-metrics/', label: 'Board Metrics' },
      { path: 'tools/reg-mapper/', label: 'Regulatory Mapper' },
      { path: 'tools/trust-package/', label: 'Trust Package' },
      { path: 'tools/automation-roi/', label: 'Automation ROI' },
      { path: 'tools/ssdlc/', label: 'Secure SDLC' },
      { path: 'tools/skills-matrix/', label: 'Skills Matrix' },
      { path: 'tools/policy-generator/', label: 'Policy Generator' },
      { path: 'tools/ai-cloud-controls/', label: 'AI Cloud Controls' },
    ],
  },
  { path: 'news/', label: 'News' },
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

/** Top-level link count (dropdown children excluded); tests assert against this. */
export const NAV_LINK_COUNT = NAV_LINKS.length + EXTERNAL_LINKS.length;

/** Every anchor the nav renders, dropdown children included. */
export const NAV_TOTAL_LINK_COUNT =
  NAV_LINK_COUNT + NAV_LINKS.reduce((sum, link) => sum + (link.children?.length ?? 0), 0);

function externalAnchor(link: ExternalNavLink, playClass: string): string {
  const cls = link.className ? ` class="${link.className === 'nav-play' ? playClass : link.className}"` : '';
  const title = link.title ? ` title="${link.title}"` : '';
  return `<a${cls} href="${link.href}"${title} rel="noopener" target="_blank">${link.label}</a>`;
}

/** The chevron on dropdown toggles; inherits currentColor. */
const CHEVRON =
  '<svg viewBox="0 0 10 6" width="10" height="6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M1 1l4 4 4-4"/></svg>';

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
    const anchor = `<a${link.children ? ' class="nav-parent"' : ''} href="${href}"${isCurrent ? ' aria-current="page"' : ''}>${link.label}</a>`;
    if (!link.children) return anchor;
    // Dropdown: the toggle button is wired by /nav.js (aria-expanded, Escape,
    // outside click); hover and focus-within open it in CSS alone, so the menu
    // works before the script runs and for keyboard users without it.
    const menu = link.children
      .map((child) => `<a href="${child.path === currentPath ? './' : `${prefix}${child.path}`}">${child.label}</a>`)
      .join('\n          ');
    return (
      `<div class="nav-item">\n        ${anchor}` +
      `<button type="button" class="nav-toggle" aria-expanded="false" aria-label="Open the ${link.label} menu">${CHEVRON}</button>\n` +
      `        <div class="nav-menu" aria-label="${link.label} pages">\n          ${menu}\n        </div>\n      </div>`
    );
  });
  const external = EXTERNAL_LINKS.map((l) => externalAnchor(l, 'nav-play'));
  // /nav.js also centers the current link when the nav is a scrollable row on
  // narrow screens. External rather than inline: the site ships no inline
  // scripts (see e2e/csp.spec.ts), and deferred so the nav exists when it runs.
  return `<nav class="site-nav" aria-label="Site">\n      ${[...internal, ...external].join('\n      ')}\n    </nav><script src="/nav.js" defer></script>`;
}

/** Nav for generator-produced pages (class `.gnav`). CSS-only dropdowns. */
export function renderGeneratedNav(prefix: string): string {
  const internal = NAV_LINKS.map((link) => {
    const anchor = (l: NavLink, caret = false): string =>
      `<a href="${prefix}${l.path}">${l.label}${caret ? ' <span class="gnav-caret" aria-hidden="true">&#9662;</span>' : ''}</a>`;
    if (!link.children) return anchor(link);
    const menu = link.children.map((child) => anchor(child)).join('');
    return `<div class="gnav-item">${anchor(link, true)}<div class="gnav-menu" aria-label="${link.label} pages">${menu}</div></div>`;
  });
  const external = EXTERNAL_LINKS.map((l) => externalAnchor(l, 'play-link'));
  return `<nav class="gnav" aria-label="Site">${[...internal, ...external].join('')}</nav>`;
}
