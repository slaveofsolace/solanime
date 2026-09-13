import { expect, test } from '@playwright/test';
import { fixtureArt, noOverflow } from './helpers';

test.beforeEach(async ({ page }) => {
  await fixtureArt(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('desktop navigation exposes truthful Anime, Movies, and TV catalogue scopes', async ({ page }) => {
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
  await expect(navigation.getByRole('link', { name: 'Movies', exact: true })).toHaveAttribute(
    'href',
    '/catalogue?scope=anime&type=movie',
  );
  await expect(navigation.getByRole('link', { name: 'Anime', exact: true })).not.toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('group', { name: 'Catalogue collection' })).toHaveCount(0);

  await page.goto('/catalogue');
  await expect(page.getByRole('group', { name: 'Catalogue collection' })).toBeVisible();
});

test('mobile bottom navigation keeps TV directly reachable without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  const navigation = page.getByRole('navigation', { name: 'Primary navigation' });
  await expect(navigation.getByRole('link', { name: 'Home', exact: true })).toBeVisible();
  await expect(navigation.getByRole('link', { name: 'Anime', exact: true })).toBeVisible();
  await expect(navigation.getByRole('link', { name: 'TV Shows', exact: true })).toBeVisible();
  await expect(navigation.getByRole('link', { name: 'Search', exact: true })).toBeVisible();
  await expect(navigation.getByRole('link', { name: /Library \/ My list/ })).toBeVisible();
  await noOverflow(page);
});
