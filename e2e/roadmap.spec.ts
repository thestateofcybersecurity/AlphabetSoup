import { expect, test } from '@playwright/test';

test('CSF plan renders 22 tasks across quarters with status cycling', async ({ page }) => {
  await page.goto('/roadmap/');
  await expect(page.locator('.board-col')).toHaveCount(4);
  await expect(page.locator('.task-card')).toHaveCount(22);
  await expect(page.locator('#plan-summary')).toContainText('0/22 done');

  const first = page.locator('.task-card').first();
  await first.locator('.status-chip').click();
  await expect(page.locator('.task-card.is-in-progress .status-chip')).toHaveText('in progress');
  await page.locator('.task-card.is-in-progress .status-chip').click();
  await expect(page.locator('#plan-summary')).toContainText('1/22 done');

  // Task links into the CSF translation section.
  await expect(first.locator('.task-label a')).toHaveAttribute('href', /frameworks\/nist-csf/);
});

test('CIS plan scopes by implementation group', async ({ page }) => {
  await page.goto('/roadmap/');
  await page.locator('#plan-source').selectOption('cis');
  await expect(page.locator('.task-card')).toHaveCount(18); // IG3 default
  await page.locator('#plan-ig').selectOption('1');
  const detail = page.locator('.task-card').first().locator('.task-detail');
  await expect(detail).toContainText('in IG1');
});

test('vCISO template filters by package and shows hours', async ({ page }) => {
  await page.goto('/roadmap/');
  await page.locator('#plan-source').selectOption('vciso');
  await expect(page.locator('.board-col')).toHaveCount(5); // includes Onboarding
  const largeCount = await page.locator('.task-card').count();
  await page.locator('#plan-pkg').selectOption('Small');
  const smallCount = await page.locator('.task-card').count();
  expect(smallCount).toBeLessThanOrEqual(largeCount);
  await expect(page.locator('#plan-summary')).toContainText('estimated hours');
});

test('quarter reassignment persists across reload', async ({ page }) => {
  await page.goto('/roadmap/');
  const first = page.locator('.task-card').first();
  const label = await first.locator('.task-label').textContent();
  await first.locator('.quarter-select').selectOption('Q4');
  await page.reload();
  const q4 = page.locator('.board-col', { hasText: 'Q4' });
  await expect(q4.locator('.task-card .task-label', { hasText: label!.trim() })).toBeVisible();
});
