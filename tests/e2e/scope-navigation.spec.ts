import { expect, test } from '@playwright/test';
import { fixtureArt, noOverflow } from './helpers';

test.beforeEach(async ({ page }) => {
  await fixtureArt(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('desktop navigation separates Anime and TV and retires the Movies sector', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/catalogue?scope=tv');

  const navigation = page.getByRole('navigation', { name: 'Primary navigation' });
  await expect(navigation.getByRole('link', { name: 'Anime', exact: true })).toHaveAttribute(
    'href',
    '/catalogue?scope=anime',
  );
  await expect(navigation.getByRole('link', { name: 'TV Shows', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(navigation.getByRole('link', { name: 'Movies', exact: true })).toHaveCount(0);
  await expect(navigation.getByRole('link', { name: 'Anime', exact: true })).not.toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('group', { name: 'Catalogue collection' })).toHaveCount(0);

  await page.goto('/catalogue');
  await expect(page.getByRole('group', { name: 'Catalogue collection' })).toBeVisible();

  await page.goto('/catalogue?scope=movies');
  await expect(navigation.getByRole('link', { name: 'TV Shows', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('heading', { name: 'TV Shows', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Fixture Screen Series', exact: true })).toBeVisible();
});

test('mobile viewing shell keeps compact header, browsing, and search reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  const navigation = page.getByRole('navigation', { name: 'Primary navigation' });
  await expect(page.getByRole('link', { name: 'Sol Anime home', exact: true })).toBeVisible();
  await expect(navigation.getByRole('link', { name: 'Anime', exact: true })).toBeVisible();
  await expect(navigation.getByRole('link', { name: 'TV Shows', exact: true })).toBeVisible();
  await expect(navigation.getByRole('button', { name: 'Categories', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Search all titles', exact: true })).toBeVisible();
  await expect(navigation.getByRole('link', { name: /Library \/ My list/ })).toBeVisible();
  const header = await page.locator('.masthead').boundingBox();
  const tabs = await navigation.boundingBox();
  const feature = await page.locator('.home-feature').boundingBox();
  const rail = await page.locator('.home-rail').first().boundingBox();
  expect(header?.height).toBeLessThanOrEqual(60);
  expect(tabs?.y).toBeGreaterThan(760);
  expect(feature?.height).toBeLessThan(450);
  expect(rail?.y).toBeLessThan(560);
  await navigation.getByRole('button', { name: 'Categories', exact: true }).click();
  await expect(page.locator('#browse-categories')).toBeVisible();
  const sheet = await page.locator('#browse-categories').boundingBox();
  expect(sheet!.y + sheet!.height).toBeLessThanOrEqual(tabs!.y + 1);
  await navigation.getByRole('button', { name: 'Categories', exact: true }).press('Escape');
  await expect(page.locator('#browse-categories')).toHaveCount(0);
  await noOverflow(page);
});
