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

test('dragging a task moves it to another quarter column', async ({ page }) => {
  await page.goto('/roadmap/');
  const q1 = page.locator('.board-col[data-quarter="Q1"]');
  const q3 = page.locator('.board-col[data-quarter="Q3"]');
  const before = await q3.locator('.task-card').count();
  const card = q1.locator('.task-card').first();
  const label = (await card.locator('.task-label').textContent())!.trim();
  // Native HTML5 drag/drop with a shared DataTransfer (Playwright's dragTo does
  // not carry dataTransfer through synthetic mouse events in headless Chromium).
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await card.dispatchEvent('dragstart', { dataTransfer });
  await q3.dispatchEvent('dragover', { dataTransfer });
  await q3.dispatchEvent('drop', { dataTransfer });
  await expect(q3.locator('.task-card .task-label', { hasText: label })).toBeVisible();
  await expect(q3.locator('.task-card')).toHaveCount(before + 1);
});

test('dashboard shows progress and per-quarter load', async ({ page }) => {
  await page.goto('/roadmap/');
  await expect(page.locator('.plan-progress-track')).toBeVisible();
  await expect(page.locator('.plan-stat-done')).toContainText('done');
  await expect(page.locator('.plan-load-cell')).toHaveCount(4);
  // Calendar dates on columns once a start month is set.
  await expect(page.locator('.board-col-date').first()).toContainText(/\d{4}/);
});

test('group filter and hide-done narrow the board', async ({ page }) => {
  await page.goto('/roadmap/');
  await page.locator('#plan-group').selectOption('Govern');
  // Govern has 6 CSF categories.
  await expect(page.locator('.task-card')).toHaveCount(6);
  await page.locator('#plan-group').selectOption('');
  // Mark the first task done, then hide done.
  const first = page.locator('.task-card').first();
  await first.locator('.status-chip').click(); // in progress
  await first.locator('.status-chip').click(); // done
  await page.locator('#plan-hide-done').check();
  await expect(page.locator('.task-card')).toHaveCount(21);
});

test('assessment gaps support multiple assessments and exclude n/a', async ({ page }) => {
  await page.goto('/roadmap/');
  await page.evaluate(() => {
    localStorage.setItem(
      'alphabetsoup:assessment:cpg',
      JSON.stringify({ '1.A': 'yes', '1.B': 'na', '1.C': 'no' }),
    );
  });
  await page.goto('/roadmap/?source=gaps&a=cpg');
  await expect(page.locator('#plan-gaps-assessment')).toHaveValue('cpg');
  // 1.A (yes) and 1.B (na) are not gaps; 1.C and the unanswered rest are.
  await expect(page.locator('.task-card[data-task-id="1.A"]')).toHaveCount(0);
  await expect(page.locator('.task-card[data-task-id="1.B"]')).toHaveCount(0);
  await expect(page.locator('.task-card[data-task-id="1.C"]')).toHaveCount(1);
});

test('owner assignment persists across reload', async ({ page }) => {
  await page.goto('/roadmap/');
  const first = page.locator('.task-card').first();
  await first.locator('.task-owner').fill('Dana');
  await page.reload();
  await expect(page.locator('.task-card').first().locator('.task-owner')).toHaveValue('Dana');
});
