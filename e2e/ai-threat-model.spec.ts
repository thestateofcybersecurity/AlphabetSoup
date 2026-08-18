import { expect, test } from '@playwright/test';

/**
 * The AI Threat Modeler must ask before it answers: no candidate threats until
 * the system is described, every proposal carries its reason, ratings are the
 * user's judgment on anchored scales, and the review step is honest about
 * incomplete work.
 */

test.beforeEach(async ({ page }) => {
  await page.goto('/tools/ai-threat-model/');
});

test('proposes nothing before the system is described', async ({ page }) => {
  // Step one is current; later steps are locked while nothing is selected.
  await expect(page.locator('.tm-step.current')).toContainText('What are we building?');
  for (const label of ['What can go wrong?', 'Did we do a good job?']) {
    await expect(page.locator('.tm-step', { hasText: label })).toBeDisabled();
  }
  await expect(page.locator('.tm-card')).toHaveCount(0);
  await expect(page.locator('#tm-to-2')).toBeDisabled();
  await expect(page.locator('#tm-boundaries')).toContainText('trust boundaries of your system appear here');
});

test('describing the system unlocks enumeration, with reasons attached', async ({ page }) => {
  await page.locator('.tm-check', { hasText: 'User-facing chat' }).click();
  await page.locator('.tm-check', { hasText: 'Retrieval over your documents' }).click();
  await expect(page.locator('#tm-boundaries')).toContainText('Untrusted user to application');
  await expect(page.locator('#tm-boundaries')).toContainText('Corpus and index to prompt');

  await page.locator('#tm-to-2').click();
  await expect(page.locator('.tm-step.current')).toContainText('What can go wrong?');
  const cards = page.locator('.tm-card');
  expect(await cards.count()).toBeGreaterThan(4);
  // Every card explains which answer surfaced it, and proposes rather than concludes.
  await expect(cards.first().locator('.tm-because')).toContainText('Proposed because');
  await expect(page.locator('#tm-progress')).toContainText('0 of');
  // No agent threats: the system has no agent.
  await expect(page.locator('.tm-card', { hasText: 'Excessive agency' })).toHaveCount(0);
});

test('rating is the user judgment on anchored scales', async ({ page }) => {
  await page.locator('.tm-check', { hasText: 'User-facing chat' }).click();
  await page.locator('#tm-to-2').click();
  const card = page.locator('.tm-card', { hasText: 'Direct prompt injection' });
  await expect(card.locator('.tm-risk')).toHaveCount(0);
  await card.locator('button[data-verdict="applies"]').click();
  const applied = page.locator('.tm-card', { hasText: 'Direct prompt injection' });
  // No risk verdict until both anchors are chosen by the user.
  await expect(applied).toContainText('Pick both scales');
  await applied.locator('.tm-scale-opt', { hasText: 'Likely' }).click();
  await page.locator('.tm-card', { hasText: 'Direct prompt injection' }).locator('.tm-scale-opt', { hasText: 'Severe' }).click();
  await expect(page.locator('.tm-card', { hasText: 'Direct prompt injection' }).locator('.tm-risk')).toHaveText('critical');
});

test('the review step is honest about incomplete work', async ({ page }) => {
  await page.locator('.tm-check', { hasText: 'User-facing chat' }).click();
  await page.locator('#tm-to-2').click();
  await page.locator('.tm-card', { hasText: 'Direct prompt injection' }).locator('button[data-verdict="applies"]').click();
  await page.locator('.tm-step', { hasText: 'Did we do a good job?' }).click();
  const warnings = page.locator('.tm-warnings');
  await expect(warnings).toContainText('have not been judged yet');
  await expect(warnings).toContainText('no likelihood or impact rating');
  await expect(warnings).toContainText('no treatment decision');
  // The register lists every candidate, including the unreviewed ones.
  await expect(page.locator('.tm-table tbody tr').first()).toBeVisible();
  await expect(page.locator('#tm-csv')).toBeVisible();
});

test('the draft survives a reload', async ({ page }) => {
  await page.locator('.tm-check', { hasText: 'Agent that calls tools' }).click();
  await page.locator('#tm-name').fill('Ops agent');
  await page.reload();
  await expect(page.locator('#tm-name')).toHaveValue('Ops agent');
  await expect(page.locator('.tm-check', { hasText: 'Agent that calls tools' }).locator('input')).toBeChecked();
  await expect(page.locator('#tm-to-2')).toBeEnabled();
});
