import { expect, test } from '@playwright/test';

test('privacy policy page renders with the localStorage promise', async ({ page }) => {
  await page.goto('/privacy/');
  await expect(page).toHaveTitle(/Privacy policy/);
  await expect(page.locator('h1')).toContainText('Privacy');
  await expect(page.locator('main')).toContainText('localStorage');
  // Cross-links to the disclosure page and back home resolve.
  await expect(page.locator('main a[href="../disclosure/"]')).toBeVisible();
});

test('affiliate disclosure page renders with the FTC statement', async ({ page }) => {
  await page.goto('/disclosure/');
  await expect(page).toHaveTitle(/Affiliate disclosure/);
  await expect(page.locator('main')).toContainText('16 CFR Part 255');
  await expect(page.locator('main')).toContainText('Amazon Associate');
  await expect(page.locator('main a[href="../privacy/"]')).toBeVisible();
});

test('site footer links to privacy and disclosure from key pages', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('footer a[href="privacy/"]')).toBeVisible();
  await expect(page.locator('footer a[href="disclosure/"]')).toBeVisible();

  await page.goto('/careers/');
  await expect(page.locator('footer a[href="../privacy/"]')).toBeVisible();

  await page.goto('/frameworks/nist-csf/');
  await expect(page.locator('footer a[href="../../disclosure/"]')).toBeVisible();
});

test('generated definition pages carry the footer links', async ({ page }) => {
  await page.goto('/definitions/cissp.html');
  await expect(page.locator('footer a[href="../privacy/"]')).toBeVisible();
  await expect(page.locator('footer a[href="../disclosure/"]')).toBeVisible();
});
