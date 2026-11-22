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

/**
 * Pentest 2026-10-07, finding M1. The AI Threat Modeler interpolates node
 * and flow ids, verdict keys, and verdict status into innerHTML attributes.
 * Those values come from imported Threat Dragon files, the stored draft, the
 * saved-models list, and backups restored through /my/, so a poisoned
 * localStorage must boot the tool without executing anything.
 */
const POC_ID = 'x"><img src=x onerror="document.documentElement.setAttribute(\'data-poc\',\'fired\')">';
const POC_STATUS = '" data-pwned="yes';

test('a poisoned AI Threat Modeler draft cannot inject through diagram ids on load', async ({ page }) => {
  await page.goto('/tools/ai-threat-model/');
  await page.evaluate((id) => {
    const profile = {
      name: 'PoC',
      components: [],
      exposure: 'internal',
      dataClass: 'internal',
      graph: {
        nodes: [
          { id, kind: 'process', label: 'node', sub: '', zone: 'app', x: 300, y: 100 },
          { id: 'ok', kind: 'store', label: 'store', sub: '', zone: 'outside', x: 480, y: 100 },
        ],
        flows: [{ id: '" onload="x', from: id, to: 'ok', kind: 'plain', label: 'flow' }],
      },
    };
    localStorage.setItem('alphabetsoup:ai-threat:draft', JSON.stringify({ profile, verdicts: {} }));
    localStorage.setItem('alphabetsoup:ai-threat:models', JSON.stringify([{ profile, verdicts: {}, savedAt: '2026-10-07T00:00:00.000Z' }]));
  }, POC_ID);
  await page.reload();

  await expect(page.locator('#tm-canvas')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-poc'))).toBeNull();
  await expect(page.locator('#tm-canvas-wrap img')).toHaveCount(0);
  await expect(page.locator('[onerror], [onload], [data-pwned]')).toHaveCount(0);
  // The graph survived: both nodes and the flow render, under selector-safe ids.
  await expect(page.locator('.tmd-node')).toHaveCount(2);
  await expect(page.locator('.tmd-flow')).toHaveCount(1);
  for (const id of await page.locator('.tmd-node').evaluateAll((els) => els.map((e) => e.getAttribute('data-node-id')))) {
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  }
  expect(await page.locator('.tmd-flow').getAttribute('data-flow-id')).toMatch(/^[A-Za-z0-9_-]+$/);
});

test('a poisoned verdict status cannot inject through the card and register markup', async ({ page }) => {
  await page.goto('/tools/ai-threat-model/');
  await page.evaluate((status) => {
    localStorage.setItem(
      'alphabetsoup:ai-threat:draft',
      JSON.stringify({
        profile: { name: 'PoC', components: ['user-chat'], exposure: 'internal', dataClass: 'internal' },
        verdicts: {
          'T01@user-chat': { status, treatment: status, note: 'kept' },
          ['T02@user-chat' + status]: { status: 'applies' },
        },
      }),
    );
  }, POC_STATUS);
  await page.reload();

  await page.locator('button[data-step="2"]').click();
  await expect(page.locator('.tm-card').first()).toBeVisible();
  await expect(page.locator('[data-pwned]')).toHaveCount(0);
  // The bad status fell back to unreviewed instead of landing in a class.
  const first = page.locator('.tm-card[data-key="T01@user-chat"]');
  await expect(first).toHaveCount(1);
  await expect(first).toHaveClass(/^tm-card$/);

  await page.locator('button[data-step="4"]').click();
  await expect(page.locator('.tm-table')).toBeVisible();
  await expect(page.locator('[data-pwned]')).toHaveCount(0);
  await expect(page.locator('.tm-table tbody tr').first()).toHaveClass(/^tm-row-unreviewed$/);
});

test('importing a poisoned Threat Dragon file cannot inject through cell ids', async ({ page }) => {
  await page.goto('/tools/ai-threat-model/');
  await page.locator('#tm-import').setInputFiles('e2e/fixtures/td-poisoned.json');
  await expect(page.locator('#tm-import-status')).toContainText('Imported "Poisoned model"');
  await expect(page.locator('#tm-canvas')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-poc'))).toBeNull();
  await expect(page.locator('#tm-canvas-wrap img')).toHaveCount(0);
  await expect(page.locator('[onerror], [onload]')).toHaveCount(0);
  await expect(page.locator('.tmd-node')).toHaveCount(3);
  await expect(page.locator('.tmd-flow')).toHaveCount(2);
});

/**
 * Pentest 2026-11-22, finding N1. The October fix made ids and enums safe, but
 * the tool's free-text fields still went into value="..." through a text-only
 * escaper, so a double quote closed the attribute: `" autofocus onfocus="..."`
 * ran script on load. The values arrive from an imported Threat Dragon file
 * (summary.title becomes the system name), a stored draft, a saved model, and
 * a backup restored through /my/.
 */
const QUOTE_BREAKOUT = '" autofocus onfocus="document.documentElement.setAttribute(\'data-poc\',\'fired\')" data-pwned="yes';

async function expectNoBreakout(page: import('@playwright/test').Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-poc'))).toBeNull();
  await expect(page.locator('[data-pwned], [onfocus], [onerror], [onload]')).toHaveCount(0);
}

test('importing a Threat Dragon file with quotes in its title, owner, and reviewer cannot inject', async ({ page }) => {
  await page.goto('/tools/ai-threat-model/');
  await page.locator('#tm-import').setInputFiles('e2e/fixtures/td-quoted-title.json');
  await expect(page.locator('#tm-import-status')).toContainText('Imported');
  await expect(page.locator('#tm-canvas')).toBeVisible();
  await expectNoBreakout(page);
  // The values survive intact as data: escaping, not stripping.
  await expect(page.locator('#tm-name')).toHaveValue(/^Vendor model" autofocus onfocus=/);
  await expect(page.locator('#tm-owner-field')).toHaveValue('Owner" data-pwned="owner');
  await expect(page.locator('#tm-reviewer-field')).toHaveValue('Reviewer" data-pwned="reviewer');
  await expect(page.locator('#tm-name')).not.toHaveAttribute('autofocus', /.*/);

  // Selecting the imported node renders its label into the node editor.
  await page.locator('.tmd-node').first().click();
  await expect(page.locator('#tm-node-label')).toHaveValue('Customer" data-pwned="label');
  await expectNoBreakout(page);

  // The payload is persisted in the draft, so it must stay inert on the next visit too.
  await page.reload();
  await expect(page.locator('#tm-name')).toHaveValue(/^Vendor model" autofocus onfocus=/);
  await expectNoBreakout(page);
});

test('a poisoned draft cannot inject through the name, owner, reviewer, note, or verdict owner', async ({ page }) => {
  await page.goto('/tools/ai-threat-model/');
  await page.evaluate((payload) => {
    localStorage.setItem(
      'alphabetsoup:ai-threat:draft',
      JSON.stringify({
        profile: { name: payload, owner: payload, reviewer: payload, components: ['user-chat'], exposure: 'internal', dataClass: 'internal' },
        verdicts: {
          'T01@user-chat': { status: 'applies', owner: payload, treatment: 'mitigate' },
          'T02@user-chat': { status: 'mitigated', note: payload },
        },
      }),
    );
  }, QUOTE_BREAKOUT);
  await page.reload();

  await expect(page.locator('#tm-name')).toHaveValue(QUOTE_BREAKOUT);
  await expect(page.locator('#tm-owner-field')).toHaveValue(QUOTE_BREAKOUT);
  await expect(page.locator('#tm-reviewer-field')).toHaveValue(QUOTE_BREAKOUT);
  await expectNoBreakout(page);

  await page.locator('button[data-step="2"]').click();
  await expect(page.locator('.tm-note').first()).toHaveValue(QUOTE_BREAKOUT);
  await expectNoBreakout(page);

  await page.locator('button[data-step="3"]').click();
  await expect(page.locator('.tm-owner').first()).toHaveValue(QUOTE_BREAKOUT);
  await expectNoBreakout(page);

  await page.locator('button[data-step="4"]').click();
  await expect(page.locator('.tm-table')).toBeVisible();
  await expectNoBreakout(page);
});
