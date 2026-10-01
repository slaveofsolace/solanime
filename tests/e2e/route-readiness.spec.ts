import { expect, test, type Page, type Route } from '@playwright/test';
import { episode, fixtureArt, noOverflow } from './helpers';

test.beforeEach(async ({ page }) => fixtureArt(page));

async function holdRouteChunk(page: Page, chunk: string) {
  const pattern = new RegExp(`/assets/${chunk}-[^/]+\\.js$`);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const pending = new Set<Promise<void>>();
  const handler = (route: Route) => {
    const work = held.then(() => route.continue());
    pending.add(work);
    void work.finally(() => pending.delete(work)).catch(() => {});
    return work;
  };
  await page.route(pattern, handler);
  return {
    release,
    async dispose() {
      release();
      await Promise.allSettled([...pending]);
      await page.unroute(pattern, handler);
    },
  };
}

test('title readiness preserves the cinematic page composition while its route loads', async ({ page }) => {
  const chunk = await holdRouteChunk(page, 'TitlePage');
  try {
    await page.goto('/catalogue?scope=anime&q=Paper%20Lantern');
    await expect(page.locator('.application-content')).not.toHaveAttribute('inert');
    await page.locator('a[href="/title/paper-lantern"]').first().click();

    const readiness = page.locator('.route-readiness[data-route-kind="title"]');
    await expect(readiness).toBeVisible();
    await expect(readiness.locator('.route-readiness__feature')).toBeVisible();
    await expect(readiness.locator('.route-readiness__rail > i')).toHaveCount(6);
    await noOverflow(page);

    chunk.release();
    await expect(page.getByRole('heading', { name: 'Paper Lantern' })).toBeVisible();
    await expect(readiness).toHaveCount(0);
  } finally {
    await chunk.dispose();
  }
});

test('watch readiness reserves a player and episode rail without overflowing', async ({ page }) => {
  const current = await episode(page);
  const chunk = await holdRouteChunk(page, 'WatchPage');
  try {
    await page.goto('/title/paper-lantern');
    await expect(page.locator('.application-content')).not.toHaveAttribute('inert');
    await page.locator(`.episode-grid a[href="/watch/paper-lantern/${current.id}?language=sub"]`).click();

    const readiness = page.locator('.route-readiness[data-route-kind="watch"]');
    await expect(readiness).toBeVisible();
    await expect(readiness.locator('.route-readiness__feature')).toBeVisible();
    await expect(readiness.locator('.route-readiness__rail > i')).toHaveCount(5);
    await noOverflow(page);

    chunk.release();
    await expect(page.locator('.watch-page')).toBeVisible();
    await expect(readiness).toHaveCount(0);
  } finally {
    await chunk.dispose();
  }
});
