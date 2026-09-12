import { expect, type Page } from '@playwright/test';
export const art =
  '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="510"><rect width="360" height="510" fill="#292740"/><circle cx="180" cy="180" r="85" fill="#d6b8d3"/><path d="M0 450 150 260 280 390 360 260V510H0Z" fill="#60587c"/></svg>';
export async function fixtureArt(page: Page) {
  await page.route('https://images.example.test/**', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: art }),
  );
}
export async function episode(page: Page, slug = 'paper-lantern') {
  return (await (await page.request.get(`/api/titles/${slug}`)).json()).episodes[0];
}
export async function watch(page: Page) {
  const e = await episode(page);
  await page.goto(`/watch/paper-lantern/${e.id}?language=sub`);
  await expect(page.locator('video')).toBeVisible();
  await expect
    .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThan(1);
  return e;
}
export async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}
