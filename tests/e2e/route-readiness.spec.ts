import { expect, test, type Page } from '@playwright/test';
import { episode, fixtureArt, noOverflow } from './helpers';

test.beforeEach(async ({ page }) => fixtureArt(page));

async function delayRouteChunk(page: Page, chunk: string) {
  await page.route(new RegExp(`/assets/${chunk}-[^/]+\\.js$`), async route => {
    await new Promise(resolve => setTimeout(resolve, 700));
    await route.continue();
  });
}

test('title readiness preserves the cinematic page composition while its route loads', async ({ page }) => {
  await delayRouteChunk(page, 'TitlePage');
  await page.goto('/title/paper-lantern', { waitUntil: 'domcontentloaded' });

  const readiness = page.locator('.route-readiness[data-route-kind="title"]');
  await expect(readiness).toBeVisible();
  await expect(readiness.locator('.route-readiness__feature')).toBeVisible();
  await expect(readiness.locator('.route-readiness__rail > i')).toHaveCount(6);
  await noOverflow(page);

  await expect(page.getByRole('heading', { name: 'Paper Lantern' })).toBeVisible();
  await expect(readiness).toHaveCount(0);
});

test('watch readiness reserves a player and episode rail without overflowing', async ({ page }) => {
  const current = await episode(page);
  await delayRouteChunk(page, 'WatchPage');
  await page.goto(`/watch/paper-lantern/${current.id}?language=sub`, { waitUntil: 'domcontentloaded' });

  const readiness = page.locator('.route-readiness[data-route-kind="watch"]');
  await expect(readiness).toBeVisible();
  await expect(readiness.locator('.route-readiness__feature')).toBeVisible();
  await expect(readiness.locator('.route-readiness__rail > i')).toHaveCount(5);
  await noOverflow(page);

  await expect(page.locator('.watch-page')).toBeVisible();
  await expect(readiness).toHaveCount(0);
});
