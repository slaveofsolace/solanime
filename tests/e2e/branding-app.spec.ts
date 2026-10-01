import { expect, test } from '@playwright/test';
import { fixtureArt, noOverflow } from './helpers';

test.beforeEach(async ({ page }) => fixtureArt(page));

test('an account-bootstrap failure interrupts the splash instead of waiting for catalogue timeout', async ({ page }) => {
  let sessionRequests = 0;
  await page.route('**/api/account/session', route => {
    sessionRequests++;
    return route.fulfill({
      status: 503, contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Account service unavailable.' } }),
    });
  });
  await page.goto('/');
  await expect.poll(() => sessionRequests).toBeGreaterThan(0);
  await expect(page.locator('.application-content')).toContainText('Could not check access');
  await expect(page.locator('.sol-brand-readiness')).toHaveAttribute('data-readiness', 'error', { timeout: 2500 });
  await expect(page.getByRole('alert')).toContainText('Account service unavailable.');
  await expect(page.locator('.application-content')).toHaveAttribute('inert');
});

test('branding follows primary readiness and does not replay after route navigation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.route('**/api/titles?*', async route => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get('scope') === 'anime' && query.get('pageSize') === '48') await new Promise(resolve => setTimeout(resolve, 500));
    await route.continue();
  });
  const began = Date.now();
  await page.goto('/');
  const readiness = page.locator('.sol-brand-readiness');
  await expect(readiness).toBeVisible();
  await expect(page.locator('.application-content')).toHaveAttribute('inert');
  await expect(readiness).toHaveCount(0, { timeout: 6000 });
  expect(Date.now() - began).toBeGreaterThanOrEqual(2300);
  await expect(page.locator('#featured-title')).toBeVisible();
  const navBrand = page.locator('.masthead .sol-brand');
  await expect(navBrand).toHaveAttribute('data-animation', 'static');
  await expect(navBrand.locator('img')).toHaveAttribute('src', '/branding/solanime-compact-dark.webp');
  await expect(navBrand.locator('svg')).toHaveCount(0);

  await page.getByRole('navigation', { name: 'Primary navigation' })
    .getByRole('link', { name: 'Anime', exact: true }).click();
  await expect(page).toHaveURL('/catalogue?scope=anime');
  await page.getByRole('link', { name: 'Sol Anime home', exact: true }).click();
  await expect(page).toHaveURL('/');
  await expect(readiness).toHaveCount(0);
  await expect(page.locator('#featured-title')).toBeVisible();
  await noOverflow(page);
});

test('failed primary loading presents one actionable error and can recover without replay', async ({ page }) => {
  let failPrimary = true;
  await page.route('**/api/titles?*', async route => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get('scope') === 'anime' && query.get('pageSize') === '48' && failPrimary) {
      await route.fulfill({ status: 503, contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'TEST_UNAVAILABLE', message: 'Catalogue temporarily unavailable.' } }) });
    } else await route.continue();
  });
  await page.goto('/');
  await expect(page.locator('.sol-brand-readiness')).toHaveAttribute('data-readiness', 'error');
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'View page status', exact: true }).click();
  await expect(page.locator('.sol-brand-readiness')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(1);
  failPrimary = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('#featured-title')).toBeVisible();
  await expect(page.locator('.sol-brand-readiness')).toHaveCount(0);
});
