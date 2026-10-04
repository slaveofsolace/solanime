import { expect, test } from '@playwright/test';
import { accountFixture } from './account-fixture';
import { fixtureArt } from './helpers';

test.beforeEach(async ({ page }) => {
  await fixtureArt(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await accountFixture(page);
  await page.goto('/title/paper-lantern');
});

test('profile shortcuts open without navigation, fit the viewport and restore focus after dismissal', async ({ page }, info) => {
  const trigger = page.getByRole('button', { name: 'Open profile menu', exact: true });
  await trigger.click();
  const panel = page.getByRole('dialog', { name: 'Profile', exact: true });
  await expect(panel).toBeVisible();
  await expect(page).toHaveURL(/\/title\/paper-lantern$/);
  await expect(panel.getByRole('link', { name: 'Manage profiles', exact: true })).toHaveAttribute('href', '/profiles?manage=1');
  await expect(panel.getByRole('link', { name: 'Switch profile', exact: true })).toHaveAttribute('href', /returnTo=%2Ftitle%2Fpaper-lantern/);
  await expect(panel.getByRole('link', { name: 'Settings', exact: true })).toHaveAttribute('href', '/settings');
  await expect(panel.getByRole('link', { name: 'My List', exact: true })).toHaveAttribute('href', '/library');
  await expect(panel.getByRole('link', { name: 'History', exact: true })).toHaveAttribute('href', '/library#history-title');
  const box = await panel.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(8);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width - 8);
  expect(box!.y).toBeGreaterThanOrEqual(8);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height - 8);
  await page.screenshot({ path: info.outputPath('profile-menu.png'), scale: 'css' });
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.mouse.click(2, 2);
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();
  const tabs = page.getByRole('navigation', { name: 'iPhone navigation' });
  if (await tabs.isVisible()) await expect(tabs.getByRole('link', { name: 'Account', exact: true })).toHaveAttribute('href', '/account');
});

test('profile navigation closes the panel and opens real Settings, history and profile management', async ({ page }) => {
  const trigger = page.getByRole('button', { name: 'Open profile menu', exact: true });
  const panel = page.getByRole('dialog', { name: 'Profile', exact: true });
  await trigger.click();
  await panel.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(panel).toHaveCount(0);
  await trigger.click();
  await panel.getByRole('link', { name: 'History', exact: true }).click();
  await expect(page).toHaveURL(/\/library#history-title$/);
  await expect(page.getByRole('heading', { name: 'Watch history', exact: true })).toBeInViewport();
  await expect(panel).toHaveCount(0);
  await trigger.click();
  await panel.getByRole('link', { name: 'Manage profiles', exact: true }).click();
  await expect(page).toHaveURL(/\/profiles\?manage=1$/);
  await expect(page.getByRole('heading', { name: 'Manage profiles', exact: true })).toBeVisible();
});

test('failed sign-out stays open and preserves the account; retry performs ordinary sign-out', async ({ page }) => {
  let fail = true;
  await page.route('**/api/account/logout', route => fail
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Sign-out is temporarily unavailable.' } }) })
    : route.continue());
  await page.getByRole('button', { name: 'Open profile menu', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Profile', exact: true });
  await panel.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(panel.getByRole('alert')).toHaveText('Sign-out is temporarily unavailable.');
  await expect(panel.getByRole('alert')).toBeFocused();
  expect((await (await page.request.get('/api/account/session')).json()).account).not.toBeNull();
  fail = false;
  await panel.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  expect((await (await page.request.get('/api/account/session')).json()).account).toBeNull();
});

test('failed profile saves prevent sign-out and offer the existing account recovery path', async ({ page }) => {
  let logoutRequests = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/account/logout') logoutRequests++; });
  await page.route('**/api/account/profiles/*/data', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Profile changes could not be saved.' } }) })
    : route.continue());
  await page.getByRole('button', { name: 'My List', exact: true }).click();
  await page.getByRole('button', { name: 'Open profile menu', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Profile', exact: true });
  await panel.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(panel.getByRole('alert')).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Review unsaved changes', exact: true })).toBeVisible();
  expect(logoutRequests).toBe(0);
  expect((await (await page.request.get('/api/account/session')).json()).account).not.toBeNull();
});
