import { expect, test } from '@playwright/test';

test('quiz index lists decks and links cert glossary entries', async ({ page }) => {
  await page.goto('/quiz/');
  await expect(page.locator('.deck-card')).toHaveCount(18);
  const cissp = page.locator('.deck-card', { hasText: 'CISSP' }).first();
  await expect(cissp.locator('a.permalink')).toHaveAttribute('href', '../definitions/cissp.html');
  await expect(page.locator('.deck-card', { hasText: 'LPT' }).locator('.chip')).toHaveText('retired cert');
  // A newly added deck is present and cross-links to its cert glossary entry.
  const cism = page.locator('.deck-card', { hasText: 'CISM' }).first();
  await expect(cism.locator('a.permalink')).toHaveAttribute('href', '../definitions/cism.html');
});

test('a new cert deck plays a scored round', async ({ page }) => {
  await page.goto('/quiz/?deck=oscp');
  await expect(page.locator('.quiz-title')).toHaveText('OSCP');
  await page.locator('.choice-btn').first().click();
  await expect(page.locator('.choice-btn.right')).toHaveCount(1);
  await expect(page.locator('.why-box')).toBeVisible();
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

test('exam-mode setup picks a count, runs timed, and shows pass or fail', async ({ page }) => {
  await page.goto('/quiz/');
  // First choice deck opens the setup screen instead of starting immediately.
  const startBtn = page.locator('.deck-card .primary-btn', { hasText: 'Start quiz' }).first();
  await startBtn.click();
  await expect(page.locator('.quiz-question')).toContainText('set up your round');
  await page.locator('.seg-btn', { hasText: '10' }).click();
  await page.locator('.setup-check input').check();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('#quiz-progress')).toContainText('/10');
  // Answer all ten (first choice each), then land on results.
  for (let i = 0; i < 10; i++) {
    await page.locator('.choice-btn').first().click();
    await page.locator('.quiz-next').click();
  }
  await expect(page.locator('.exam-verdict')).toHaveText(/PASS|FAIL/);
});

test('an in-flight round resumes after a reload', async ({ page }) => {
  await page.goto('/quiz/?deck=ceh'); // auto-starts a 20-question round
  await page.locator('.choice-btn').first().click();
  await page.locator('.quiz-next').click(); // advance to question 2
  await page.goto('/quiz/'); // reload with no deck param
  await expect(page.locator('#quiz-progress')).toContainText('2/20');
  await expect(page.locator('.quiz-question')).toBeVisible();
});
