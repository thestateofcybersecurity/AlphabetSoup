import { expect, test } from '@playwright/test';

test('CSF and CIS pages cross-link through the mapping', async ({ page }) => {
  await page.goto('/frameworks/nist-csf/?q=PR.AA-01');
  const card = page.locator('.fw-card').first();
  await expect(card.locator('.map-label')).toContainText('Related CIS safeguards');
  const chip = card.locator('.map-chip').first();
  await expect(chip).toHaveAttribute('href', /\.\.\/cis\/\d+-\d+\.html/);

  // Static pages carry the mapping both directions.
  await page.goto('/frameworks/cis/5-1.html');
  await expect(page.locator('h2', { hasText: 'Related CSF subcategories' })).toBeVisible();
  await page.locator('.related a').first().click();
  await expect(page).toHaveURL(/frameworks\/nist-csf\/[a-z]{2}-[a-z]{2}-\d+\.html/);
});

test('homepage search surfaces cross-section hits', async ({ page }) => {
  await page.goto('/');
  await page.locator('#search').fill('audit log');
  const hint = page.locator('#framework-hint');
  await expect(hint).toBeVisible();
  await expect(hint.locator('.hint-label')).toHaveText('Elsewhere in the soup');
  await expect(hint.locator('.hint-row a').first()).toHaveAttribute('href', /frameworks\//);

  await page.locator('#search').fill('cissp');
  await expect(hint.locator('.hint-row', { hasText: 'Quiz' }).locator('a')).toHaveAttribute(
    'href',
    'quiz/?deck=cissp',
  );
});

test('assessment history shows a trend after repeat completions', async ({ page }) => {
  // Seed two snapshots: one from yesterday, then complete today.
  await page.goto('/assess/');
  await page.evaluate(() => {
    localStorage.setItem(
      'alphabetsoup:assessment-history:ransomware',
      JSON.stringify([{ date: '2020-01-01', overall: 10 }]),
    );
  });
  await page.locator('.assess-card[data-assessment="ransomware"] .primary-btn').click();
  await page.locator('.assess-row').first().locator('.yesno-btn', { hasText: 'yes' }).click();
  await page.locator('#assess-done').click();
  await expect(page.locator('.trend .spark')).toBeVisible();
  await expect(page.locator('.trend-delta')).toContainText('since 2020-01-01');
});
