import { expect, test } from '@playwright/test';
import { accountFixture } from './account-fixture';

test('signed iPhone tabs open Discover, Library, and Account without a page error', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const mark = () => document.documentElement?.classList.add('solanime-native-ios');
    mark();
    document.addEventListener('DOMContentLoaded', mark, { once: true });
  });
  await accountFixture(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Recent updates' })).toBeVisible();

  const tabs = page.locator('.native-tab-bar');
  await tabs.getByRole('link', { name: 'Discover' }).click();
  await expect(page).toHaveURL(/\/catalogue\?scope=anime/);
  await expect(page.locator('.title-card').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Could not load the catalogue' })).toHaveCount(0);

  await tabs.getByRole('link', { name: 'Library' }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByRole('heading', { name: 'My List' })).toBeVisible();

  await tabs.getByRole('link', { name: 'Account' }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
  expect(errors).toEqual([]);
});
