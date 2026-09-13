import { expect, test } from '@playwright/test';
import { fixtureArt, noOverflow } from './helpers';

test.beforeEach(async ({ page }) => fixtureArt(page));

test('branding follows primary readiness and does not replay after route navigation', async ({ page }) => {
  await page.route('**/api/titles?*', async route => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get('pageSize') === '13') await new Promise(resolve => setTimeout(resolve, 500));
    await route.continue();
  });
  await page.goto('/');
  const readiness = page.locator('.sol-brand-readiness');
  await expect(readiness).toBeVisible();
  await expect(page.locator('#featured-title')).toBeVisible({ timeout: 2000 });
  await expect(readiness).toHaveCount(0, { timeout: 1500 });
  const navBrand = page.locator('.masthead .sol-brand');
  await expect(navBrand).toHaveAttribute('data-animation', 'static');
  await expect(navBrand.locator('img')).toHaveAttribute('src', '/branding/solanime-compact-dark.webp');
  await expect(navBrand.locator('svg')).toHaveCount(0);

  await page.getByRole('navigation', { name: 'Primary navigation' })
    .getByRole('link', { name: 'Browse', exact: true }).click();
  await expect(page).toHaveURL('/catalogue');
  await page.getByRole('navigation', { name: 'Primary navigation' })
    .getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page).toHaveURL('/');
  await expect(readiness).toHaveCount(0);
  await expect(page.locator('#featured-title')).toBeVisible();
  await noOverflow(page);
});

test('failed primary loading presents one actionable error and can recover without replay', async ({ page }) => {
  let failPrimary = true;
  await page.route('**/api/titles?*', async route => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get('pageSize') === '13' && failPrimary) {
      await route.fulfill({ status: 503, contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'TEST_UNAVAILABLE', message: 'Catalogue temporarily unavailable.' } }) });
    } else await route.continue();
  });
  await page.goto('/');
  await expect(page.locator('.sol-brand-readiness')).toHaveAttribute('data-readiness', 'error');
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Continue without waiting', exact: true }).click();
  await expect(page.locator('.sol-brand-readiness')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(1);
  failPrimary = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('#featured-title')).toBeVisible();
  await expect(page.locator('.sol-brand-readiness')).toHaveCount(0);
});
