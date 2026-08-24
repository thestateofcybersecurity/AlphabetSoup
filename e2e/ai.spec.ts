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

  // The MITRE ATLAS filter yields the 16 tactics plus 101 top-level techniques,
  // more than one page of results, so the meta reports the shown count too.
  await page.locator('.pill', { hasText: 'MITRE ATLAS' }).click();
  await expect(page.locator('#result-meta')).toContainText('117 matches');
  // A technique page is reachable from the filtered list, not just the tactics.
  await page.locator('#search').fill('AML.T0051');
  await expect(page.locator('.fw-card').first().locator('.fw-id')).toHaveText('AML.T0051');
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

test('AI Security is reachable from the nav by way of the frameworks hub', async ({ page }) => {
  // It used to hold its own nav slot. When ISO made a fifth framework link, the
  // four were consolidated behind one Frameworks entry, so the route is now one
  // hop longer. What matters is that it is still reachable from any page depth.
  await page.goto('/frameworks/nist-csf/');
  const hubHref = await page.locator('.site-nav a', { hasText: 'Frameworks' }).getAttribute('href');
  expect(new URL(hubHref!, page.url()).pathname).toBe('/frameworks/');

  await page.goto('/frameworks/');
  const aiHref = await page
    .locator('.fw-card')
    .filter({ hasText: 'AI security' })
    .locator('a.go')
    .getAttribute('href');
  expect(new URL(aiHref!, page.url()).pathname).toBe('/frameworks/ai/');

  // Generated pages carry the same nav, so the route works from there too.
  await page.goto('/definitions/siem.html');
  await expect(page.locator('.gnav a', { hasText: 'Frameworks' })).toBeVisible();
});
