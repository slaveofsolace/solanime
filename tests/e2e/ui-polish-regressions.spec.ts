import { expect, test } from '@playwright/test';
import { accountFixture } from './account-fixture';
import { fixtureArt, noOverflow } from './helpers';
import { generatedTestPassphrase } from '../helpers/auth-material';

// All mutations use the loopback disposable account database. None target deployment.
test.beforeEach(async ({ page }) => {
  await fixtureArt(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('focused sign-in has one visible heading, no distracting navigation and a usable form width', async ({ page }) => {
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Search all titles' })).toHaveCount(0);
    const form = await page.locator('.auth-panel form').boundingBox();
    expect(form!.width).toBeGreaterThanOrEqual(width < 600 ? width - 80 : 400);
    await noOverflow(page);
  }
});

test('saved series actions do not play on opening, restore focus and preserve other saved state', async ({ page }) => {
  const detail = await (await page.request.get('/api/titles/paper-lantern')).json();
  await accountFixture(page, { 'watchlist-records': [detail.title] });
  await page.goto('/library');
  const trigger = page.getByRole('button', { name: 'More options for Paper Lantern', exact: true });
  await expect(trigger).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove from My List', exact: true })).toHaveCount(0);
  await trigger.click();
  const sheet = page.getByRole('dialog', { name: 'Paper Lantern', exact: true });
  await expect(sheet).toBeVisible();
  await expect(page).toHaveURL(/\/library$/);
  await expect(sheet.getByRole('button', { name: 'Mark as watched' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await sheet.getByRole('link', { name: 'Series info' }).click();
  await expect(page).toHaveURL(/\/title\/paper-lantern$/);
  await page.goto('/library');
  await trigger.click();
  await sheet.getByRole('button', { name: 'Remove from My List', exact: true }).click();
  await expect(page.getByText('Save a title to find it here.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Save a title to find it here.')).toBeVisible();
});

test('clear history requires confirmation and does not clear the watchlist', async ({ page }, info) => {
  const detail = await (await page.request.get('/api/titles/paper-lantern')).json();
  await accountFixture(page, {
    'watchlist-records': [detail.title],
    history: [{ titleId: detail.title.id, slug: detail.title.slug, title: detail.title.name,
      episodeId: detail.episodes[0].id, episodeLabel: 'Episode 1', language: 'sub',
      watchedAt: '2026-09-01T12:00:00Z', position: 12, duration: 100 }],
  });
  await page.goto('/library?view=history');
  await expect(page.locator('.history-list > li')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear history', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Clear watch history?' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('history-confirmation.png') });
  await page.getByRole('button', { name: 'Keep history' }).click();
  await expect(page.locator('.history-list > li')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear history', exact: true }).click();
  await page.getByRole('button', { name: 'Clear this profile’s history' }).click();
  await expect(page.getByText('Episodes you watch will appear here.')).toBeVisible();
  await page.getByRole('navigation', { name: 'Library views' }).getByRole('link', { name: 'My List', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Open Paper Lantern', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: 'Open Paper Lantern', exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Library views' }).getByRole('link', { name: 'History', exact: true }).click();
  await expect(page.getByText('Episodes you watch will appear here.')).toBeVisible();
  await page.getByRole('navigation', { name: 'Library views' }).getByRole('link', { name: 'My List', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Open Paper Lantern', exact: true })).toBeVisible();
});

test('account sessions report failure and retry instead of showing an empty successful list', async ({ page }, info) => {
  await accountFixture(page);
  let failed = true;
  await page.route('**/api/account/sessions', route => failed
    ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Unavailable"}' })
    : route.continue());
  await page.goto('/account');
  await page.locator('summary').filter({ hasText: 'Active sessions' }).click();
  await expect(page.getByText('Signed-in devices could not be loaded.')).toBeVisible();
  await page.screenshot({ path: info.outputPath('sessions-retry.png'), maskColor: '#2d3038', mask: [page.locator('.account-heading p')] });
  failed = false;
  await page.getByRole('button', { name: 'Retry devices' }).click();
  await expect(page.locator('.device-list').getByText('This browser', { exact: true })).toBeVisible();
  await expect(page.getByText('Signed-in devices could not be loaded.')).toHaveCount(0);
});

test('password mismatch keeps one focused error beside the mobile form without submitting a password change', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const mark = () => document.documentElement?.classList.add('solanime-native-ios');
    mark(); document.addEventListener('DOMContentLoaded', mark, { once: true });
  });
  await accountFixture(page);
  let passwordRequests = 0;
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/account/password') passwordRequests++;
  });
  await page.goto('/account');
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  await page.getByLabel('Current password', { exact: true }).fill(generatedTestPassphrase('unused current'));
  const proposed = generatedTestPassphrase('mismatch');
  await page.getByLabel('New password', { exact: true }).fill(proposed);
  await page.getByLabel('Confirm new password', { exact: true }).fill(`${proposed} different`);
  await page.getByRole('button', { name: 'Update password', exact: true }).click();

  const alert = page.locator('#account-security-form').getByRole('alert');
  await expect(page.getByRole('alert')).toHaveCount(1);
  await expect(alert).toHaveText('Passwords do not match.');
  await expect(alert).toBeFocused();
  const bounds = await alert.evaluate(element => {
    const error = element.getBoundingClientRect();
    const header = document.querySelector('.masthead')?.getBoundingClientRect();
    const tabs = document.querySelector('.native-tab-bar')?.getBoundingClientRect();
    return {
      top: error.top, bottom: error.bottom,
      headerBottom: Math.max(0, header?.bottom ?? 0),
      tabTop: tabs && tabs.height > 0 ? tabs.top : innerHeight,
    };
  });
  expect(bounds.top).toBeGreaterThanOrEqual(bounds.headerBottom);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.tabTop);
  expect(passwordRequests).toBe(0);
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('account-password-mismatch-visible.png'), scale: 'css',
    maskColor: '#2d3038', mask: [page.locator('input[type="password"]'), page.locator('.account-heading p')] });
});

test('appearance controls survive direct loads and narrow-to-wide changes', async ({ page }) => {
  await accountFixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings?section=appearance');
  const motion = page.getByRole('checkbox', { name: 'Reduce motion', exact: true });
  await expect(motion).toBeVisible();
  await motion.check();
  await page.reload();
  await expect(motion).toBeChecked();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(motion).toBeVisible();
  await expect(motion).toBeChecked();
  await motion.uncheck();
  await page.reload();
  await expect(motion).not.toBeChecked();
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await noOverflow(page);
});
