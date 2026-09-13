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
  const navigation = page.getByRole('navigation', { name: 'Primary navigation' });
  await expect(navigation.getByRole('link', { name: 'TV Shows', exact: true })).toHaveAttribute('aria-current', 'page');

  await navigation.getByRole('link', { name: 'Anime', exact: true }).click();
  await expect(page).toHaveURL(/scope=anime/);
  await expect(navigation.getByRole('link', { name: 'Anime', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.title-card').first()).toBeVisible();

  await navigation.getByRole('link', { name: 'Movies', exact: true }).click();
  await expect(page).toHaveURL(/scope=movies/);
  await expect(page.getByRole('heading', { name: 'Movies', exact: true })).toBeVisible();
  await noOverflow(page);
});

test('watch keeps public conversation separate from private episode notes', async ({ page }) => {
  await page.goto('/title/paper-lantern');
  await page.getByRole('link', { name: 'Play first episode', exact: true }).click();
  await expect(page.locator('video')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Conversation', exact: true })).toBeVisible();
  await expect(page.getByText('No comments yet. Start the conversation for this episode.')).toBeVisible();
  await expect(page.locator('.episode-community').getByRole('link', { name: 'Sign in', exact: true })).toHaveAttribute('href', '/login');
  await page.getByText('Your notes', { exact: false }).click();
  await expect(page.getByText('Private to your current profile or device.')).toBeVisible();
  await noOverflow(page);
});
