import { expect, test } from '@playwright/test';

/**
 * The mapper's value is a promise about correctness: the tiers really are
 * cumulative, the control set does not change when you switch clouds (only the
 * service names do), and every control names a service for whichever provider
 * is selected. Those are the properties worth guarding.
 */

const URL = '/tools/ai-cloud-controls/';

async function counts(page: import('@playwright/test').Page): Promise<number> {
  return page.locator('.ac-control').count();
}

test('loads with a control set and no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto(URL);
  await expect(page.locator('h1')).toContainText('control mapper');
  expect(await counts(page)).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});

test('tiers are cumulative', async ({ page }) => {
  await page.goto(URL);

  await page.locator('input[name="tier"][value="answers"]').click();
  const answers = await counts(page);

  await page.locator('input[name="tier"][value="connects"]').click();
  const connects = await counts(page);

  await page.locator('input[name="tier"][value="acts"]').click();
  const acts = await counts(page);

  expect(connects).toBeGreaterThan(answers);
  expect(acts).toBeGreaterThan(connects);
  await expect(page.locator('.ac-inherited').first()).toBeVisible();
});

test('switching cloud keeps the controls and changes the services', async ({ page }) => {
  await page.goto(URL);
  await page.locator('input[name="tier"][value="acts"]').click();

  const objectives = async (): Promise<string[]> => page.locator('.ac-objective').allInnerTexts();
  const services = async (): Promise<string[]> => page.locator('.ac-service').allInnerTexts();

  await page.locator('input[name="provider"][value="aws"]').click();
  const awsObjectives = await objectives();
  const awsServices = await services();

  await page.locator('input[name="provider"][value="gcp"]').click();
  const gcpObjectives = await objectives();
  const gcpServices = await services();

  expect(gcpObjectives).toEqual(awsObjectives);
  expect(gcpServices).not.toEqual(awsServices);
  await expect(page.locator('.ac-count')).toContainText('Google Cloud');
});

test('every rendered control names a service and a reference', async ({ page }) => {
  await page.goto(URL);
  await page.locator('input[name="tier"][value="acts"]').click();

  const total = await counts(page);
  expect(await page.locator('.ac-service').count()).toBe(total);
  for (const text of await page.locator('.ac-service').allInnerTexts()) {
    expect(text.replace(/^service\s*/i, '').trim().length).toBeGreaterThan(8);
  }
  expect(await page.locator('.ac-ref').count()).toBeGreaterThanOrEqual(total);
});

test('phase filter narrows the set and clears back', async ({ page }) => {
  await page.goto(URL);
  await page.locator('input[name="tier"][value="acts"]').click();
  const all = await counts(page);

  await page.locator('input[name="phase"][value="foundational"]').click();
  const foundational = await counts(page);
  expect(foundational).toBeGreaterThan(0);
  expect(foundational).toBeLessThan(all);

  await page.locator('input[name="phase"][value="foundational"]').click();
  expect(await counts(page)).toBe(all);
});

test('marking a control done persists across a reload', async ({ page }) => {
  await page.goto(URL);
  const first = page.locator('.ac-done').first();
  await first.click();
  await expect(page.locator('.ac-control.is-done').first()).toBeVisible();

  await page.reload();
  await expect(page.locator('.ac-control.is-done').first()).toBeVisible();
  await expect(page.locator('.ac-count')).toContainText('1 marked in place');
});

test('is reachable from the tools index', async ({ page }) => {
  await page.goto('/tools/');
  const link = page.locator('a.sc-tool-cta[href="ai-cloud-controls/"]');
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.locator('h1')).toContainText('control mapper');
});

test('comparing shows all three clouds on the same control set', async ({ page }) => {
  await page.goto(URL);
  await page.locator('input[name="tier"][value="acts"]').click();

  await page.locator('input[name="provider"][value="aws"]').click();
  const single = await page.locator('.ac-objective').allInnerTexts();
  expect(await page.locator('.ac-compare').count()).toBe(0);

  await page.locator('input[name="provider"][value="compare"]').click();
  // Same objectives, same count, now with a three-column service block each.
  expect(await page.locator('.ac-objective').allInnerTexts()).toEqual(single);
  expect(await page.locator('.ac-compare').count()).toBe(single.length);
  expect(await page.locator('.ac-compare-cell').count()).toBe(single.length * 3);
  await expect(page.locator('.ac-count')).toContainText('side by side');

  // Each row names all three clouds, in provider order, with a non-empty service.
  // The labels are uppercased by CSS, so compare the underlying text.
  const firstRow = page.locator('.ac-compare').first();
  const labels = await firstRow.locator('dt').evaluateAll((nodes) => nodes.map((n) => n.textContent?.trim()));
  expect(labels).toEqual(['AWS', 'Azure', 'Google Cloud']);
  for (const service of await firstRow.locator('dd').allInnerTexts()) {
    expect(service.trim().length).toBeGreaterThan(8);
  }
});

test('the comparison choice survives a reload', async ({ page }) => {
  await page.goto(URL);
  await page.locator('input[name="provider"][value="compare"]').click();
  await page.reload();
  await expect(page.locator('input[name="provider"][value="compare"]')).toBeChecked();
  expect(await page.locator('.ac-compare').count()).toBeGreaterThan(0);
});

test('every reference chip deep-links into the framework translation it names', async ({ page }) => {
  await page.goto(URL);
  await page.locator('input[name="tier"][value="acts"]').click();

  const chips = page.locator('.ac-list .ac-ref');
  const count = await chips.count();
  expect(count).toBeGreaterThan(50);

  // Sample the four vocabularies rather than all of them: the unit test already
  // proves every code is published, this proves the link shape is right.
  const seen = new Set<string>();
  for (let i = 0; i < count; i++) {
    const chip = chips.nth(i);
    const code = (await chip.innerText()).trim();
    if (seen.has(code)) continue;
    seen.add(code);
    await expect(chip).toHaveAttribute('href', `../../frameworks/ai/?q=${encodeURIComponent(code)}`);
  }
  expect([...seen].some((code) => code.startsWith('AML.TA'))).toBe(true);
  expect([...seen].some((code) => code.startsWith('Clause'))).toBe(true);
});

test('a reference chip lands on the matching entry in the framework page', async ({ page }) => {
  await page.goto(URL);
  await page.locator('input[name="tier"][value="acts"]').click();
  const chip = page.locator('.ac-list .ac-ref', { hasText: 'AML.TA' }).first();
  const code = (await chip.innerText()).trim();
  await chip.click();
  await expect(page).toHaveURL(new RegExp(`frameworks/ai/\\?q=${code.replace('.', '\\.')}`));
  await expect(page.locator('#search')).toHaveValue(code);
  await expect(page.locator('.results')).toContainText(code);
});

test('the results section is a properly nested heading level', async ({ page }) => {
  await page.goto(URL);
  // h1 in the hero, h2 naming the results, h3 per layer. No skipped level.
  await expect(page.locator('main h2#result-head')).toBeVisible();
  const levels = await page.evaluate(() =>
    [...document.querySelectorAll('h1, h2, h3')].map((el) => Number(el.tagName[1])),
  );
  expect(levels[0]).toBe(1);
  for (let i = 1; i < levels.length; i++) {
    expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
  }
});

test('the risk tiering tool hands off into the mapper and back', async ({ page }) => {
  await page.goto('/tools/ai-risk/');
  await expect(page.locator('a[href="../ai-cloud-controls/"]')).toHaveCount(1);

  // Complete the tiering so the contextual handoff inside the result renders.
  for (const question of await page.locator('fieldset[data-question]').all()) {
    await question.locator('input[type="radio"]').first().check();
  }
  const handoff = page.locator('.rt-handoff a');
  await expect(handoff).toBeVisible();
  await handoff.click();
  await expect(page.locator('h1')).toContainText('control mapper');
  await expect(page.locator('a[href="../ai-risk/"]')).toHaveCount(1);
});

test('the AI frameworks page links into the mapper', async ({ page }) => {
  await page.goto('/frameworks/ai/');
  const link = page.locator('a[href="../../tools/ai-cloud-controls/"]');
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.locator('h1')).toContainText('control mapper');
});
