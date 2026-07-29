import { expect, test, type Page } from '@playwright/test';

/**
 * The generator's output is a document someone may hand to an assessor, so the
 * properties worth guarding are honesty ones: coverage must never read as 100%
 * for a framework only partly mapped, an excluded policy must say why it was
 * excluded, and no placeholder may survive into the rendered text.
 */

const URL = '/tools/policy-generator/';

async function setProfile(page: Page, values: Record<string, string | boolean>): Promise<void> {
  for (const [id, value] of Object.entries(values)) {
    const el = page.locator(`#${id}`);
    if (typeof value === 'boolean') {
      if ((await el.isChecked()) !== value) await el.click();
    } else {
      await el.selectOption(value).catch(async () => {
        await el.fill(value);
      });
    }
  }
}

test('generates a full policy set on first load', async ({ page }) => {
  await page.goto(URL);
  const policies = page.locator('.pg-policy');
  // 24 domains, minus secure development, which defaults off.
  expect(await policies.count()).toBeGreaterThanOrEqual(20);
  await expect(page.locator('#pg-tierline')).toContainText(/policies/);
});

test('tailors the text with the organization name', async ({ page }) => {
  await page.goto(URL);
  await page.fill('#orgName', 'Acme Ltd');
  await page.fill('#policyOwner', 'the CISO');
  await page.locator('.pg-policy').first().click();
  const body = await page.locator('.pg-policy').first().innerText();
  expect(body).toContain('Acme Ltd');
  expect(body).toContain('the CISO');
});

test('leaves no unsubstituted placeholder anywhere', async ({ page }) => {
  await page.goto(URL);
  await page.fill('#orgName', 'Acme Ltd');
  // Open every policy so all text is in the DOM.
  await page.evaluate(() =>
    document.querySelectorAll<HTMLDetailsElement>('.pg-policy').forEach((d) => (d.open = true)),
  );
  const text = await page.locator('main').innerText();
  expect(text).not.toContain('{{');
});

test('falls back to readable defaults when the profile is blank', async ({ page }) => {
  await page.goto(URL);
  await page.evaluate(() =>
    document.querySelectorAll<HTMLDetailsElement>('.pg-policy').forEach((d) => (d.open = true)),
  );
  const text = await page.locator('main').innerText();
  expect(text).toContain('the organization');
  expect(text).not.toContain('{{');
});

test('derives a higher tier when regulated data is held', async ({ page }) => {
  await page.goto(URL);
  await setProfile(page, { size: 'small' });
  await expect(page.locator('#pg-tierline')).toContainText('IG1');
  await setProfile(page, { cardData: true });
  // An obligation does not scale down with the organization holding it.
  await expect(page.locator('#pg-tierline')).not.toContainText('IG1');
});

test('adds requirements as the tier rises', async ({ page }) => {
  await page.goto(URL);
  await page.locator('#tier').selectOption('ig1');
  const at1 = await page.locator('.pg-policy').first().locator('.pg-count').innerText();
  await page.locator('#tier').selectOption('ig3');
  const at3 = await page.locator('.pg-policy').first().locator('.pg-count').innerText();
  expect(parseInt(at3, 10)).toBeGreaterThan(parseInt(at1, 10));
});

test('never claims full coverage of a framework it only partly maps', async ({ page }) => {
  await page.goto(URL);
  await setProfile(page, { buildsSoftware: true, hasOffices: true });
  const rows = await page.locator('.pg-cov tbody tr').allInnerTexts();
  const csf = rows.find((r) => /NIST CSF/.test(r))!;
  // The catalog reaches all 99 mapped subcategories, but CSF has 106.
  expect(csf).toContain('99 of 106');
  expect(csf).not.toContain('100%');
});

test('shows no percentage where the true denominator is unknown', async ({ page }) => {
  await page.goto(URL);
  // SOC 2 criteria are not enumerated on this site, so no honest denominator
  // exists. Rendering 100% off the mapped subset is the overclaim to avoid.
  const soc2 = page.locator('.pg-cov tbody tr').filter({ hasText: 'SOC 2' });
  await expect(soc2).toContainText('not measured');
  await expect(soc2).not.toContainText('%');
});

test('measures ISO against all 93 Annex A controls', async ({ page }) => {
  await page.goto(URL);
  await setProfile(page, { buildsSoftware: true, hasOffices: true });
  const iso = page.locator('.pg-cov tbody tr').filter({ hasText: 'ISO' });
  // 78 of 93 mapped, so this must read 84% rather than 100%.
  await expect(iso).toContainText('78 of 93');
  await expect(iso).toContainText('84%');
});

test('states why a policy was excluded rather than dropping it silently', async ({ page }) => {
  await page.goto(URL);
  await setProfile(page, { buildsSoftware: false });
  const excluded = page.locator('#pg-excluded');
  await expect(excluded).toContainText('Secure Development Policy');
  await expect(excluded).toContainText(/does not develop/i);
});

test('reduces physical scope and says where it went', async ({ page }) => {
  await page.goto(URL);
  await setProfile(page, { hasOffices: false });
  await expect(page.locator('#pg-excluded')).toContainText(/Physical and Environmental/);
  await expect(page.locator('#pg-excluded')).toContainText(/Endpoint|Asset/);
});

test('includes secure development once the organization builds software', async ({ page }) => {
  await page.goto(URL);
  await setProfile(page, { buildsSoftware: true });
  await expect(page.locator('#pg-excluded')).not.toContainText('Secure Development');
  await expect(page.locator('.pg-policy').filter({ hasText: 'Secure Development' })).toHaveCount(1);
});

test('warns that a policy is not evidence of effectiveness', async ({ page }) => {
  await page.goto(URL);
  await expect(page.locator('#pg-caveat')).toContainText(/not evidence that the control operates/i);
});

test('downloads the full set as markdown', async ({ page }) => {
  await page.goto(URL);
  await page.fill('#orgName', 'Acme Ltd');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /download the full set/i }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('acme-ltd-policy-set.md');
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const md = Buffer.concat(chunks).toString('utf8');
  expect(md).toContain('# Information security policy set');
  expect(md).toContain('Acme Ltd');
  expect(md).toContain('## Framework coverage');
  expect(md).not.toContain('{{');
});

test('downloads a single policy', async ({ page }) => {
  await page.goto(URL);
  const first = page.locator('.pg-policy').first();
  await first.click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    first.getByRole('button', { name: /download this policy/i }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.md$/);
});

test('remembers the profile across a reload', async ({ page }) => {
  await page.goto(URL);
  await page.fill('#orgName', 'Persisted Ltd');
  await setProfile(page, { cardData: true });
  await page.reload();
  await expect(page.locator('#orgName')).toHaveValue('Persisted Ltd');
  await expect(page.locator('#cardData')).toBeChecked();
});

test('reset returns the form to defaults', async ({ page }) => {
  await page.goto(URL);
  await page.fill('#orgName', 'Temporary Ltd');
  await page.getByRole('button', { name: /^reset$/i }).click();
  await expect(page.locator('#orgName')).toHaveValue('');
});

test('is reachable from the tools index and links onward to the crosswalk', async ({ page }) => {
  await page.goto('/tools/');
  await expect(page.locator('a[href="policy-generator/"]')).toHaveCount(1);
  await page.goto(URL);
  await expect(page.locator('a[href="../crosswalk/"]')).toHaveCount(1);
});
