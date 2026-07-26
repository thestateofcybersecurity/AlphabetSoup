import { expect, test, type Page } from '@playwright/test';

/**
 * Accessibility guards.
 *
 * tests/contrast.test.ts checks the tokens as authored in style.css. This file
 * checks what the browser actually paints, which is the part CSS parsing cannot
 * see: cascade order, color-mix() resolution, and the dark-scheme media query
 * actually applying.
 */

/** Contrast ratio from two computed `rgb(...)` strings. */
const ratioInPage = `
  (fg, bg) => {
    const parse = (s) => s.match(/\\d+(\\.\\d+)?/g).slice(0, 3).map(Number);
    const lum = (c) => {
      const [r, g, b] = c.map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const a = lum(parse(fg)), b = lum(parse(bg));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }
`;

async function chipContrasts(page: Page): Promise<{ category: string; ratio: number }[]> {
  return page.evaluate(`(() => {
    const ratio = ${ratioInPage};
    return [...document.querySelectorAll('.cat-dot')].map((el) => {
      const s = getComputedStyle(el);
      return { category: el.textContent.trim(), ratio: ratio(s.color, s.backgroundColor) };
    });
  })()`) as Promise<{ category: string; ratio: number }[]>;
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} scheme`, () => {
    test.use({ colorScheme: scheme });

    test('every rendered category chip meets WCAG AA', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('.cat-dot');
      const chips = await chipContrasts(page);
      expect(chips.length).toBeGreaterThan(10);
      const failing = chips.filter((c) => c.ratio < 4.5);
      expect(failing, `chips below 4.5:1 in ${scheme}`).toEqual([]);
    });

    test('the dark palette actually applies', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('.cat-dot');
      const paper = await page.evaluate(
        "getComputedStyle(document.body).backgroundColor",
      );
      // Guards against the media query silently not matching, which would make
      // the contrast assertions above pass by only ever testing one theme.
      const isDark = await page.evaluate(
        `(() => { const m = getComputedStyle(document.body).backgroundColor.match(/\\d+/g).map(Number);
          return (m[0] + m[1] + m[2]) / 3 < 128; })()`,
      );
      expect(isDark, `body background was ${paper}`).toBe(scheme === 'dark');
    });
  });
}

test('search results are announced through a live region', async ({ page }) => {
  await page.goto('/');
  const region = page.locator('#a11y-live-region');
  await page.fill('#search', 'siem');
  await expect(region).toHaveAttribute('aria-live', 'polite');
  // The region must be polite and atomic, and carry the visible match count.
  await expect(region).toHaveAttribute('aria-atomic', 'true');
  await expect(region).not.toBeEmpty();
  const meta = (await page.locator('#result-meta').textContent()) ?? '';
  await expect(region).toHaveText(meta.trim());
});

test('the live region is invisible but present in the accessibility tree', async ({ page }) => {
  await page.goto('/');
  await page.fill('#search', 'zero');
  const region = page.locator('#a11y-live-region');
  await expect(region).toHaveCount(1);
  // sr-only: clipped to a 1px box rather than display:none, which would remove
  // it from the accessibility tree entirely and defeat the point.
  const box = await region.boundingBox();
  expect(box === null || box.width <= 2).toBeTruthy();
  expect(await region.evaluate((el) => getComputedStyle(el).display)).not.toBe('none');
});

test('a wrong quiz answer still identifies the correct one without colour', async ({ page }) => {
  await page.goto('/quiz/');
  await page.getByRole('button', { name: /start quiz/i }).first().click();
  await page.getByRole('button', { name: 'Start' }).click();
  await page.waitForSelector('.choice-btn');

  // Answer deliberately wrong where possible: pick a choice, then check that
  // whichever button ends up marked .right carries text saying so.
  const choices = page.locator('.choice-btn');
  await choices.first().click();

  const right = page.locator('.choice-btn.right');
  await expect(right).toHaveCount(1);
  await expect(right).toContainText('(correct answer)');

  // If the first pick was wrong it must say so; if it was right, the same
  // element carries the correct-answer marker and there is no .wrong at all.
  const wrong = page.locator('.choice-btn.wrong');
  if ((await wrong.count()) > 0) {
    await expect(wrong).toContainText('(your answer, incorrect)');
  }
});

test('quiz right and wrong states differ by more than colour', async ({ page }) => {
  await page.goto('/quiz/');
  await page.getByRole('button', { name: /start quiz/i }).first().click();
  await page.getByRole('button', { name: 'Start' }).click();
  await page.waitForSelector('.choice-btn');
  await page.locator('.choice-btn').first().click();

  const marker = await page.locator('.choice-btn.right').evaluate(
    (el) => getComputedStyle(el, '::after').content,
  );
  expect(marker).toContain('✓');

  const wrong = page.locator('.choice-btn.wrong');
  if ((await wrong.count()) > 0) {
    // Dashed vs solid border is a second non-colour channel.
    expect(await wrong.first().evaluate((el) => getComputedStyle(el).borderStyle)).toBe('dashed');
    expect(
      await wrong.first().evaluate((el) => getComputedStyle(el, '::after').content),
    ).toContain('×');
  }
});

test('the quiz verdict reaches the live region', async ({ page }) => {
  await page.goto('/quiz/');
  await page.getByRole('button', { name: /start quiz/i }).first().click();
  await page.getByRole('button', { name: 'Start' }).click();
  await page.waitForSelector('.choice-btn');
  await page.locator('.choice-btn').first().click();
  await expect(page.locator('#a11y-live-region')).toContainText(/Correct|Not quite/);
});

test('deleting a skills-matrix row keeps keyboard focus in the table', async ({ page }) => {
  await page.goto('/tools/skills-matrix/');
  await page.locator('#add-member').click();
  await page.locator('#add-member').click();
  await page.waitForSelector('[data-action="delete"]');

  // Focus the first delete button the way a keyboard user would, then activate.
  const del = page.locator('[data-action="delete"]').first();
  await del.focus();
  await del.press('Enter');

  const focused = await page.evaluate(
    () => document.activeElement?.tagName + ':' + (document.activeElement?.className ?? ''),
  );
  // Before this change focus fell to BODY, sending the user back to the top of
  // the page after every deletion.
  expect(focused).not.toContain('BODY');

  await expect(page.locator('#a11y-live-region')).toContainText(/Removed/);
});
