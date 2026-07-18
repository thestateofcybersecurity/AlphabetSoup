import { expect, test } from '@playwright/test';

test('assessment flows from intro to scored results with gap guidance', async ({ page }) => {
  await page.goto('/assess/');
  await page.locator('.assess-card[data-assessment="ransomware"] .primary-btn').click();
  await expect(page.locator('#assess-progress')).toHaveText('0/48 answered');

  // Answer the first four questions: yes, yes, no, yes.
  const rows = page.locator('.assess-row');
  await rows.nth(0).locator('.yesno-btn', { hasText: 'yes' }).click();
  await rows.nth(1).locator('.yesno-btn', { hasText: 'yes' }).click();
  await rows.nth(2).locator('.yesno-btn', { hasText: 'no' }).click();
  await rows.nth(3).locator('.yesno-btn', { hasText: 'yes' }).click();
  await expect(page.locator('#assess-progress')).toHaveText('4/48 answered');

  await page.locator('#assess-done').click();
  await expect(page.locator('.quiz-score-big')).toHaveText('6%'); // 3 of 48 yes
  await expect(page.locator('.assess-band')).toHaveText('High risk');
  await expect(page.locator('.score-bar').first()).toBeVisible();
  // Gap list links CIS references into the framework section.
  await expect(page.locator('.gap-refs a').first()).toHaveAttribute('href', /frameworks\/cis\/\?q=/);
});

test('answers persist across reloads', async ({ page }) => {
  await page.goto('/assess/');
  const ransomwareCard = page.locator('.assess-card[data-assessment="ransomware"]');
  await ransomwareCard.locator('.primary-btn').click();
  await page.locator('.assess-row').first().locator('.yesno-btn', { hasText: 'yes' }).click();

  // Reload keeps ?a=ransomware and resumes straight into the form with the answer intact.
  await page.reload();
  await expect(page.locator('.assess-row').first().locator('.yesno-btn.active')).toHaveText('yes');

  // A fresh visit to the intro offers Resume for the started assessment.
  await page.goto('/assess/');
  await expect(ransomwareCard.locator('.primary-btn')).toHaveText('Resume');
});
