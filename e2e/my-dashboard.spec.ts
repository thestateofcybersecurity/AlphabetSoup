import { expect, test, type Page } from '@playwright/test';

/**
 * The dashboard reads back everything the site has saved in this browser.
 *
 * The properties that matter are that it shows *all* of it (including keys it
 * has no label for), that erase really removes it, and that restore cannot be
 * used to write outside this site's own storage.
 */

const PREFIX = 'alphabetsoup:';

async function seed(page: Page, entries: Record<string, string>): Promise<void> {
  await page.goto('/my/');
  await page.evaluate((data) => {
    for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v);
  }, entries);
  await page.reload();
}

const QUIZ = JSON.stringify({
  cissp: { attempts: 3, best: 80, missed: { a: 1, b: 1 } },
  ceh: { attempts: 1, best: 60, missed: {} },
});
const HISTORY = JSON.stringify([
  { date: '2026-07-01', overall: 40 },
  { date: '2026-07-20', overall: 55 },
]);

test('shows an empty state, and no destructive buttons, with nothing stored', async ({ page }) => {
  await page.goto('/my/');
  await expect(page.locator('.my-empty .big')).toHaveText('Nothing saved yet.');
  // Nothing to export or erase, so those controls stay out of the way.
  await expect(page.locator('#my-actions')).toBeHidden();
  // Scoped to the empty state: the page footer also links to the quiz.
  await expect(page.locator('.my-empty').getByRole('link', { name: 'Take a quiz' })).toBeVisible();
});

test('summarises quiz progress', async ({ page }) => {
  await seed(page, { [`${PREFIX}quiz`]: QUIZ });
  const stats = page.locator('.my-stat');
  await expect(stats.filter({ hasText: 'decks started' })).toContainText('2');
  await expect(stats.filter({ hasText: 'rounds played' })).toContainText('4');
  await expect(stats.filter({ hasText: 'average best' })).toContainText('70%');
  await expect(stats.filter({ hasText: 'to review' })).toContainText('2');
});

test('shows assessment scores and the trend, without loading any dataset', async ({ page }) => {
  const scripts: string[] = [];
  page.on('request', (r) => {
    if (r.resourceType() === 'script') scripts.push(r.url().split('/').pop() ?? '');
  });
  await seed(page, { [`${PREFIX}assessment-history:cpg`]: HISTORY });

  await expect(page.locator('.score-row')).toContainText('55%');
  await expect(page.locator('.trend-up')).toContainText('15 pts');
  // The scores come from stored snapshots. Pulling the ~330 KB of assessment
  // datasets in to recompute them would undo the lazy loading.
  const heavy = scripts.filter((n) => /^(assessment-|cis-|nist-csf-)/.test(n));
  expect(heavy, `unexpected dataset chunks: ${heavy.join(', ')}`).toEqual([]);
});

test('lists stored keys by section with links back into the work', async ({ page }) => {
  await seed(page, {
    [`${PREFIX}quiz`]: QUIZ,
    [`${PREFIX}assessment:cpg`]: '{"q1":"yes"}',
    [`${PREFIX}roadmap:csf`]: '[]',
    [`${PREFIX}skills-matrix:state`]: '{}',
  });
  // innerText reflects the CSS uppercase transform, so match case-insensitively.
  const headings = (await page.locator('.my-h2').allInnerTexts()).join(' ');
  for (const section of ['Quiz', 'Assessments', 'Roadmap', 'Tools']) {
    expect(headings, section).toMatch(new RegExp(section, 'i'));
  }

  // A tool key is recognised and linked, using the build-time tool list.
  const toolRow = page.locator('.my-row').filter({ hasText: 'Skills matrix' });
  await expect(toolRow.locator('a')).toHaveAttribute('href', '../tools/skills-matrix/');
});

test('surfaces a key it has no label for rather than hiding it', async ({ page }) => {
  await seed(page, { [`${PREFIX}some-future-feature`]: '{"x":1}' });
  // The dangerous failure would be data that exists but is invisible, because
  // then "erase everything" silently lies.
  await expect(page.locator('.my-h2')).toContainText('Other saved data');
  await expect(page.locator('.my-row')).toContainText('some-future-feature');
});

test('ignores another origin’s keys entirely', async ({ page }) => {
  await seed(page, { 'someone-else:token': 'secret', [`${PREFIX}quiz`]: QUIZ });
  const body = await page.locator('main').innerText();
  expect(body).not.toContain('someone-else');
  expect(body).not.toContain('secret');
});

test('erase removes everything this site stored, and nothing else', async ({ page }) => {
  await seed(page, {
    [`${PREFIX}quiz`]: QUIZ,
    [`${PREFIX}roadmap:csf`]: '[]',
    [`${PREFIX}mystery`]: 'x',
    'other-app:keep': 'untouched',
  });
  page.on('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: /erase everything/i }).click();

  await expect(page.locator('.my-empty .big')).toHaveText('Nothing saved yet.');
  const after = await page.evaluate(() => ({
    ours: Object.keys(localStorage).filter((k) => k.startsWith('alphabetsoup:')),
    theirs: localStorage.getItem('other-app:keep'),
  }));
  expect(after.ours).toEqual([]);
  expect(after.theirs).toBe('untouched');
});

test('erase can be cancelled', async ({ page }) => {
  await seed(page, { [`${PREFIX}quiz`]: QUIZ });
  page.on('dialog', (d) => void d.dismiss());
  await page.getByRole('button', { name: /erase everything/i }).click();
  await expect(page.locator('.my-stat').first()).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('alphabetsoup:quiz'))).toBe(QUIZ);
});

test('export produces a restorable backup of everything', async ({ page }) => {
  await seed(page, { [`${PREFIX}quiz`]: QUIZ, [`${PREFIX}roadmap:csf`]: '["a"]' });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /download a backup/i }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^alphabet-soup-backup-\d{4}-\d{2}-\d{2}\.json$/);

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const bundle = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
    format: string;
    items: Record<string, string>;
  };
  expect(bundle.format).toBe('cybersecurity-alphabet-soup/backup');
  expect(Object.keys(bundle.items).sort()).toEqual([`${PREFIX}quiz`, `${PREFIX}roadmap:csf`]);
  expect(bundle.items[`${PREFIX}quiz`]).toBe(QUIZ);
});

/** Hand the page a backup file, the same way the visitor would. */
async function uploadBackup(page: Page, bundle: unknown): Promise<void> {
  await page.setInputFiles('#import-file', {
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bundle), 'utf8'),
  });
}

test('restore refuses a bundle that would write outside this site', async ({ page }) => {
  await seed(page, { [`${PREFIX}quiz`]: QUIZ });
  await uploadBackup(page, {
    format: 'cybersecurity-alphabet-soup/backup',
    version: 1,
    exportedAt: 'x',
    items: { 'other-site:session': 'stolen' },
  });
  await expect(page.locator('.my-msg.bad')).toContainText(/unexpected key/i);
  // Nothing was written, in particular not the foreign key.
  expect(await page.evaluate(() => localStorage.getItem('other-site:session'))).toBeNull();
});

test('restore rejects a file that is not a backup', async ({ page }) => {
  await seed(page, { [`${PREFIX}quiz`]: QUIZ });
  await uploadBackup(page, { hello: 'world' });
  await expect(page.locator('.my-msg.bad')).toContainText(/not exported from this site/i);
});

test('restore merges a valid backup back in', async ({ page }) => {
  await page.goto('/my/');
  await page.evaluate(() => localStorage.setItem('alphabetsoup:quiz', '{"seed":{"attempts":1,"best":10}}'));
  await page.reload();
  await uploadBackup(page, {
    format: 'cybersecurity-alphabet-soup/backup',
    version: 1,
    exportedAt: '2026-07-27T10:00:00.000Z',
    items: { 'alphabetsoup:roadmap:csf': '["restored"]' },
  });
  await expect(page.locator('.my-msg')).toContainText(/restored 1 item/i);
  // Merged, not replaced: the pre-existing key survives.
  const after = await page.evaluate(() => ({
    roadmap: localStorage.getItem('alphabetsoup:roadmap:csf'),
    quiz: localStorage.getItem('alphabetsoup:quiz'),
  }));
  expect(after.roadmap).toBe('["restored"]');
  expect(after.quiz).toContain('seed');
});

test('the page is linked from where progress is made, and from the privacy policy', async ({ page }) => {
  for (const path of ['/quiz/', '/assess/', '/tools/', '/roadmap/']) {
    await page.goto(path);
    await expect(page.locator('a[href="../my/"]'), path).toHaveCount(1);
  }
  await page.goto('/privacy/');
  await expect(page.getByRole('link', { name: /your saved progress page/i })).toBeVisible();
});

test('is excluded from search indexing', async ({ page }) => {
  await page.goto('/my/');
  // It renders only the visitor's own local data, so there is nothing to index.
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  const sitemap = await (await page.request.get('/sitemap.xml')).text();
  expect(sitemap).not.toContain('/my/');
});
