import { expect, test } from '@playwright/test';

/**
 * The canvas editor: seeded from the quick answers, still question-first
 * (an unclassified flow carries nothing), with per-flow enumeration so two
 * retrieval stores mean two sets of retrieval threats.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/tools/ai-threat-model/');
});

test('the canvas seeds from the quick answers and keeps the same candidates', async ({ page }) => {
  await page.locator('.tm-check', { hasText: 'User-facing chat' }).click();
  await page.locator('.tm-check', { hasText: 'Retrieval over your documents' }).click();
  // The badge tooltips also say "candidate threats", so read the hint alone.
  const promised = await page.locator('#tm-boundaries > .tm-hint').textContent();
  const count = /(\d+) candidate threats/.exec(promised ?? '')?.[1];
  expect(Number(count)).toBeGreaterThan(0);
  await page.locator('#tm-mode-canvas').click();
  await expect(page.locator('#tm-canvas')).toBeVisible();
  for (const id of ['users', 'app', 'index']) {
    await expect(page.locator(`[data-node-id="${id}"]`)).toBeVisible();
  }
  // Same enumeration either way: the canvas is a view, not a different model.
  await expect(page.locator('#tm-boundaries > .tm-hint')).toContainText(`${count} candidate threats`);
});

test('connecting and classifying a new flow surfaces its threats', async ({ page }) => {
  await page.locator('.tm-check', { hasText: 'User-facing chat' }).click();
  await page.locator('#tm-mode-canvas').click();

  await page.locator('button[data-add="store"]').click();
  const newNode = page.locator('.tmd-node').last();
  await expect(newNode).toBeVisible();
  await page.locator('#tm-node-label').fill('Customer KB');

  await page.locator('#tm-connect').click();
  await newNode.click();
  await page.locator('[data-node-id="app"]').click();
  // The new flow is selected and unclassified: it carries no threats yet.
  await expect(page.locator('#tm-props')).toContainText('Unclassified flows carry no threats');

  await page.locator('#tm-flow-kind').selectOption('rag');
  await expect(page.locator('#tm-props')).toContainText('candidate threats attach to this flow');

  await page.locator('#tm-to-2').click();
  await expect(page.locator('.tm-card', { hasText: 'Indirect prompt injection' })).toHaveCount(1);
});

test('two retrieval flows mean two independently judged sets of threats', async ({ page }) => {
  await page.locator('.tm-check', { hasText: 'User-facing chat' }).click();
  await page.locator('.tm-check', { hasText: 'Retrieval over your documents' }).click();
  await page.locator('#tm-mode-canvas').click();

  await page.locator('button[data-add="store"]').click();
  await page.locator('#tm-node-label').fill('Second KB');
  await page.locator('#tm-connect').click();
  await page.locator('.tmd-node').last().click();
  await page.locator('[data-node-id="app"]').click();
  await page.locator('#tm-flow-kind').selectOption('rag');

  await page.locator('#tm-to-2').click();
  const t07 = page.locator('[data-threat="T07"]');
  await expect(t07).toHaveCount(2);
  // Judging one leaves the other unreviewed: instances are independent.
  await t07.first().locator('button[data-verdict="not-applicable"]').click();
  await expect(page.locator('[data-threat="T07"].tm-not-applicable')).toHaveCount(1);
});

test('dragging an element into another column changes its trust zone', async ({ page }) => {
  await page.locator('.tm-check', { hasText: 'User-facing chat' }).click();
  await page.locator('.tm-check', { hasText: 'Retrieval over your documents' }).click();
  await page.locator('#tm-mode-canvas').click();

  const node = page.locator('[data-node-id="index"]');
  const box = (await node.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 340, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.locator('[data-node-id="index"]').click();
  await expect(page.locator('#tm-props')).toContainText('Outside your control');
});

test('the canvas stays out of the way on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/tools/ai-threat-model/');
  await expect(page.locator('#tm-mode-canvas')).toBeHidden();
  await expect(page.locator('#tm-quick')).toBeVisible();
});
