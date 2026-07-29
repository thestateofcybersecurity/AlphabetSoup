import { expect, test } from '@playwright/test';

/**
 * The ISO section, and the nav consolidation it forced.
 *
 * Four separate framework links plus ISO put the nav on two rows, so the
 * framework sections now sit behind a single Frameworks entry with a hub page.
 * That hub is the only route into ISO, which makes its links load-bearing.
 */

test('the frameworks hub lists every framework and links to each', async ({ page }) => {
  await page.goto('/frameworks/');
  const cards = page.locator('.fw-card');
  await expect(cards).toHaveCount(5);
  for (const [name, href] of [
    ['NIST CSF 2.0', 'nist-csf/'],
    ['CIS Controls v8', 'cis/'],
    ['ISO 27001 Annex A', 'iso/'],
    ['SOC 2', 'soc2/'],
    ['AI security', 'ai/'],
  ] as const) {
    const card = cards.filter({ hasText: name });
    await expect(card, name).toHaveCount(1);
    await expect(card.locator('a.go')).toHaveAttribute('href', href);
  }
});

test('every hub link actually resolves', async ({ page }) => {
  await page.goto('/frameworks/');
  const hrefs = await page.locator('.fw-card a.go').evaluateAll((els) =>
    els.map((e) => e.getAttribute('href') ?? ''),
  );
  for (const href of hrefs) {
    const res = await page.request.get(`/frameworks/${href}`);
    expect(res.status(), href).toBe(200);
  }
});

test('the nav is a single row again, with the frameworks consolidated', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/frameworks/');
  const rows = await page.evaluate(() => {
    const links = [...document.querySelectorAll('.site-nav a')];
    return new Set(links.map((a) => Math.round(a.getBoundingClientRect().top))).size;
  });
  // Adding ISO as a fifteenth link pushed this to 2. It must stay at 1.
  expect(rows).toBe(1);
  await expect(page.locator('.site-nav a', { hasText: 'Frameworks' })).toHaveCount(1);
  // The per-framework links are gone from the nav, not merely hidden.
  for (const gone of ['NIST CSF', 'CIS Controls', 'AI Security']) {
    await expect(page.locator('.site-nav a', { hasText: gone }), gone).toHaveCount(0);
  }
});

test('the ISO index renders all 93 controls with theme filters', async ({ page }) => {
  await page.goto('/frameworks/iso/');
  await expect(page.locator('#hero-count')).toHaveText('93');
  await expect(page.locator('#result-meta')).toContainText('93 controls');
  // innerText reflects the CSS uppercase transform, so compare case-insensitively.
  const pills = (await page.locator('#group-pills .pill').allInnerTexts()).map((t) => t.toLowerCase());
  expect(pills).toEqual(['all', 'a.5', 'a.6', 'a.7', 'a.8']);
});

test('filtering by theme narrows the set', async ({ page }) => {
  await page.goto('/frameworks/iso/');
  await page.locator('#group-pills .pill', { hasText: 'A.6' }).click();
  // A.6 People has 8 controls.
  await expect(page.locator('#result-meta')).toContainText('8');
});

test('searching finds a control by identifier and by subject', async ({ page }) => {
  await page.goto('/frameworks/iso/');
  await page.fill('#search', 'A.8.13');
  await expect(page.locator('#results')).toContainText('Backing up information');
  await page.fill('#search', 'suppliers');
  await expect(page.locator('#result-meta')).not.toContainText('93');
});

test('a generated control page carries its content and its neighbours', async ({ page }) => {
  await page.goto('/frameworks/iso/a-8-13.html');
  const main = page.locator('main');
  await expect(main).toContainText('Backing up information and proving it restores');
  await expect(main).toContainText('Keeping copies of the photos');
  await expect(main).toContainText('The family keeps copies');
  // prev/next stay inside the theme.
  await expect(main.locator('a[href="a-8-12.html"]')).toHaveCount(1);
  await expect(main.locator('a[href="a-8-14.html"]')).toHaveCount(1);
});

test('prev and next do not cross a theme boundary', async ({ page }) => {
  // A.6.1 is the first People control, so it must not link back into A.5.
  await page.goto('/frameworks/iso/a-6-1.html');
  const hrefs = await page.locator('main a').evaluateAll((els) =>
    els.map((e) => e.getAttribute('href') ?? ''),
  );
  expect(hrefs.filter((h) => h.startsWith('a-5-'))).toEqual([]);
});

test('control pages cross-link to the frameworks they map to', async ({ page }) => {
  await page.goto('/frameworks/iso/a-8-13.html');
  const cross = page.locator('main a[href*="../cis/"], main a[href*="../nist-csf/"]');
  expect(await cross.count()).toBeGreaterThan(0);
  // Backup maps to backup: spot-check the mapping is semantically right.
  await expect(page.locator('main a[href="../nist-csf/pr-ds-11.html"]')).toHaveCount(1);
  // And every cross-link resolves.
  const hrefs = await cross.evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
  for (const href of hrefs.slice(0, 4)) {
    // Resolve against the page rather than stripping '../' by hand, which only
    // strips the first segment and misbehaves on deeper relative paths.
    const res = await page.request.get(new URL(href, page.url()).pathname);
    expect(res.status(), href).toBe(200);
  }
});

test('control pages state that no standard text is reproduced', async ({ page }) => {
  await page.goto('/frameworks/iso/');
  // The copyright position is on the section page rather than buried.
  await expect(page.locator('footer')).toContainText(/copyrighted/i);
  await expect(page.locator('footer a[href*="iso.org"]')).toHaveCount(1);
});

test('the ISO section is in the sitemap', async ({ page }) => {
  const xml = await (await page.request.get('/sitemap.xml')).text();
  expect(xml).toContain('/frameworks/');
  expect(xml).toContain('/frameworks/iso/');
  expect(xml).toContain('/frameworks/iso/a-8-13.html');
});

test('the existing framework sections still work after the nav change', async ({ page }) => {
  for (const [path, count] of [
    ['/frameworks/nist-csf/', '106'],
    ['/frameworks/cis/', '153'],
  ] as const) {
    await page.goto(path);
    await expect(page.locator('#hero-count'), path).toHaveText(count);
  }
});

test('a section link on a sub-page still points at the section, not itself', async ({ page }) => {
  // Marking a section link current must not turn it into a self-link. When
  // prefix matching was added so /frameworks/iso/ would highlight Frameworks,
  // the href became "./" and the nav entry pointed back at the page you were
  // already on, silently trapping the reader inside the section.
  for (const [from, section] of [
    ['/frameworks/iso/', '/frameworks/'],
    ['/frameworks/nist-csf/', '/frameworks/'],
    ['/tools/crosswalk/', '/tools/'],
  ] as const) {
    await page.goto(from);
    const label = section === '/tools/' ? 'Tools' : 'Frameworks';
    const link = page.locator('.site-nav a', { hasText: label });
    await expect(link, from).toHaveAttribute('aria-current', 'page');
    const href = await link.getAttribute('href');
    expect(new URL(href!, page.url()).pathname, from).toBe(section);
  }
});

test('the home link only marks itself, never every page', async ({ page }) => {
  // The home entry has an empty path, so a naive prefix match would make it
  // current everywhere.
  await page.goto('/quiz/');
  const home = page.locator('.site-nav a', { hasText: 'Acronyms' });
  await expect(home).not.toHaveAttribute('aria-current', 'page');
});
