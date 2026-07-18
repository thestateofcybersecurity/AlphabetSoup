// Visual review helper: capture every page in light and dark, desktop and
// mobile, into ./shots so they can be eyeballed. Run with `npm run shots`
// (builds must be current: run `npm run build` first). Uses the already
// installed Playwright Chromium; no extra tooling needed.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:4188';
const OUT = process.env.OUT || './shots';
mkdirSync(OUT, { recursive: true });

const desktop = { width: 1280, height: 900 };
const mobile = { width: 390, height: 844 };

const shots = [
  { name: 'home', url: '/', vp: desktop },
  { name: 'home-mobile', url: '/', vp: mobile },
  { name: 'csf', url: '/frameworks/nist-csf/', vp: desktop },
  { name: 'cis', url: '/frameworks/cis/', vp: desktop },
  { name: 'quiz-grid', url: '/quiz/', vp: desktop },
  { name: 'quiz-grid-mobile', url: '/quiz/', vp: mobile },
  { name: 'roadmap', url: '/roadmap/', vp: desktop },
  { name: 'def-page', url: '/definitions/siem.html', vp: desktop },
  { name: 'fw-page', url: '/frameworks/cis/1-1.html', vp: desktop },
];

const browser = await chromium.launch();
for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ colorScheme: scheme });
  const page = await ctx.newPage();
  for (const s of shots) {
    await page.setViewportSize(s.vp);
    await page.goto(BASE + s.url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${s.name}-${scheme}.png`, fullPage: false });
  }
  // interaction states (light only, desktop)
  if (scheme === 'light') {
    await page.setViewportSize(desktop);
    // quiz mid-question
    await page.goto(BASE + '/quiz/?deck=cissp', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.locator('.choice-btn').first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/quiz-answered-light.png` });
    // assess results
    await page.goto(BASE + '/assess/', { waitUntil: 'networkidle' });
    await page.locator('.assess-card[data-assessment="ransomware"] .primary-btn').click();
    await page.waitForTimeout(200);
    for (const row of await page.locator('.assess-row').all()) {
      await row.locator('.yesno-btn').nth(Math.random() > 0.5 ? 0 : 1).click();
    }
    await page.locator('#assess-done').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/assess-results-light.png`, fullPage: false });
    // roadmap gaps + a section theme framework page dark handled above
  }
  await ctx.close();
}
await browser.close();
console.log('shots written to', OUT);
