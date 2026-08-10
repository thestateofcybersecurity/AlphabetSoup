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
