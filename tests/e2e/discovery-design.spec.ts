import { expect, test } from '@playwright/test';
import { fixtureArt, noOverflow } from './helpers';
import { accountFixture } from './account-fixture';

test.beforeEach(async ({ page }) => { await fixtureArt(page); await page.emulateMedia({ reducedMotion: 'reduce' }); });

test('browse keeps discovery controls compact and adjacent to the artwork', async ({ page }, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Desktop discovery geometry');
  await page.goto('/catalogue');
  await expect(page.locator('.title-card').first()).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Browse', exact: true })).toBeVisible();
  await expect(page.getByText('Explore the catalogue', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('searchbox', { name: 'Search catalogue' })).toBeVisible();
  await expect(page.getByText('Filters', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Sort titles' })).toBeVisible();

  const heading = await page.locator('.catalogue-heading').boundingBox();
  const search = await page.locator('.search-field').boundingBox();
  const filters = await page.locator('.filter-disclosure > summary').boundingBox();
  const sort = await page.locator('.discovery-sort').boundingBox();
  const firstCard = await page.locator('.title-grid .title-card').first().boundingBox();
  expect(heading!.height).toBeLessThanOrEqual(125);
  expect(Math.abs(search!.y - filters!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(search!.y - sort!.y)).toBeLessThanOrEqual(1);
  expect(firstCard!.y - (search!.y + search!.height)).toBeLessThanOrEqual(58);
  await noOverflow(page);
});

test('applied filters are removable without losing sort or density', async ({ page }) => {
  await page.goto('/catalogue?q=Paper&type=movie&sort=title&view=compact');
  await expect(page.locator('.title-card').first()).toBeVisible();

  const filters = page.getByLabel('Applied catalogue filters');
  await expect(filters.getByRole('button', { name: /Remove Search filter/i })).toHaveCount(0);
  await expect(page.getByRole('searchbox').first()).toHaveValue('Paper');
  await expect(filters.getByRole('button', { name: /Remove Format filter: Movie/i })).toBeVisible();
  await expect(page.locator('.filter-disclosure')).not.toHaveAttribute('open', '');
  await expect(page.getByRole('combobox', { name: 'Sort titles' })).toHaveValue('title');
  await expect(page.getByRole('button', { name: 'Compact', includeHidden: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await filters.getByRole('button', { name: 'Clear all' }).click();
  await expect(page).not.toHaveURL(/(?:\?|&)(?:q|type)=/);
  await expect(page).toHaveURL(/(?:\?|&)sort=title(?:&|$)/);
  await expect(page).toHaveURL(/(?:\?|&)view=compact(?:&|$)/);
  await noOverflow(page);
});

test('320px discovery controls remain readable and contained', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/catalogue');
  await expect(page.locator('.title-card').first()).toBeVisible();

  const search = await page.locator('.search-field').boundingBox();
  const filters = await page.locator('.filter-disclosure > summary').boundingBox();
  const sort = await page.locator('.discovery-sort').boundingBox();
  const sortSelect = await page.getByRole('combobox', { name: 'Sort titles' }).boundingBox();
  expect(search!.width).toBeGreaterThanOrEqual(280);
  expect(filters!.height).toBeGreaterThanOrEqual(44);
  expect(sort!.height).toBeGreaterThanOrEqual(43.9);
  expect(Math.abs(filters!.y - sort!.y)).toBeLessThanOrEqual(1);
  expect(sortSelect!.width).toBeGreaterThanOrEqual(110);
  // A single two-column density at phone widths avoids duplicating display
  // controls. The URL retains the desktop preference for wider screens.
  await expect(page.locator('.view-switcher')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    (await page.getByRole('combobox', { name: 'Sort titles' }).boundingBox())!.width,
  ).toBeGreaterThanOrEqual(150);
});

test('filters and navigation stay inside tablet and phone viewports', async ({ page }) => {
  for (const width of [820, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/catalogue?scope=anime');
    await expect(page.locator('.title-card').first()).toBeVisible();
    const masthead = await page.locator('.masthead').boundingBox();
    expect(masthead!.height).toBeLessThanOrEqual(106);
    await page.locator('.filter-disclosure > summary').click();
    const filters = await page.locator('.filter-grid').boundingBox();
    expect(filters!.x).toBeGreaterThanOrEqual(0);
    expect(filters!.x + filters!.width).toBeLessThanOrEqual(width);
    await expect(page.getByRole('combobox', { name: 'Genre', exact: true })).toBeVisible();
    await page.locator('.filter-disclosure > summary').click();
    await page.getByRole('button', { name: 'Search all titles', exact: true }).click();
    const search = page.getByRole('searchbox', { name: 'Find titles' });
    await expect(search).toBeFocused();
    const field = await search.boundingBox();
    expect(field!.x).toBeGreaterThanOrEqual(0);
    expect(field!.x + field!.width).toBeLessThanOrEqual(width);
    await page.keyboard.press('Escape');
    await noOverflow(page);
  }
});

test('the phone title artwork leads into readable title and actions', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 820 });
  await page.goto('/title/paper-lantern');
  await expect(page.locator('#title-name')).toBeVisible();
  const poster = page.locator('.title-hero .spotlight-art__poster > img');
  await expect(poster).toBeVisible();
  const box = await poster.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  const heading = await page.locator('#title-name').boundingBox();
  expect(heading!.y).toBeGreaterThan(box!.y);
  await expect(page.locator('.title-hero__actions .button--primary')).toBeVisible();
  await noOverflow(page);
});

test('returning viewers keep a readable Home tab and an unobscured history heading', async ({ page }) => {
  await page.setViewportSize({ width: 936, height: 900 });
  await accountFixture(page, { history: [{
    titleId: '1', slug: 'paper-lantern', title: 'Paper Lantern', episodeId: '1',
    episodeLabel: 'Episode 1', language: 'sub', watchedAt: '2026-01-01T00:00:00Z',
    position: 25, duration: 100,
  }], preferences: { theme: 'light', preferredLanguage: 'sub', rememberProgress: true, autoplayNext: false } });
  await page.goto('/');
  await expect(page.locator('#featured-title')).toBeVisible();
  await expect(page.locator('.sol-brand-readiness')).toHaveCount(0);
  const home = page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Home', exact: true });
  await expect(home).toHaveCSS('color', 'rgb(27, 28, 34)');
  const hero = await page.locator('.home-feature').boundingBox();
  const heading = await page.getByRole('heading', { name: 'Continue watching', exact: true }).boundingBox();
  expect(heading!.y).toBeGreaterThanOrEqual(hero!.y + hero!.height);
  await expect(page.getByRole('progressbar', { name: 'Paper Lantern viewing progress' })).toHaveAttribute('aria-valuenow', '25');
  await noOverflow(page);
});
