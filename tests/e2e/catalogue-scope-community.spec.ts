import { expect, test } from '@playwright/test';
import { fixtureArt, noOverflow } from './helpers';

test.beforeEach(async ({ page }) => {
  await fixtureArt(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('catalogue collection controls send a shareable source scope', async ({ page }) => {
  const tvRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === '/api/titles' && url.searchParams.get('scope') === 'tv';
  });
  await page.goto('/catalogue?scope=tv');
  await tvRequest;
  await expect(page.getByRole('heading', { name: 'TV Shows', exact: true })).toBeVisible();
  const collections = page.getByRole('group', { name: 'Catalogue collection' });
  await expect(collections.getByRole('button', { name: 'TV Shows', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await collections.getByRole('button', { name: 'Anime', exact: true }).click();
  await expect(page).toHaveURL(/scope=anime/);
  await expect(collections.getByRole('button', { name: 'Anime', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.title-card').first()).toBeVisible();

  await expect(collections.getByRole('button', { name: 'Movies', exact: true })).toHaveCount(0);
  await page.goto('/catalogue?scope=movies');
  await expect(page).toHaveURL(/scope=tv/);
  await expect(page.getByRole('heading', { name: 'TV Shows', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Fixture Screen Series', exact: true })).toBeVisible();
  await noOverflow(page);
});

test('watch keeps public conversation separate from private episode notes', async ({ page }) => {
  await page.goto('/title/paper-lantern');
  await page.getByRole('link', { name: /Start watching: Episode 1/ }).click();
  await expect(page.locator('video')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Comments', exact: true })).toBeVisible();
  await expect(page.getByText('No comments yet', { exact: true })).toBeVisible();
  await expect(page.getByText('Start the conversation for this episode.', { exact: true })).toBeVisible();
  await expect(page.locator('.episode-community').getByRole('link', { name: 'Sign in', exact: true })).toHaveAttribute('href', '/login');
  await page.getByText('Your notes', { exact: false }).click();
  await expect(page.getByText('Private to your selected profile.')).toBeVisible();
  await noOverflow(page);
});
