import { expect, test } from '@playwright/test';

/**
 * The SOC 2 section.
 *
 * The scope here is deliberately partial: Security, Availability and
 * Confidentiality are enumerated, Processing Integrity and Privacy are not,
 * because the published sources disagree on how those are numbered. The
 * crosswalk still cites two PI identifiers, so the load-bearing test in this
 * file is the one proving those never become links to pages that do not exist.
 */

test('the SOC 2 index renders all 38 criteria with family filters', async ({ page }) => {
  await page.goto('/frameworks/soc2/');
  await expect(page.locator('#hero-count')).toHaveText('38');
  await expect(page.locator('#result-meta')).toContainText('38 criteria');
  const pills = (await page.locator('#group-pills .pill').allInnerTexts()).map((t) => t.toLowerCase());
  expect(pills).toEqual([
    'all', 'cc1', 'cc2', 'cc3', 'cc4', 'cc5', 'cc6', 'cc7', 'cc8', 'cc9', 'a1', 'c1',
  ]);
});

test('filtering by family narrows the set', async ({ page }) => {
  await page.goto('/frameworks/soc2/');
  await page.locator('#group-pills .pill', { hasText: 'CC6' }).click();
  // CC6 Logical and Physical Access has 8 criteria.
  await expect(page.locator('#result-meta')).toContainText('8');
});

test('the COSO derived families show the sizes the derivation predicts', async ({ page }) => {
  // CC1 through CC5 sum to the seventeen COSO principles. If a family size
  // drifts, the basis for the whole common criteria structure has gone.
  await page.goto('/frameworks/soc2/');
  for (const [family, count] of [
    ['CC1', '5'], ['CC2', '3'], ['CC3', '4'], ['CC4', '2'], ['CC5', '3'],
  ] as const) {
    await page.locator('#group-pills .pill', { hasText: family }).click();
    await expect(page.locator('#result-meta'), family).toContainText(count);
  }
});

test('searching finds a criterion by identifier and by subject', async ({ page }) => {
  await page.goto('/frameworks/soc2/');
  await page.fill('#search', 'CC6.4');
  await expect(page.locator('#results')).toContainText('Restricting physical access');
  await page.fill('#search', 'vendors');
  await expect(page.locator('#result-meta')).not.toContainText('38');
});

test('a generated criterion page carries its content and its neighbours', async ({ page }) => {
  await page.goto('/frameworks/soc2/cc6-4.html');
  const main = page.locator('main');
  await expect(main).toContainText('Restricting physical access to facilities and equipment');
  await expect(main).toContainText('The server cupboard has a lock');
  await expect(main.locator('a[href="cc6-3.html"]')).toHaveCount(1);
  await expect(main.locator('a[href="cc6-5.html"]')).toHaveCount(1);
});

test('prev and next do not cross a family boundary', async ({ page }) => {
  // CC7.1 is the first System Operations criterion, so it must not link back
  // into CC6, which is a different family with a different subject entirely.
  await page.goto('/frameworks/soc2/cc7-1.html');
  const hrefs = await page.locator('main a').evaluateAll((els) =>
    els.map((e) => e.getAttribute('href') ?? ''),
  );
  expect(hrefs.filter((h) => /^cc6-/.test(h))).toEqual([]);
});

test('criterion pages cross-link to CSF, CIS and ISO', async ({ page }) => {
  await page.goto('/frameworks/soc2/cc6-4.html');
  const cross = page.locator('main a[href*="../cis/"], main a[href*="../nist-csf/"], main a[href*="../iso/"]');
  expect(await cross.count()).toBeGreaterThan(0);
  // Physical access maps to physical controls: spot-check the mapping is
  // semantically right rather than merely present.
  await expect(page.locator('main a[href="../iso/a-7-1.html"]')).toHaveCount(1);
  const hrefs = await cross.evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
  for (const href of hrefs.slice(0, 5)) {
    const res = await page.request.get(new URL(href, page.url()).pathname);
    expect(res.status(), href).toBe(200);
  }
});

test('the unenumerated Processing Integrity criteria never become links', async ({ page }) => {
  // The crosswalk cites PI1.2 and PI1.3 under the appsec domain, alongside
  // CC8.1 and CC6.1.
  //
  // Be clear about what this does and does not prove. Related links currently
  // point only at CSF, CIS and ISO, so no SOC 2 identifier is emitted as an
  // href at all and removing the enumeration guard in relatedByCriterion does
  // NOT fail this test. That guard is covered where it can actually be
  // observed, by "derives nothing for a criterion it does not enumerate" in
  // tests/soc2.test.ts, which does fail when it is removed.
  //
  // This test is the cheap end-to-end backstop for the day someone adds
  // criterion-to-criterion links and the unenumerated ids become reachable.
  //
  // The check is on emitted links rather than on a 404, because the preview
  // server answers unknown paths with an SPA fallback and the status would
  // therefore prove nothing about whether the page exists.
  for (const path of ['/frameworks/soc2/', '/frameworks/soc2/cc8-1.html', '/frameworks/soc2/cc6-1.html']) {
    await page.goto(path);
    const hrefs = await page.locator('a').evaluateAll((els) =>
      els.map((e) => e.getAttribute('href') ?? ''),
    );
    expect(hrefs.filter((h) => /pi1-|\/p[1-8]-/.test(h)), path).toEqual([]);
  }

  // And the page genuinely was not generated: the fallback is the homepage,
  // not a criterion page.
  const body = await (await page.request.get('/frameworks/soc2/pi1-2.html')).text();
  expect(body).not.toContain('SOC 2 Trust Services Criteria in plain English');
});

test('the section is honest about scope and copyright', async ({ page }) => {
  await page.goto('/frameworks/soc2/');
  const footer = page.locator('footer');
  await expect(footer).toContainText(/copyrighted/i);
  await expect(footer).toContainText(/Processing Integrity and Privacy/i);
  await expect(footer.locator('a[href*="aicpa"]')).toHaveCount(1);
});

test('the SOC 2 section is in the sitemap', async ({ page }) => {
  const xml = await (await page.request.get('/sitemap.xml')).text();
  expect(xml).toContain('/frameworks/soc2/');
  expect(xml).toContain('/frameworks/soc2/cc6-4.html');
  // The criteria that are not enumerated must not appear.
  expect(xml).not.toContain('/frameworks/soc2/pi1-');
});

test('the nav stays a single row with SOC 2 added', async ({ page }) => {
  // SOC 2 went onto the frameworks hub rather than into the nav, precisely so
  // the nav would not wrap to a second row again.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/frameworks/soc2/');
  const rows = await page.evaluate(() => {
    const links = [...document.querySelectorAll('.site-nav a')];
    return new Set(links.map((a) => Math.round(a.getBoundingClientRect().top))).size;
  });
  expect(rows).toBe(1);
  await expect(page.locator('.site-nav a', { hasText: 'SOC 2' })).toHaveCount(0);
});

test('the Frameworks nav entry points at the hub, not at the SOC 2 page itself', async ({ page }) => {
  await page.goto('/frameworks/soc2/');
  const link = page.locator('.site-nav a', { hasText: 'Frameworks' });
  await expect(link).toHaveAttribute('aria-current', 'page');
  expect(new URL((await link.getAttribute('href'))!, page.url()).pathname).toBe('/frameworks/');
});
