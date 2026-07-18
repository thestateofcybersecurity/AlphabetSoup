import { expect, test } from '@playwright/test';

test('NIST CSF page searches by id and filters by function', async ({ page }) => {
  await page.goto('/frameworks/nist-csf/');
  await expect(page.locator('.title')).toContainText('NIST CSF');
  await page.locator('#search').fill('GV.OC-01');
  const first = page.locator('.fw-card').first();
  await expect(first.locator('.fw-id')).toHaveText('GV.OC-01');
  await expect(first.locator('.metaphor-quote p')).not.toBeEmpty();
  await expect(first.locator('.fw-translation')).not.toBeEmpty();

  await page.locator('#search').fill('');
  await page.locator('.pill', { hasText: 'Detect' }).click();
  await expect(page.locator('#result-meta')).toContainText('11 matches');
});

test('CIS page searches by id and filters by control', async ({ page }) => {
  await page.goto('/frameworks/cis/?q=8.1');
  const first = page.locator('.fw-card').first();
  await expect(first.locator('.fw-id')).toHaveText('8.1');
  await expect(first.locator('.fw-kicker')).toContainText('Audit Log Management');

  await page.locator('#clear-search').click();
  await page.locator('.pill[data-group="15"]').click();
  await expect(page.locator('#result-meta')).toContainText('7 matches');
});

test('generated framework page renders metaphor, translation, and pager', async ({ page }) => {
  await page.goto('/frameworks/nist-csf/gv-sc-04.html');
  await expect(page.locator('h1')).toHaveText('GV.SC-04');
  await expect(page.locator('.metaphor')).toContainText('Think of it like');
  await expect(page.locator('.pager a').first()).toBeVisible();

  await page.goto('/frameworks/cis/15-3.html');
  await expect(page.locator('h1')).toHaveText('15.3');
  await expect(page.locator('.expansion')).toContainText('Service Provider Management');
});

test('homepage hints framework queries and nav links both ways', async ({ page }) => {
  await page.goto('/');
  await page.locator('#search').fill('8.1');
  const hint = page.locator('#framework-hint');
  await expect(hint).toBeVisible();
  await hint.locator('a').click();
  await expect(page).toHaveURL(/frameworks\/cis\/\?q=8\.1/);
  await expect(page.locator('.fw-card').first().locator('.fw-id')).toHaveText('8.1');
  await page.locator('.site-nav a', { hasText: 'Acronyms' }).click();
  await expect(page.locator('.title')).toContainText('Alphabet Soup');
});
