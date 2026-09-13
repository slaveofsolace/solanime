import { expect, test } from '@playwright/test';
import { fixtureArt, noOverflow, watch } from './helpers';

test.beforeEach(async ({ page }) => {
  await fixtureArt(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('the reference layout uses one dock and consistent original poster cards', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.locator('#featured-title')).toBeVisible();
  await expect(page.locator('.navigation-dock')).toHaveCount(1);
  await expect(page.locator('.category-nav')).toHaveCount(0);
  await expect(page.locator('.home-rail .cover-composition')).toHaveCount(0);
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

test('wide discovery rail uses only API-backed banners while retaining all recent records', async ({ page }) => {
  let recentCount = 0;
  await page.route('**/api/titles?*', async route => {
    const response = await route.fetch(); const body = await response.json();
    const query = new URL(route.request().url()).searchParams;
    if (query.get('sort')==='updated' && query.get('pageSize')==='13') {
      recentCount = body.items.length;
      body.items = body.items.map((item: object, index: number) => index < 4 ? ({...item,
        backdropUrl:'https://images.example.test/banner-test.svg',
        artwork:{backdrop:{url:'https://images.example.test/banner-test.svg',width:1600,height:900,role:'backdrop',source:'anilist',identityReview:'source-id-verified'}},
      }) : item);
    }
    await route.fulfill({response,json:body});
  });
  await page.goto('/');
  const wide = page.getByRole('region',{name:'In focus',exact:true});
  await expect(wide.locator('.title-card')).toHaveCount(4);
  await expect(wide.locator('.cover-composition')).toHaveCount(0);
  const box = await wide.locator('.title-card__art').first().boundingBox();
  expect(box!.width / box!.height).toBeCloseTo(16/9,2);
  await expect(page.getByRole('region',{name:'Recent updates',exact:true}).locator('.title-card')).toHaveCount(recentCount-1);
  await noOverflow(page);
});
