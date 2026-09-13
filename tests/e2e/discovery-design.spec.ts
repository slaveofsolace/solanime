import { expect, test } from '@playwright/test';
import { fixtureArt, noOverflow } from './helpers';

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
  expect(heading!.height).toBeLessThanOrEqual(76);
  expect(Math.abs(search!.y - filters!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(search!.y - sort!.y)).toBeLessThanOrEqual(1);
  expect(firstCard!.y - (search!.y + search!.height)).toBeLessThanOrEqual(58);
  await noOverflow(page);
});

test('applied filters are removable without losing sort or density', async ({ page }) => {
  await page.goto('/catalogue?q=Paper&type=movie&sort=title&view=compact');
  await expect(page.locator('.title-card').first()).toBeVisible();

  const filters = page.getByLabel('Applied catalogue filters');
  await expect(filters.getByRole('button', { name: /Remove Search filter: Paper/i })).toBeVisible();
  await expect(filters.getByRole('button', { name: /Remove Format filter: Movie/i })).toBeVisible();
  await expect(page.locator('.filter-disclosure')).not.toHaveAttribute('open', '');
  await expect(page.getByRole('combobox', { name: 'Sort titles' })).toHaveValue('title');
  await expect(page.getByRole('button', { name: 'Compact' })).toHaveAttribute(
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
  const view = await page.locator('.view-switcher').boundingBox();
  expect(search!.width).toBeGreaterThanOrEqual(280);
  expect(filters!.height).toBeGreaterThanOrEqual(44);
  expect(sort!.height).toBeGreaterThanOrEqual(43.9);
  expect(sortSelect!.width).toBeGreaterThanOrEqual(135);
  expect(view!.width).toBeGreaterThanOrEqual(136);
  const densityButtons = await page.locator('.view-switcher button').all();
  for (const button of densityButtons) {
    expect((await button.boundingBox())!.width).toBeGreaterThanOrEqual(60);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth),
  );

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    (await page.getByRole('combobox', { name: 'Sort titles' }).boundingBox())!.width,
  ).toBeGreaterThanOrEqual(165);
});
