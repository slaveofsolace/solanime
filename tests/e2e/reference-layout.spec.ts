import { expect, test } from '@playwright/test';
import { fixtureArt, noOverflow, watch } from './helpers';

test.beforeEach(async ({ page }) => {
  await fixtureArt(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('discovery uses one header and consistent portrait rows', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.locator('#featured-title')).toBeVisible();
  await expect(page.locator('.navigation-dock')).toHaveCount(1);
  await expect(page.locator('.category-nav')).toHaveCount(0);
  const card = page.locator('.home-rail .title-card__art').first();
  const box = await card.boundingBox();
  expect(box!.width / box!.height).toBeCloseTo(2 / 3, 2);
  const firstName = await page.locator('#featured-title').innerText();
  await page.locator('.feature-dots button').nth(1).click();
  await expect(page.locator('#featured-title')).not.toHaveText(firstName);
  await expect(page.locator('.feature-dots [aria-pressed="true"]')).toHaveCount(1);
  await page.locator('.feature-dots button').first().click();
  await expect(page.locator('#featured-title')).toHaveText(firstName);
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('reference-home.png'), fullPage: true });
  const titleDestination = await card.getAttribute('href');
  await card.click();
  await expect(page).toHaveURL(new URL(titleDestination!, page.url()).href);
  await expect(page.locator('#title-name')).toBeVisible();
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
  expect(rows[0]!.width).toBeGreaterThanOrEqual(260);
  expect(rows[1]!.y).toBeGreaterThan(rows[0]!.y + rows[0]!.height);
  for (const row of rows) expect(row.height).toBeLessThanOrEqual(110);
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('reference-title-320.png'), fullPage: true });

  await watch(page);
  // Audio and server choices each take the full phone width, one row each.
  const sourceControl = await page.getByRole('group', { name: 'Server', exact: true }).boundingBox();
  const versionControl = await page.getByRole('group', { name: 'Audio', exact: true }).boundingBox();
  expect(sourceControl!.width).toBeGreaterThanOrEqual(260);
  expect(versionControl!.width).toBeGreaterThanOrEqual(260);
  expect(sourceControl!.y).toBeGreaterThan(versionControl!.y);
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('reference-watch-320.png'), fullPage: true });
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

test('the recent rail retains the first 18 non-featured records in source order', async ({ page }) => {
  const recentResponse = await page.request.get(
    '/api/titles?facets=false&scope=anime&sort=updated&pageSize=48',
  );
  const recent = await recentResponse.json();
  const recentCount = recent.items.length;
  await page.goto('/');
  const wide = page.getByRole('region',{name:'Recent updates',exact:true});
  await expect(wide.locator('.title-card')).toHaveCount(Math.min(18, recentCount - 1));
  const box = await wide.locator('.title-card__art').first().boundingBox();
  expect(box!.width / box!.height).toBeCloseTo(2/3,2);
  await noOverflow(page);
});
