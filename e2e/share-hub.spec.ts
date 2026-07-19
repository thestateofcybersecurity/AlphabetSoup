import { expect, test } from '@playwright/test';

test('homepage shows the learning-path hub and a feedback link', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.learning-path .path-step')).toHaveCount(5);
  await expect(page.locator('.learning-path a', { hasText: 'Quiz' }).first()).toHaveAttribute('href', 'quiz/');
  await expect(page.locator('.colophon a[href*="issues/new"]')).toBeVisible();
});

test.describe('result sharing', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('assess copy summary writes a report to the clipboard', async ({ page }) => {
    await page.goto('/assess/?a=ransomware');
    await page.locator('.assess-row .yesno-btn.state-yes').first().click();
    await page.locator('#assess-done').click();
    await page.locator('#assess-results .ghost-btn', { hasText: 'copy summary' }).click();
    await expect(page.locator('#app-toast')).toContainText('copied');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain('self-assessment');
    expect(clip).toContain('cybersecurityalphabetsoup.com/assess/');
  });

  test('roadmap copy summary writes a summary to the clipboard', async ({ page }) => {
    await page.goto('/roadmap/');
    await page.locator('#plan-copy').click();
    await expect(page.locator('#app-toast')).toContainText('copied');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain('Maturity:');
  });
});
