import { expect, test } from '@playwright/test';
import { NAV_LINK_COUNT } from '../src/lib/site-nav';

test('assessment gaps flow into the roadmap planner', async ({ page }) => {
  await page.goto('/assess/');
  // Three assessment cards on the intro (ransomware, CISA CPG, CIS IG1).
  await expect(page.locator('#assess-intro .assess-card')).toHaveCount(10);
  await page
    .locator('.assess-card[data-assessment="ransomware"] .primary-btn')
    .click();
  const rows = page.locator('.assess-row');
  await rows.nth(0).locator('.yesno-btn', { hasText: 'no' }).click();
  await rows.nth(1).locator('.yesno-btn', { hasText: 'yes' }).click();
  await page.locator('#assess-done').click();

  const plan = page.locator('#plan-gaps');
  await expect(plan).toContainText('Plan these');
  await plan.click();
  await expect(page).toHaveURL(/roadmap\/\?source=gaps/);
  // 47 gaps: 48 questions, one answered yes.
  await expect(page.locator('#plan-summary')).toContainText('0/47 done');
  await expect(page.locator('.task-card').first().locator('.task-detail')).toContainText('tier gap');
});

test('roadmap gaps source without an assessment points back to assess', async ({ page }) => {
  await page.goto('/roadmap/?source=gaps');
  const link = page.locator('#plan-summary a');
  await expect(link).toContainText('assessment');
  await expect(link).toHaveAttribute('href', /\.\.\/assess\//);
});

test('CIS IG1 assessment scores by control without tier chips', async ({ page }) => {
  await page.goto('/assess/?a=cis-ig1');
  await expect(page.locator('#assess-progress')).toHaveText('0/56 answered');
  await expect(page.locator('.assess-row .chip')).toHaveCount(0); // single tier, no chips
  await page.locator('.assess-row').first().locator('.yesno-btn', { hasText: 'yes' }).click();
  await page.locator('#assess-done').click();
  await expect(page.locator('.quiz-score-big')).toHaveText('2%');
  await expect(page.locator('.assess-h', { hasText: 'By control' })).toBeVisible();
  // Gap references link to safeguard pages.
  await expect(page.locator('.gap-refs a').first()).toHaveAttribute('href', /frameworks\/cis\/\d+-\d+\.html/);
});

test('quiz shows rationales and builds a drill bank', async ({ page }) => {
  await page.goto('/quiz/?deck=ceh');
  await page.locator('.choice-btn').first().click();
  await expect(page.locator('.why-box p')).not.toBeEmpty();
  for (let i = 0; i < 19; i++) {
    await page.locator('.quiz-next').click();
    await page.locator('.choice-btn').first().click();
  }
  await page.locator('.quiz-next').click();
  await expect(page.locator('.quiz-score-big')).toBeVisible();
  await page.getByRole('button', { name: 'All decks', exact: true }).click();
  const cehCard = page.locator('.deck-card', { hasText: 'CEH' }).first();
  await expect(cehCard.locator('.deck-sub')).toContainText('best');
  // Random clicking virtually guarantees misses; the drill button should exist.
  await expect(cehCard.locator('.ghost-btn.missed')).toContainText('Review due');
});

test('generated pages carry the site nav', async ({ page }) => {
  await page.goto('/definitions/siem.html');
  // Derived from the nav source, so adding a link can never break this test.
  await expect(page.locator('.gnav a')).toHaveCount(NAV_LINK_COUNT);
  await expect(page.locator('.gnav a', { hasText: 'Blog' })).toHaveAttribute('href', '../blog/');
  await expect(page.locator('.gnav a', { hasText: 'Tools' })).toHaveAttribute('href', '../tools/');
  await expect(page.locator('.gnav a', { hasText: 'MITRE' })).toHaveAttribute(
    'href',
    'https://mitre.cybersecurityalphabetsoup.com/',
  );
  await expect(page.locator('.gnav a', { hasText: 'BIA' })).toHaveAttribute(
    'href',
    'https://bia.cybersecurityalphabetsoup.com/',
  );
  await page.goto('/frameworks/cis/1-1.html');
  await expect(page.locator('.gnav a', { hasText: 'Quiz' })).toHaveAttribute('href', '../../quiz/');
});
