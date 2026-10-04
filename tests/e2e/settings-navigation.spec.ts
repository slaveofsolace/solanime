import { expect, test } from '@playwright/test';
import { accountFixture } from './account-fixture';
import { fixtureArt, noOverflow } from './helpers';

test('Settings sections have direct destinations, working back navigation and account anchors', async ({ page }, info) => {
  await fixtureArt(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await accountFixture(page);
  await page.goto('/settings');
  const phone = page.viewportSize()!.width <= 820;
  const navigation = page.getByRole('navigation', { name: 'Settings sections', exact: true });
  if (phone) await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  else await expect(page.getByRole('heading', { name: 'Playback', exact: true })).toBeVisible();
  await navigation.getByRole('link', { name: 'Appearance', exact: true }).click();
  await expect(page).toHaveURL(/section=appearance$/);
  await expect(page.getByRole('heading', { name: 'Appearance', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Reduce motion', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Preferred version', exact: true })).toBeHidden();
  await page.screenshot({ path: info.outputPath('settings-appearance.png'), scale: 'css' });
  if (phone) await page.locator('.settings-back').click();
  await navigation.getByRole('link', { name: 'Playback', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Preferred version', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Reduce motion', exact: true })).toBeHidden();
  await page.goBack();
  await expect(page.getByRole('heading', { name: phone ? 'Settings' : 'Appearance', exact: true })).toBeVisible();
  await navigation.getByRole('link', { name: 'Devices', exact: true }).click();
  await expect(page).toHaveURL(/\/account#devices$/);
  await expect(page.locator('#devices')).toHaveAttribute('open', '');
  await expect(page.locator('#devices summary')).toBeInViewport();
  await noOverflow(page);
  // Old connection bookmarks continue to open the actual connection screen.
  await page.goto('/settings#connections');
  await expect(page.getByRole('heading', { name: 'Connected apps', exact: true })).toBeVisible();
  await expect(page.getByText('Import your export file', { exact: true })).toBeVisible();
});
