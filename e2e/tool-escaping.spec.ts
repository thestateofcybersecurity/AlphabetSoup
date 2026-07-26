import { expect, test } from '@playwright/test';

/**
 * Regression guard for attribute-context escaping in the tools.
 *
 * The tools build markup with template literals. The original esc() helper used
 * the textContent/innerHTML round trip, which per the HTML spec escapes & < >
 * but NOT quotes, so any user value interpolated into a quoted attribute could
 * close the attribute early and inject new ones. escAttr() fixes that.
 *
 * These specs type a quote-bearing payload through the real UI, force the
 * re-render that reinjects the value, and assert no attribute breakout. They
 * also assert the payload survives intact as data, so escaping cannot be
 * "fixed" by silently stripping the user's input.
 */

const PAYLOAD = '" data-pwned="yes';

test('skills matrix does not allow attribute injection via a member name', async ({ page }) => {
  await page.goto('/tools/skills-matrix/');

  const firstName = page.locator('#matrix tbody tr input[type="text"]').first();
  await firstName.fill(PAYLOAD);

  // Adding a member re-renders the whole matrix, reinterpolating the name.
  await page.locator('#add-member').click();

  await expect(page.locator('[data-pwned]')).toHaveCount(0);
  await expect(page.locator('#matrix tbody tr input[type="text"]').first()).toHaveValue(PAYLOAD);
});

test('automation ROI ranker does not allow attribute injection via a task name', async ({ page }) => {
  await page.goto('/tools/automation-roi/');

  const firstTask = page.locator('.ar-row input[data-field="name"]').first();
  await firstTask.fill(PAYLOAD);

  // Adding a row re-renders every row from state.
  await page.locator('#add-row').click();

  await expect(page.locator('[data-pwned]')).toHaveCount(0);
  await expect(page.locator('.ar-row input[data-field="name"]').first()).toHaveValue(PAYLOAD);
});

test('runbook generator does not allow attribute injection via the org profile', async ({ page }) => {
  await page.goto('/tools/runbook/');

  await page.locator('#rb-org').fill(PAYLOAD);
  // Switching scenario re-renders the profile inputs from stored state.
  await page.locator('.rb-scenario-opt').nth(1).click();

  await expect(page.locator('[data-pwned]')).toHaveCount(0);
  await expect(page.locator('#rb-org')).toHaveValue(PAYLOAD);
});

test('a hostile value already in localStorage cannot inject on load', async ({ page }) => {
  // Simulate a tampered/shared browser: state is poisoned before the tool boots.
  await page.goto('/tools/skills-matrix/');
  await page.evaluate((payload) => {
    localStorage.setItem(
      'alphabetsoup:skills-matrix:state',
      JSON.stringify({
        members: [{ id: '" onload="1', name: payload, ratings: {} }],
        priorities: [],
      }),
    );
  }, PAYLOAD);
  await page.reload();

  await expect(page.locator('[data-pwned]')).toHaveCount(0);
  await expect(page.locator('[onload]')).toHaveCount(0);
});
