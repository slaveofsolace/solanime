import { expect, test } from '@playwright/test';
import { fixtureArt, noOverflow, watch } from './helpers';

test.beforeEach(async ({ page }) => {
  await fixtureArt(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('title fallback preserves poster proportions and episodes use compact landscape cards', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/title/paper-lantern');
  await expect(page.locator('#title-name')).toBeVisible();

  const layout = await page.evaluate(() => {
    const box = (selector: string) => {
      const { x, y, width, height, right, bottom } = document.querySelector(selector)!.getBoundingClientRect();
      return { x, y, width, height, right, bottom };
    };
    const hero = box('.title-hero');
    const copy = box('.title-hero__content');
    const art = box('.title-hero .spotlight-art__poster > img');
    const rows = Array.from(document.querySelectorAll('.title-page .episode-grid > li'))
      .map((row) => {
        const { x, y, width, height } = row.getBoundingClientRect();
        return { x, y, width, height };
      });
    return { hero, copy, art, rows };
  });

  expect(layout.hero.width).toBeCloseTo(1440, 0);
  expect(layout.art.width).toBeGreaterThanOrEqual(200);
  expect(layout.art.width).toBeLessThanOrEqual(260);
  expect(layout.art.height).toBeLessThan(layout.hero.height);
  expect(layout.hero.height).toBeLessThanOrEqual(460);
  expect(layout.copy.right).toBeLessThan(layout.art.right);
  expect(layout.rows).toHaveLength(3);
  expect(layout.rows[1]!.x).toBeGreaterThan(layout.rows[0]!.x + 100);
  expect(layout.rows[0]!.height).toBeGreaterThan(140);
  expect(layout.rows[0]!.height).toBeLessThanOrEqual(300);
  const thumb = await page.locator('.episode-thumbnail').first().boundingBox();
  expect(thumb!.width / thumb!.height).toBeCloseTo(16 / 9, 1);
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('series-cards-desktop.png'), fullPage: true });
});

test('desktop watch keeps the player dominant with a bounded episode side rail', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await watch(page);
  await expect(page.getByRole('heading', { name: 'Comments', exact: true })).toBeVisible();

  const layout = await page.evaluate(() => {
    const box = (selector: string) => {
      const { x, y, width, height, right, bottom } = document.querySelector(selector)!.getBoundingClientRect();
      return { x, y, width, height, right, bottom };
    };
    const stage = box('.player-stage');
    const rail = box('.watch-episodes');
    const empty = box('.community-empty');
    return { stage, rail, empty, viewport: { width: innerWidth, height: innerHeight } };
  });

  expect(layout.stage.width).toBeGreaterThan(layout.viewport.width * .6);
  expect(layout.rail.x).toBeGreaterThan(layout.stage.right);
  expect(layout.rail.y).toBeCloseTo(layout.stage.y, 0);
  expect(layout.rail.height).toBeLessThanOrEqual(layout.viewport.height - 90);
  expect(layout.empty.height).toBeLessThanOrEqual(80);
  await noOverflow(page);
});

test('320px title and watch controls remain readable without horizontal overflow', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 820 });
  await page.goto('/title/paper-lantern');
  await expect(page.locator('#title-name')).toBeVisible();
  await expect(page.getByRole('link', { name: /Start watching: Episode 1/ })).toBeVisible();
  expect(await page.locator('.title-page .episode-grid').evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(' ').length)).toBe(2);
  await noOverflow(page);

  await page.getByRole('link', { name: /Start watching: Episode 1/ }).click();
  await expect(page.locator('video')).toBeVisible();
  await expect(page.getByLabel('Choose episode')).toBeVisible();
  await expect(page.getByLabel('Playback source')).toBeVisible();
  await expect(page.getByLabel('Episode language')).toBeVisible();
  const source = await page.locator('.source-choice').boundingBox();
  const version = await page.locator('.version-choice').boundingBox();
  expect(source!.y).toBeCloseTo(version!.y, 0);
  expect(version!.x).toBeGreaterThan(source!.x);
  expect((await page.locator('.watch-selection').boundingBox())!.height).toBeLessThanOrEqual(160);
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('watch-controls-320.png'), fullPage: true });
});
