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
  await expect(page.locator('h1')).toContainText('15.3');
  await expect(page.locator('h1 .ig-badge')).toHaveText(/IG[123]/);
  await expect(page.locator('.expansion')).toContainText('Service Provider Management');
  // Mapped CSF links carry the subcategory text, not a bare id.
  await expect(page.locator('.related a').first()).toContainText(/[A-Z]{2}\.[A-Z]{2}-\d{2}:/);
});

test('CIS page: IG badges, IG filter, keyword search, and coverage tracking', async ({ page }) => {
  await page.goto('/frameworks/cis/');
  // Every card carries an IG badge.
  await expect(page.locator('.fw-card .fw-badge').first()).toHaveText(/IG[123]/);
  // Keyword search matches a control name (not just ids/headings).
  await page.locator('#search').fill('malware');
  await expect(page.locator('#result-meta')).toContainText('match');
  await page.locator('#clear-search').click();
  // IG1 filter yields exactly the 56 IG1 safeguards.
  await page.locator('#secondary-pills .pill', { hasText: 'IG1' }).click();
  await expect(page.locator('#result-meta')).toContainText('56 matches');
  // Mark reviewed updates the coverage bar and persists.
  await page.locator('.fw-card .fw-review').first().click();
  await expect(page.locator('.fw-coverage-text')).toContainText('1 of 56 reviewed');
  await page.reload();
  await page.locator('#secondary-pills .pill', { hasText: 'IG1' }).click();
  await expect(page.locator('.fw-coverage-text')).toContainText('1 of 56 reviewed');
});

test('framework pages page through all results with Show more', async ({ page }) => {
  await page.goto('/frameworks/cis/');
  // 153 safeguards: the first page caps at 60 and offers a Show more, so nothing is cut off.
  await expect(page.locator('.fw-card')).toHaveCount(60);
  await expect(page.locator('#result-meta')).toContainText('showing 60 of 153');
  await expect(page.locator('.show-more')).toBeVisible();

  await page.locator('.show-more').click();
  await expect(page.locator('.fw-card')).toHaveCount(120);
  await page.locator('.show-more').click();
  await expect(page.locator('.fw-card')).toHaveCount(153);
  // Everything is revealed: the meta reads "browsing all" and the button is gone.
  await expect(page.locator('#result-meta')).toContainText('browsing all 153');
  await expect(page.locator('.show-more')).toHaveCount(0);

  // Changing a filter resets paging back to the first page.
  await page.locator('#search').fill('malware');
  await expect(page.locator('.show-more')).toHaveCount(0);
  await page.locator('#clear-search').click();
  await expect(page.locator('.fw-card')).toHaveCount(60);
});

test('homepage hints framework queries and nav links both ways', async ({ page }) => {
  await page.goto('/');
  await page.locator('#search').fill('8.1');
  const hint = page.locator('#framework-hint');
  await expect(hint).toBeVisible();
  // Cross-search returns direct safeguard links; the exact id ranks first.
  await hint.locator('a').first().click();
  await expect(page).toHaveURL(/frameworks\/cis\/8-1\.html/);
  await expect(page.locator('h1')).toContainText('8.1');
  await page.locator('.gnav a', { hasText: 'Acronyms' }).click();
  await expect(page.locator('.title')).toContainText('Alphabet Soup');
});
