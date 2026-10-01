import { expect, test } from '@playwright/test';
import { accountFixture } from './account-fixture';

test('a returning iPhone restores its only profile without covering the featured title', async ({ page }) => {
  await page.addInitScript(() => document.documentElement.classList.add('solanime-native-ios'));
  const { session, profile } = await accountFixture(page);
  await page.evaluate((accountId) => sessionStorage.removeItem('solanime:profile:' + accountId), session.account.id);

  await page.reload();
  await expect(page.locator('#featured-title')).toBeVisible();
  await expect(page.getByText('Choose a profile to save your list and progress.')).toHaveCount(0);
  await expect.poll(() => page.evaluate((accountId) =>
    sessionStorage.getItem('solanime:profile:' + accountId), session.account.id,
  )).toBe(profile.id);

  await page.goto('/title/paper-lantern');
  await page.getByRole('button', { name: 'My List' }).click();
  await expect(page).toHaveURL(/\/title\/paper-lantern$/);
});

test('multiple profiles still require a choice before saving', async ({ page }) => {
  await page.addInitScript(() => document.documentElement.classList.add('solanime-native-ios'));
  const { session } = await accountFixture(page);
  const origin = new URL(page.url()).origin;
  const created = await page.request.post('/api/account/profiles', {
    headers: { origin, 'x-solanime-intent': 'account', 'x-csrf-token': session.csrfToken },
    data: { name: 'Family', avatar: 'amber' },
  });
  expect(created.ok()).toBe(true);
  await page.evaluate((accountId) => sessionStorage.removeItem('solanime:profile:' + accountId), session.account.id);

  await page.reload();
  await expect(page.locator('#featured-title')).toBeVisible();
  await expect(page.getByText('Choose a profile to save your list and progress.')).toHaveCount(0);
  await page.goto('/title/paper-lantern');
  await page.getByRole('button', { name: 'My List' }).click();
  await expect(page).toHaveURL(/\/profiles\?returnTo=/);
});
