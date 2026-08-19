import { readFileSync } from 'node:fs';
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

test('the derived diagram appears with badges once the system is described', async ({ page }) => {
  await page.locator('.tm-check', { hasText: 'User-facing chat' }).click();
  await page.locator('.tm-check', { hasText: 'Retrieval over your documents' }).click();
  const diagram = page.locator('.tm-diagram svg');
  await expect(diagram).toBeVisible();
  await expect(diagram.locator('text', { hasText: 'Untrusted users' })).toBeVisible();
  await expect(diagram.locator('text', { hasText: 'Vector index' })).toBeVisible();
  // Badge totals agree with the candidate count promised in the hint.
  const badges = await diagram.locator('.tmd-badge').evaluateAll((els) => els.map((e) => Number(e.textContent)));
  const total = badges.reduce((sum, b) => sum + b, 0);
  await expect(page.locator('#tm-boundaries')).toContainText(`${total} candidate threats`);
});

test('residual re-rating shows inherent versus residual risk', async ({ page }) => {
  await page.locator('.tm-check', { hasText: 'User-facing chat' }).click();
  await page.locator('#tm-to-2').click();
  const card = page.locator('.tm-card', { hasText: 'Direct prompt injection' });
  await card.locator('button[data-verdict="applies"]').click();
  await page.locator('.tm-card', { hasText: 'Direct prompt injection' }).locator('.tm-scale-opt', { hasText: 'Likely' }).click();
  await page.locator('.tm-card', { hasText: 'Direct prompt injection' }).locator('.tm-scale-opt', { hasText: 'Severe' }).click();
  await page.locator('button[data-step-nav="3"]').click();
  await page.locator('[data-threat="T01"] button[data-treat="mitigate"]').click();
  const residual = page.locator('[data-threat="T01"] .tm-residual');
  await expect(residual).toContainText('After treatment');
  await residual.locator('.tm-scale-opt', { hasText: 'Rare' }).click();
  await page.locator('[data-threat="T01"] .tm-residual .tm-scale-opt', { hasText: 'Limited' }).click();
  await expect(page.locator('[data-threat="T01"] .tm-residual .tm-risk')).toHaveText('residual low');
  await page.locator('button[data-step-nav="4"]').click();
  await expect(page.locator('.tm-tile', { hasText: 'residual low' })).toContainText('1');
});

test('mitigate decisions flow into the roadmap as tasks', async ({ page }) => {
  await page.locator('#tm-name').fill('Handoff bot');
  await page.locator('.tm-check', { hasText: 'User-facing chat' }).click();
  await page.locator('#tm-to-2').click();
  const card = page.locator('.tm-card', { hasText: 'Direct prompt injection' });
  await card.locator('button[data-verdict="applies"]').click();
  await page.locator('.tm-card', { hasText: 'Direct prompt injection' }).locator('.tm-scale-opt', { hasText: 'Likely' }).click();
  await page.locator('.tm-card', { hasText: 'Direct prompt injection' }).locator('.tm-scale-opt', { hasText: 'Severe' }).click();
  await page.locator('button[data-step-nav="3"]').click();
  await page.locator('[data-threat="T01"] button[data-treat="mitigate"]').click();
  await page.locator('button[data-step-nav="4"]').click();
  await page.locator('a', { hasText: 'Send mitigations to the roadmap' }).click();
  await expect(page).toHaveURL(/\/roadmap\/\?source=threat$/);
  const taskCard = page.locator('.task-card, .plan-task, [class*=task]', { hasText: 'Mitigate T01' }).first();
  await expect(taskCard).toBeVisible();
  await expect(taskCard).toContainText('Direct prompt injection');
});

test('the Threat Dragon export downloads a valid v2 model', async ({ page }) => {
  await page.locator('#tm-name').fill('TD export bot');
  await page.locator('.tm-check', { hasText: 'User-facing chat' }).click();
  await page.locator('#tm-to-2').click();
  await page.locator('.tm-step', { hasText: 'good job' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#tm-td').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('td-export-bot-threat-dragon.json');
  const content = JSON.parse(readFileSync(await download.path(), 'utf8')) as {
    version: string;
    summary: { title: string };
    detail: { diagrams: { cells: { shape: string }[] }[] };
  };
  expect(content.version).toBe('2.3.0');
  expect(content.summary.title).toBe('TD export bot');
  expect(content.detail.diagrams[0].cells.some((c: { shape: string }) => c.shape === 'flow')).toBe(true);
});

test('the report downloads as a self-contained document', async ({ page }) => {
  await page.locator('#tm-name').fill('Report bot');
  await page.locator('.tm-check', { hasText: 'User-facing chat' }).click();
  await page.locator('#tm-to-2').click();
  const card = page.locator('.tm-card', { hasText: 'Direct prompt injection' });
  await card.locator('button[data-verdict="applies"]').click();
  await page.locator('.tm-card', { hasText: 'Direct prompt injection' }).locator('.tm-scale-opt', { hasText: 'Likely' }).click();
  await page.locator('.tm-card', { hasText: 'Direct prompt injection' }).locator('.tm-scale-opt', { hasText: 'Severe' }).click();
  await page.locator('.tm-step', { hasText: 'good job' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#tm-report').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('report-bot-threat-model-report.html');
  const html = readFileSync(await download.path(), 'utf8');
  expect(html).toContain('AI Threat Model: Report bot');
  expect(html).toContain('Executive summary');
  expect(html).toContain('<svg');
  expect(html).toContain('Threat register');
  expect(html).toContain('CRITICAL');
  expect(html).toContain('Open work in this model');
});

test('importing a Threat Dragon model brings topology and preserved threats', async ({ page }) => {
  await page.locator('#tm-import').setInputFiles('e2e/fixtures/td-sample.json');
  await expect(page.locator('#tm-import-status')).toContainText('Imported "Imported Support Bot"');
  await expect(page.locator('#tm-import-status')).toContainText('2 existing threats preserved');
  await expect(page.locator('#tm-name')).toHaveValue('Imported Support Bot');
  await expect(page.locator('#tm-canvas')).toBeVisible();
  await expect(page.locator('[data-node-id="cell-user"]')).toBeVisible();
  // Imported flows arrive unclassified: nothing is enumerated yet.
  await expect(page.locator('#tm-boundaries > .tm-hint')).toContainText('0 candidate threats');

  // Classify the chat flow and this library's threats appear alongside the
  // imported ones on step two.
  await page.locator('[data-flow-id="flow-1"]').click();
  await page.locator('#tm-flow-kind').selectOption('user-chat');
  await page.locator('#tm-to-2').click();
  await expect(page.locator('.tm-card', { hasText: 'Direct prompt injection' })).toBeVisible();
  await expect(page.locator('.tm-imported')).toHaveCount(2);
  await expect(page.locator('.tm-imported', { hasText: 'Session fixation' })).toBeVisible();
});

test('importing over a described model asks before replacing', async ({ page }) => {
  await page.locator('.tm-check', { hasText: 'User-facing chat' }).click();
  await page.locator('#tm-import').setInputFiles('e2e/fixtures/td-sample.json');
  await expect(page.locator('#tm-import-status')).toContainText('Replace the current model');
  await page.locator('#tm-import-confirm').click();
  await expect(page.locator('#tm-name')).toHaveValue('Imported Support Bot');
});

test('the privacy lens filters to LINDDUN threats and back', async ({ page }) => {
  await page.locator('.tm-check', { hasText: 'User-facing chat' }).click();
  await page.locator('input[name="dataClass"][value="confidential"]').click();
  await page.locator('#tm-to-2').click();
  const before = await page.locator('.tm-card').count();
  await expect(page.locator('.tm-linddun').first()).toBeVisible();
  await page.locator('#tm-lens').click();
  await expect(page.locator('#tm-lens')).toHaveAttribute('aria-pressed', 'true');
  const lensed = await page.locator('.tm-card').count();
  expect(lensed).toBeLessThan(before);
  await expect(page.locator('.tm-card', { hasText: 'linkable profile' })).toBeVisible();
  // Progress still counts everything: the lens hides nothing from the math.
  await expect(page.locator('#tm-progress')).toContainText(`of ${before} judged`);
  await page.locator('#tm-lens').click();
  await expect(page.locator('.tm-card')).toHaveCount(before);
});
