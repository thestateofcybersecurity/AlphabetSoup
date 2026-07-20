import { expect, test } from '@playwright/test';

test('career paths page maps roles to decks and opens a deck', async ({ page }) => {
  await page.goto('/careers/');
  await expect(page.locator('h1')).toContainText('Career');
  await expect(page.locator('.path')).toHaveCount(6);

  // Deck chips point at the quiz with a deck param.
  const soc = page.locator('.path', { hasText: 'SOC analyst' });
  await expect(soc.locator('.chip.deck', { hasText: 'CySA+' })).toHaveAttribute('href', '../quiz/?deck=cysa');

  // Following a deck chip opens that deck in the quiz.
  await page.locator('.chip.deck', { hasText: 'CISSP' }).first().click();
  await expect(page).toHaveURL(/\/quiz\/\?deck=cissp/);
  await expect(page.locator('.quiz-player, #player')).toBeVisible();
});

test('career path category chip deep-links into the glossary filter', async ({ page }) => {
  await page.goto('/?category=governance');
  // The governance category pill is active and results are filtered to it.
  await expect(page.locator('#category-pills .pill[data-category="governance"]')).toHaveClass(/active/);
  await expect(page.locator('.entry .cat-dot').first()).toHaveText('governance');
});

test('quiz landing links to the career paths page', async ({ page }) => {
  await page.goto('/quiz/');
  await expect(page.locator('.assess-guide-link a')).toHaveAttribute('href', '../careers/');
});
