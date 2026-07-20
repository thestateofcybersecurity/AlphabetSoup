import { expect, test } from '@playwright/test';

test('AI security page searches by code and filters by framework', async ({ page }) => {
  await page.goto('/frameworks/ai/');
  await expect(page.locator('.title')).toContainText('AI security');
  await page.locator('#search').fill('LLM01');
  const first = page.locator('.fw-card').first();
  await expect(first.locator('.fw-id')).toHaveText('LLM01');
  await expect(first.locator('.metaphor-quote p')).not.toBeEmpty();
  await expect(first.locator('.fw-translation')).not.toBeEmpty();

  await page.locator('#clear-search').click();
  // Filter to the OWASP framework: exactly the 10 LLM risks.
  await page.locator('.pill', { hasText: 'OWASP LLM Top 10' }).click();
  await expect(page.locator('#result-meta')).toContainText('10 matches');

  // The MITRE ATLAS filter yields the 16 tactics.
  await page.locator('.pill', { hasText: 'MITRE ATLAS' }).click();
  await expect(page.locator('#result-meta')).toContainText('16 matches');
});

test('generated AI framework page renders metaphor, translation, source, and pager', async ({ page }) => {
  await page.goto('/frameworks/ai/llm01.html');
  await expect(page.locator('h1')).toHaveText('LLM01');
  await expect(page.locator('.metaphor')).toContainText('Think of it like');
  await expect(page.locator('.card p')).not.toBeEmpty();
  await expect(page.locator('.pager a').first()).toBeVisible();
  // Footer cites the official OWASP source.
  await expect(page.locator('footer a[href*="owasp.org"]').first()).toBeVisible();
});

test('AI Security sits in the site nav between CIS Controls and Quiz', async ({ page }) => {
  await page.goto('/frameworks/nist-csf/');
  await expect(page.locator('.site-nav a', { hasText: 'AI Security' })).toHaveAttribute('href', '../ai/');
  // Generated pages carry it too.
  await page.goto('/definitions/siem.html');
  await expect(page.locator('.gnav a', { hasText: 'AI Security' })).toBeVisible();
});
