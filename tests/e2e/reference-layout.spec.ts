import { expect, test } from '@playwright/test';
import { fixtureArt, noOverflow, watch } from './helpers';

test.beforeEach(async ({ page }) => {
  await fixtureArt(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('the viewing-room layout uses one header and dense landscape discovery cards', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.locator('#featured-title')).toBeVisible();
  await expect(page.locator('.navigation-dock')).toHaveCount(1);
  await expect(page.locator('.category-nav')).toHaveCount(0);
  expect(await page.locator('.home-rail .cover-composition').count()).toBeGreaterThan(0);
  const card = page.locator('.home-rail .title-card__art').first();
  const box = await card.boundingBox();
  expect(box!.width / box!.height).toBeCloseTo(16 / 9, 2);
  const firstName = await page.locator('#featured-title').innerText();
  await page.locator('.feature-dots button').nth(1).click();
  await expect(page.locator('#featured-title')).not.toHaveText(firstName);
  await expect(page.locator('.feature-dots [aria-pressed="true"]')).toHaveCount(1);
  await page.locator('.feature-dots button').first().click();
  await expect(page.locator('#featured-title')).toHaveText(firstName);
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('reference-home.png'), fullPage: true });
});

test('320px controls stay on one row and episode labels remain readable', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 820 });
  await page.goto('/');
  await expect(page.locator('#featured-title')).toBeVisible();
  const controls = await page.locator('.home-feature .button-row > *').evaluateAll(items =>
    items.map(item => { const b = item.getBoundingClientRect(); return { y: b.y, height: b.height }; }));
  for (const control of controls) {
    expect(control.height).toBeGreaterThanOrEqual(44);
    expect(Math.abs(control.y - controls[0]!.y)).toBeLessThanOrEqual(1);
  }
  await page.goto('/title/paper-lantern');
  await expect(page.locator('.episode-grid > li')).toHaveCount(3);
  const rows = await page.locator('.episode-grid > li').evaluateAll(items => items.map(item => item.getBoundingClientRect()));
  expect(rows[0]!.width).toBeGreaterThan(280);
  for (const row of rows) expect(row.height).toBeLessThanOrEqual(72);
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('reference-title-320.png'), fullPage: true });
});

test('desktop episodes sit alongside the native player without remounting video for theater', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await watch(page);
  const player = await page.locator('.player-stage').boundingBox();
  const episodes = await page.locator('.watch-episodes').boundingBox();
  expect(episodes!.x).toBeGreaterThan(player!.x + player!.width);
  expect(Math.abs(episodes!.y - player!.y)).toBeLessThanOrEqual(1);
  const video = await page.locator('video').elementHandle();
  await page.getByRole('button', { name: 'Theater mode', exact: true }).click();
  expect(await video!.evaluate(element => element.isConnected)).toBe(true);
  const wide = await page.locator('.player-stage').boundingBox();
  expect(wide!.width).toBeGreaterThan(player!.width);
  await noOverflow(page);
});

test('the recent rail retains every non-featured record in one landscape row', async ({ page }) => {
  const recentResponse = await page.request.get(
    '/api/titles?facets=false&sort=updated&pageSize=13',
  );
  const recent = await recentResponse.json();
  const recentCount = recent.items.length;
  await page.goto('/');
  const wide = page.getByRole('region',{name:'Recent updates',exact:true});
  await expect(wide.locator('.title-card')).toHaveCount(recentCount - 1);
  const box = await wide.locator('.title-card__art').first().boundingBox();
  expect(box!.width / box!.height).toBeCloseTo(16/9,2);
  await noOverflow(page);
});
