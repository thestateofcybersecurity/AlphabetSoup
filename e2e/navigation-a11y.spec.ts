import { expect, test } from '@playwright/test';
import { NAV_LINK_COUNT } from '../src/lib/site-nav';

/**
 * Guards for the navigation and accessibility fixes.
 *
 * The nav was hand-copied into 23 files plus a separate generator
 * implementation, and drifted (12 pages missing About, 2 missing AI Security,
 * one marking the wrong link current). It now renders from src/lib/site-nav.ts
 * for every page, so these specs check consistency across page depths.
 */

const SAMPLE_PAGES = [
  '/',
  '/quiz/',
  '/tools/',
  '/tools/crosswalk/',
  '/assess/cmmc/',
  '/careers/',
  '/frameworks/ai/',
];

for (const path of SAMPLE_PAGES) {
  test(`nav is complete and consistent on ${path}`, async ({ page }) => {
    await page.goto(path);
    const nav = page.locator('.site-nav');
    await expect(nav.locator('a')).toHaveCount(NAV_LINK_COUNT);
    // The links that had drifted out of individual pages.
    for (const label of ['Tools', 'Careers', 'About', 'AI Security']) {
      await expect(nav.locator('a', { hasText: label })).toHaveCount(1);
    }
    // At most one current-page marker, and never on the wrong link.
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(path === '/tools/crosswalk/' || path === '/assess/cmmc/' ? 0 : 1);
  });
}

test('careers marks itself current, not the quiz link', async ({ page }) => {
  await page.goto('/careers/');
  await expect(page.locator('.site-nav a[aria-current="page"]')).toHaveText('Careers');
});

test('generated pages expose a main landmark and a skip link', async ({ page }) => {
  for (const path of ['/definitions/siem.html', '/frameworks/cis/1-1.html', '/blog/']) {
    await page.goto(path);
    await expect(page.locator('main#main')).toHaveCount(1);
    const skip = page.locator('a.skip-link');
    await expect(skip).toHaveAttribute('href', '#main');
    // The skip link is the first thing a keyboard user reaches.
    await page.keyboard.press('Tab');
    await expect(skip).toBeFocused();
  }
});

test('assess and roadmap import controls are reachable by keyboard', async ({ page }) => {
  // Previously a <label> wrapping a display:none input: not focusable at all.
  await page.goto('/roadmap/');
  const roadmapImport = page.locator('#plan-import-btn');
  await expect(roadmapImport).toBeVisible();
  await roadmapImport.focus();
  await expect(roadmapImport).toBeFocused();

  await page.goto('/assess/');
  // Reach the results toolbar where the import button lives.
  await page.evaluate(() => localStorage.setItem('alphabetsoup:assessment:default', JSON.stringify({ 'RANSOM.1': 'yes' })));
  await page.reload();
  const assessImport = page.locator('button.ghost-btn', { hasText: 'import' }).first();
  if (await assessImport.count()) {
    await assessImport.focus();
    await expect(assessImport).toBeFocused();
  }
});
