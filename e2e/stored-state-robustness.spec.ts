import { expect, test, type Page } from '@playwright/test';

/**
 * Stored state is untrusted: localStorage is user-editable and a backup
 * restored through /my/ writes any alphabetsoup:* key. The October pentest
 * (L5) fixed a roadmap import that left the page dead; the 2026-11-22 pass
 * fuzzed every stored value with the wrong type (null, an object, an array,
 * a number where a string belongs) and found four more places that threw an
 * uncaught error instead of coercing or ignoring the value. None of them
 * killed a page outright, but each left a feature silently broken. These
 * cases replay the four through the real UI and assert nothing throws.
 */

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** Rewrite one stored JSON value in place, then reload. */
async function rewriteStored(page: Page, key: string, edit: string): Promise<void> {
  await page.evaluate(
    ([k, body]) => {
      const value: unknown = JSON.parse(localStorage.getItem(k) ?? 'null');
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const next: unknown = new Function('value', `${body}; return value;`)(value);
      localStorage.setItem(k, JSON.stringify(next));
    },
    [key, edit],
  );
  await page.reload();
}

test('board metrics loads a saved report whose text fields are not strings', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/tools/board-metrics/');
  await page.locator('.bm-input-row input[data-field="current"]').first().fill('5');
  await page.locator('#report-name').fill('Q3 pack');
  await page.locator('#save-report').click();
  await expect(page.locator('#register .bm-reg-item')).toHaveCount(1);

  await rewriteStored(
    page,
    'alphabetsoup:board-metrics:register',
    'value[0].meta = { org: 7, period: null, highlight: {}, ask: [] }',
  );
  await page.locator('#register button[data-action="load"]').first().click();
  // The report still renders from the stored values, under the default title.
  await expect(page.locator('.bm-report-title')).toHaveText('Security posture summary');
  expect(errors).toEqual([]);

  // Values of the wrong type are dropped rather than carried into the report.
  await rewriteStored(page, 'alphabetsoup:board-metrics:register', 'value[0].values = "nope"');
  await page.locator('#register button[data-action="load"]').first().click();
  await expect(page.locator('#report .bm-empty')).toBeVisible();
  expect(errors).toEqual([]);
});

test('crosswalk loads a saved profile whose scope is not a list', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/tools/crosswalk/');
  await page.locator('#controls input[type="checkbox"], .cw-control input[type="checkbox"]').first().check();
  await page.locator('#save-profile').click();
  await expect(page.locator('#register .cw-reg-item')).toHaveCount(1);

  await rewriteStored(page, 'alphabetsoup:crosswalk:register', 'value[0].scope = "csf cis"');
  await page.locator('#register button[data-action="load"]').first().click();
  await expect(page.locator('#register .cw-reg-item')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('the quiz ignores a saved session that does not point at real questions', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/quiz/?deck=cissp');
  await expect(page.locator('#quiz-progress')).toContainText('/');
  expect(await page.evaluate(() => localStorage.getItem('alphabetsoup:quiz-session'))).not.toBeNull();

  for (const edit of [
    'value.session.order[0] = null',
    'value.session.order = "x y"',
    'value.session.position = null',
    'value.session.order[0] = 999999',
    'value.session = 7',
    'value.roundMissed = {}',
  ]) {
    await page.goto('/quiz/?deck=cissp');
    await expect(page.locator('#quiz-progress')).toContainText('/');
    await page.goto('/quiz/');
    await rewriteStored(page, 'alphabetsoup:quiz-session', edit);
    // No resumable session: the deck picker is what the visitor sees.
    await expect(page.locator('#deck-grid')).toBeVisible();
    await expect(page.locator('#deck-grid').locator('button, a').first()).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('the roadmap reads type-confused threat models without throwing', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/roadmap/');
  await page.evaluate(() => {
    const profile = { name: { not: 'a string' }, components: ['user-chat'], exposure: 'internal', dataClass: 'internal' };
    localStorage.setItem('alphabetsoup:ai-threat:draft', JSON.stringify({ profile, verdicts: { 'T01@user-chat': null } }));
    localStorage.setItem(
      'alphabetsoup:ai-threat:models',
      JSON.stringify([
        { profile: { ...profile, name: 7 }, verdicts: null, savedAt: 5 },
        { profile: { name: 'Real model', components: ['user-chat'], exposure: 'internal', dataClass: 'internal' }, verdicts: { 'T01@user-chat': { status: 'applies', treatment: 'mitigate', owner: 'Dana' } } },
        'not a model',
      ]),
    );
  });
  await page.goto('/roadmap/?source=threat');
  // The well-formed model still produces its mitigate task.
  await expect(page.locator('.task-card').first()).toBeVisible();
  expect(errors).toEqual([]);
});
