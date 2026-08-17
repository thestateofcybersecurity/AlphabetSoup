import { expect, test } from '@playwright/test';

/**
 * The Frameworks and Tools nav entries carry dropdown menus so reaching a
 * specific tool no longer means hub, scroll, find. The parent link still goes
 * to the section hub; the chevron button (wired by /nav.js), hover, and
 * keyboard focus open the menu. Generated pages ship no JS, so their .gnav
 * dropdowns are hover/focus-only.
 */

const menuOpacity = (page: import('@playwright/test').Page, which: string) =>
  page
    .locator(`.nav-item:has(a.nav-parent:text-is("${which}")) .nav-menu`)
    .evaluate((el) => getComputedStyle(el).opacity);

test('the Tools toggle opens the menu and a child link navigates', async ({ page }) => {
  await page.goto('/');
  const item = page.locator('.nav-item', { has: page.locator('a.nav-parent', { hasText: 'Tools' }) });
  const toggle = item.locator('.nav-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => menuOpacity(page, 'Tools')).toBe('1');
  await item.locator('.nav-menu a', { hasText: 'Control Crosswalk' }).click();
  await expect(page).toHaveURL(/\/tools\/crosswalk\/$/);
});

test('the parent link still reaches the hub, not the menu', async ({ page }) => {
  await page.goto('/');
  await page.locator('a.nav-parent', { hasText: 'Tools' }).click();
  await expect(page).toHaveURL(/\/tools\/$/);
});

test('Escape closes the menu and returns focus to the toggle', async ({ page }) => {
  await page.goto('/');
  const item = page.locator('.nav-item', { has: page.locator('a.nav-parent', { hasText: 'Frameworks' }) });
  const toggle = item.locator('.nav-toggle');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();
});

test('clicking elsewhere closes an open menu', async ({ page }) => {
  await page.goto('/');
  const toggle = page.locator('.nav-item .nav-toggle').first();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#main').click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('keyboard focus alone opens the menu, no JS interaction needed', async ({ page }) => {
  await page.goto('/');
  // Tab from the Frameworks parent link: next stops are the toggle, then the
  // menu children, which are kept in the tab order (hidden via opacity, not
  // display), so :focus-within reveals the menu around them.
  await page.locator('a.nav-parent', { hasText: 'Frameworks' }).focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.locator('.nav-menu a', { hasText: 'NIST CSF' })).toBeFocused();
  await expect.poll(() => menuOpacity(page, 'Frameworks')).toBe('1');
});

test('generated pages get hover dropdowns with no script', async ({ page }) => {
  await page.goto('/definitions/siem.html');
  const item = page.locator('.gnav-item', { has: page.locator('a', { hasText: 'Tools' }) });
  const menu = item.locator('.gnav-menu');
  expect(await menu.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
  await item.locator('> a').hover();
  await expect.poll(() => menu.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  await expect(menu.locator('a', { hasText: 'AI Risk Tiering' })).toHaveAttribute(
    'href',
    '../tools/ai-risk/',
  );
});

test('narrow screens keep the flat scroll row: no toggles, no menus', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/tools/ai-risk/');
  await expect(page.locator('.nav-toggle').first()).toBeHidden();
  const hidden = await page
    .locator('.nav-menu')
    .first()
    .evaluate((el) => getComputedStyle(el).display);
  expect(hidden).toBe('none');
});
