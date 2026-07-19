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
  await expect(page.locator('.quiz-score-big')).toHaveText('6%'); // 3 of 48 satisfied
  await expect(page.locator('.assess-band')).toHaveText('High risk');
  await expect(page.locator('.score-bar').first()).toBeVisible();
  // Each gap shows its concrete first step.
  await expect(page.locator('.gap-fix').first()).not.toBeEmpty();
  // Gap list links CIS references into the framework section.
  await expect(page.locator('.gap-refs a[href*="frameworks/cis"]').first()).toBeVisible();
});

test('answers persist across reloads', async ({ page }) => {
  await page.goto('/assess/');
  const ransomwareCard = page.locator('.assess-card[data-assessment="ransomware"]');
  await ransomwareCard.locator('.primary-btn').click();
  await page.locator('.assess-row').first().locator('.yesno-btn', { hasText: 'yes' }).click();

  // Reload keeps ?a=ransomware and resumes straight into the form with the answer intact.
  await page.reload();
  await expect(page.locator('.assess-row').first().locator('.yesno-btn.active')).toHaveText('Yes');

  // A fresh visit to the intro offers Resume for the started assessment.
  await page.goto('/assess/');
  await expect(ransomwareCard.locator('.primary-btn')).toHaveText('Resume');
});

test('cross-assessment posture overview shows scores, trend, and cadence', async ({ page }) => {
  await page.goto('/assess/');
  // Seed two assessments with history, then reload the landing.
  await page.evaluate(() => {
    localStorage.setItem('alphabetsoup:assessment:cpg', JSON.stringify({ '1.A': 'yes', '1.B': 'no' }));
    localStorage.setItem(
      'alphabetsoup:assessment-history:cpg',
      JSON.stringify([{ date: '2025-06-01', overall: 10 }, { date: '2025-09-01', overall: 40 }]),
    );
  });
  await page.goto('/assess/');
  await expect(page.locator('.posture-summary')).toContainText('assessed');
  const cpgCard = page.locator('.assess-card[data-assessment="cpg"]');
  // 1 satisfied of 34 applicable (unanswered count as deficient) -> 3%.
  await expect(cpgCard.locator('.posture-score')).toHaveText('3%');
  // An old last-assessment date surfaces a review nudge.
  await expect(cpgCard.locator('.posture-due')).toContainText('due for review');
  // A never-started assessment reads "not started".
  await expect(page.locator('.assess-card[data-assessment="cis-ig1"] .posture-score')).toHaveText('not started');
  await page.evaluate(() => {
    localStorage.removeItem('alphabetsoup:assessment:cpg');
    localStorage.removeItem('alphabetsoup:assessment-history:cpg');
  });
});

test('all-N/A answers show an insufficient state, not a false tier', async ({ page }) => {
  await page.goto('/assess/?a=ransomware');
  // Answer every question N/A.
  const naButtons = page.locator('.assess-row .yesno-btn.state-na');
  const count = await naButtons.count();
  for (let i = 0; i < count; i++) await naButtons.nth(i).click();
  await page.locator('#assess-done').click();
  await expect(page.locator('.quiz-score-big')).toHaveText('—');
  await expect(page.locator('.assess-band')).toHaveText('Not enough to score');
  await expect(page.locator('.attain-badge')).toHaveCount(0);
});

test('answer buttons are an accessible radiogroup', async ({ page }) => {
  await page.goto('/assess/?a=ransomware');
  const group = page.locator('.yesno').first();
  await expect(group).toHaveAttribute('role', 'radiogroup');
  const yes = group.locator('.state-yes');
  await yes.click();
  await expect(yes).toHaveAttribute('aria-checked', 'true');
});

test('CISA CPG module scores with N/A excluded and shows guidance', async ({ page }) => {
  await page.goto('/assess/?a=cpg');
  await expect(page.locator('#assess-progress')).toHaveText('0/34 answered');
  // Every practice carries an expandable guidance block.
  await expect(page.locator('.q-guidance').first()).toBeVisible();

  const rows = page.locator('.assess-row');
  // First question yes, second not applicable: N/A drops out of the denominator.
  await rows.nth(0).locator('.yesno-btn', { hasText: 'Yes' }).click();
  await rows.nth(1).locator('.yesno-btn', { hasText: 'N/A' }).click();
  await page.locator('#assess-done').click();
  // 1 satisfied of 1 applicable (the N/A is excluded), rest unanswered -> still low overall.
  await expect(page.locator('.dist')).toBeVisible();
  await expect(page.locator('.radar')).toBeVisible();
  await expect(page.locator('.attain-badge')).toBeVisible();
});
