import { expect, test } from '@playwright/test';

test('about page has an OG image and Person structured data', async ({ page }) => {
  const res = await page.goto('/about/');
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /\/og-about\.png$/);
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');

  // Person JSON-LD is present and well-formed.
  const ld = await page.locator('script[type="application/ld+json"]').textContent();
  const data = JSON.parse(ld!);
  expect(data['@type']).toBe('Person');
  expect(data.name).toBe('Parker Brissette');
  expect(data.sameAs).toContain('https://www.linkedin.com/in/parkerbrissette');
  expect(data.sameAs).toContain('https://github.com/thestateofcybersecurity');

  // The OG image is served and is a real PNG.
  const img = await page.request.get(new URL('/og-about.png', res!.url()).href);
  expect(img.status()).toBe(200);
  expect(img.headers()['content-type']).toContain('image/png');
});
