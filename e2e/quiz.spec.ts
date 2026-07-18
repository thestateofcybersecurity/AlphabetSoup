import { expect, test } from '@playwright/test';

test('quiz index lists decks and links cert glossary entries', async ({ page }) => {
  await page.goto('/quiz/');
  await expect(page.locator('.deck-card')).toHaveCount(9);
  const cissp = page.locator('.deck-card', { hasText: 'CISSP' }).first();
  await expect(cissp.locator('a.permalink')).toHaveAttribute('href', '../definitions/cissp.html');
  await expect(page.locator('.deck-card', { hasText: 'LPT' }).locator('.chip')).toHaveText('retired cert');
});

test('multiple-choice round plays through with feedback and results', async ({ page }) => {
  await page.goto('/quiz/?deck=security-plus');
  await expect(page.locator('.quiz-title')).toHaveText('CompTIA Security+');
  for (let i = 0; i < 20; i++) {
    await page.locator('.choice-btn').first().click();
    // One choice must be marked right after answering.
    await expect(page.locator('.choice-btn.right')).toHaveCount(1);
    await page.locator('.quiz-next').click();
  }
  await expect(page.locator('.quiz-score-big')).toBeVisible();
});

test('flip deck reveals answers and self-grades', async ({ page }) => {
  await page.goto('/quiz/?deck=fundamentals');
  await page.locator('.primary-btn', { hasText: 'Reveal answer' }).click();
  await expect(page.locator('.flip-answer')).toBeVisible();
  await page.locator('.ghost-btn', { hasText: 'Knew it' }).click();
  await expect(page.locator('#quiz-progress')).toContainText('1 correct');
});

test('cert definition page links to its practice deck', async ({ page }) => {
  await page.goto('/definitions/cissp.html');
  const quizLink = page.locator('a', { hasText: 'Practice CISSP questions' });
  await expect(quizLink).toBeVisible();
  await quizLink.click();
  await expect(page).toHaveURL(/quiz\/\?deck=cissp/);
  await expect(page.locator('.quiz-title')).toHaveText('CISSP');
});
