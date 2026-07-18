import { expect, test } from '@playwright/test';

test('homepage searches and expands an entry', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.title')).toContainText('Alphabet');
  await page.locator('#search').fill('siem');
  const first = page.locator('.entry').first();
  await expect(first.locator('.entry-key')).toHaveText('SIEM');
  await first.locator('summary').click();
  await expect(first.locator('.entry-body p')).not.toBeEmpty();
  await expect(first.locator('.permalink')).toHaveAttribute('href', 'definitions/siem.html');
});

test('category pill narrows results (no difficulty dropdown)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#difficulty')).toHaveCount(0);
  await page.locator('.pill', { hasText: 'crypto' }).click();
  await expect(page.locator('#result-meta')).toContainText('match');
  const chips = page.locator('.entry .cat-dot');
  await expect(chips.first()).toHaveText('crypto');
});

test('results page through with Show more', async ({ page }) => {
  await page.goto('/');
  // Default browse view caps at 60 and offers a Show more button.
  await expect(page.locator('.entry')).toHaveCount(60);
  await expect(page.locator('#result-meta')).toContainText('showing 60');
  await page.locator('.show-more').click();
  await expect(page.locator('.entry').first()).toBeVisible();
  await expect(page.locator('.entry')).toHaveCount(120);
});

test('MITRE and Cyberdle nav links open in a new tab', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.site-nav a', { hasText: 'MITRE' })).toHaveAttribute('target', '_blank');
  await expect(page.locator('.site-nav a', { hasText: 'Cyberdle' })).toHaveAttribute('target', '_blank');
});

test('soup of the day links to a definition page', async ({ page }) => {
  await page.goto('/');
  const link = page.locator('.sotd-key');
  await expect(link).toBeVisible();
  const href = await link.getAttribute('href');
  expect(href).toMatch(/^definitions\/[a-z0-9]+\.html$/);
});

test('static definition page renders with sources and related terms', async ({ page }) => {
  await page.goto('/definitions/siem.html');
  await expect(page.locator('h1')).toHaveText('SIEM');
  await expect(page.locator('.expansion')).toContainText('Security Information and Event Management');
  await expect(page.locator('.card p')).not.toBeEmpty();
  await expect(page.locator('ul li a').first()).toBeVisible();
  await expect(page.locator('.related a').first()).toBeVisible();
});

test('legacy slugs redirect to canonical pages', async ({ page }) => {
  // The old site used "pci dss.html" (space) and "cipp-us.html" (hyphen).
  await page.goto('/definitions/pci%20dss.html');
  await expect(page).toHaveURL(/definitions\/pcidss\.html/);
  await expect(page.locator('h1')).toHaveText('PCI DSS');

  await page.goto('/definitions/cipp-us.html');
  await expect(page).toHaveURL(/definitions\/cippus\.html/);

  // Aliased slug: old "soc 3" page lands on SOC 2.
  await page.goto('/definitions/soc%203.html');
  await expect(page).toHaveURL(/definitions\/soc2\.html/);
});

test('?q= deep link pre-fills search', async ({ page }) => {
  await page.goto('/?q=nmap');
  await expect(page.locator('#search')).toHaveValue('nmap');
});
