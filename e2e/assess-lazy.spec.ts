import { expect, test, type Page } from '@playwright/test';

/**
 * The assess page used to bundle all ten assessment datasets into its entry
 * chunk: 79.5 KB of its 96.6 KB gzipped, for a visitor who will open one.
 * They are now a chunk each, fetched on demand.
 *
 * The picker still prints every assessment's question count, which comes from
 * build-time metadata rather than from the datasets. tests/assessment-counts
 * proves those numbers are right; these prove the page does not secretly load
 * the datasets to get them.
 */

/** The card whose heading is exactly this assessment's name. */
function cardNamed(page: Page, name: string) {
  return page
    .locator('.assess-card')
    .filter({ has: page.getByRole('heading', { name, exact: true }) })
    .first();
}

/**
 * Total script bytes the page fetches, tracked from now on.
 *
 * Measured in bytes rather than by chunk name on purpose: the built names are
 * ambiguous (`assessment-BUpspwFd.js` is the scoring library at 3.8 KB, while
 * `assessment-DtUVbLpP.js` is the 44 KB ransomware dataset), and bytes are what
 * the change is actually about.
 */
function trackScriptBytes(page: Page): { total: () => Promise<number>; files: () => string[] } {
  const pending: Promise<number>[] = [];
  const files: string[] = [];
  page.on('response', (res) => {
    if (res.request().resourceType() !== 'script') return;
    pending.push(
      res
        .body()
        .then((b) => {
          files.push(`${res.url().split('/').pop()} (${(b.length / 1024).toFixed(1)}KB)`);
          return b.length;
        })
        .catch(() => 0),
    );
  });
  // Awaiting the bodies matters: reading a running total synchronously misses
  // responses whose body has not resolved yet, which made this budget pass even
  // against eager loading.
  return {
    total: async () => (await Promise.all(pending)).reduce((a, b) => a + b, 0),
    files: () => files,
  };
}

test('a first-time visitor downloads no assessment datasets', async ({ page }) => {
  const scripts = trackScriptBytes(page);
  await page.goto('/assess/');
  // All ten cards render, from metadata alone.
  await expect(page.locator('.assess-card')).toHaveCount(10);
  await expect(page.locator('.assess-card').first()).toBeVisible();
  // The ten datasets are ~330 KB uncompressed between them. Rendering the
  // picker must not pull any of them in.
  expect(await scripts.total(), `fetched: ${scripts.files().join(', ')}`).toBeLessThan(80_000);
});

test('the picker still shows a question count for every assessment', async ({ page }) => {
  await page.goto('/assess/');
  const subs = await page.locator('.assess-card .deck-sub').allInnerTexts();
  expect(subs).toHaveLength(10);
  for (const text of subs) {
    const match = /^(\d+) questions\./.exec(text.trim());
    expect(match, `card subtitle was "${text}"`).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThan(0);
  }
});

test('the counts on the cards match the real assessments', async ({ page }) => {
  await page.goto('/assess/');
  // Spot-check against counts the datasets themselves assert elsewhere.
  const expected: Record<string, number> = {
    'Ransomware readiness': 48,
    'CIS IG1 essentials': 56,
    'CIS Controls v8 (all safeguards)': 153,
    'NIST CSF 2.0': 106,
    'PCI DSS v4.0': 45,
  };
  for (const [name, count] of Object.entries(expected)) {
    // Match the card heading, not the card text: several blurbs mention other
    // frameworks by name, so hasText would pick the wrong card.
    const card = cardNamed(page, name);
    await expect(card.locator('.deck-sub')).toContainText(`${count} questions.`);
  }
});

test('opening an assessment fetches its questions and renders them', async ({ page }) => {
  const scripts = trackScriptBytes(page);
  await page.goto('/assess/');
  const beforeOpen = await scripts.total();
  const card = cardNamed(page, 'Ransomware readiness');
  await card.getByRole('button', { name: /^Start$|^Resume$/ }).click();

  await expect(page.locator('.assess-q').first()).toBeVisible();
  await expect(page.locator('.assess-q')).toHaveCount(48);
  // Opening it is what pulls the dataset down.
  expect(await scripts.total()).toBeGreaterThan(beforeOpen);
});

test('a generated assessment loads its source frameworks on demand', async ({ page }) => {
  await page.goto('/assess/');
  // CIS IG1 is built from cis.json + cis-igs.json rather than read from a file.
  const card = cardNamed(page, 'CIS IG1 essentials');
  await card.getByRole('button', { name: /^Start$|^Resume$/ }).click();
  await expect(page.locator('.assess-q').first()).toBeVisible();
  await expect(page.locator('.assess-q')).toHaveCount(56);
});

test('a returning visitor sees their score, and only their dataset loads', async ({ page }) => {
  // Answer one question, then reload as a returning visitor.
  await page.goto('/assess/');
  const card = cardNamed(page, 'Ransomware readiness');
  await card.getByRole('button', { name: /^Start$|^Resume$/ }).click();
  await page.locator('.assess-q').first().waitFor();
  await page.locator('.assess-row').first().locator('.yesno-btn', { hasText: 'Yes' }).click();

  const scripts = trackScriptBytes(page);
  await page.goto('/assess/');
  const resumed = cardNamed(page, 'Ransomware readiness');
  // Its posture strip now shows a real score rather than "not started".
  await expect(resumed.locator('.posture-strip')).not.toContainText('not started');
  await expect(resumed.getByRole('button', { name: 'Resume' })).toBeVisible();

  // Untouched assessments still say so, and nine datasets stayed on the server.
  const untouched = cardNamed(page, 'PCI DSS v4.0');
  await expect(untouched.locator('.posture-strip')).toContainText('not started');
  // One dataset came down to score the started assessment. The other nine did
  // not: all ten would be roughly 330 KB.
  expect(await scripts.total(), `fetched: ${scripts.files().join(', ')}`).toBeLessThan(130_000);
});

test('the assess entry chunk stays under budget', async ({ page }) => {
  await page.goto('/assess/');
  const assets = await page.evaluate(() =>
    [...document.querySelectorAll('script[src], link[rel="modulepreload"], link[rel="stylesheet"]')]
      .map((n) => n.getAttribute('src') ?? n.getAttribute('href') ?? '')
      .filter((h) => h && !h.startsWith('http')),
  );
  let total = 0;
  for (const asset of assets) {
    total += (await (await page.request.get(new URL(asset, page.url()).href)).body()).length;
  }
  // Uncompressed. This was ~330 KB when all ten datasets were in the entry.
  expect(total).toBeLessThan(120_000);
});
