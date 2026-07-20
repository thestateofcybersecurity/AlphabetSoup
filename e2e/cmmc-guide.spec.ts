import { expect, test } from '@playwright/test';

test('CMMC guide renders the three levels and links into the scorer', async ({ page }) => {
  await page.goto('/assess/cmmc/');
  await expect(page.locator('h1')).toContainText('CMMC');
  await expect(page.locator('.level-card')).toHaveCount(3);
  await expect(page.locator('.level-card h3').first()).toHaveText('Level 1');

  // The primary CTA opens the existing 800-171 / CMMC self-assessment.
  const cta = page.locator('.guide-cta');
  await expect(cta).toHaveAttribute('href', '../?a=nist-800171');
  await cta.click();
  await expect(page).toHaveURL(/\/assess\/\?a=nist-800171/);
  // The 800-171 / CMMC assessment opens straight into its scored form.
  await expect(page.locator('#assess-progress')).toContainText('answered');
  await expect(page.locator('.assess-row').first()).toBeVisible();
});

test('assess landing links to the CMMC guide', async ({ page }) => {
  await page.goto('/assess/');
  await expect(page.locator('.assess-guide-link a')).toHaveAttribute('href', './cmmc/');
});
