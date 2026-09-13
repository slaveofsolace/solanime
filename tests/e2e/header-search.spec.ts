import { test, expect } from '@playwright/test';
import { fixtureArt, noOverflow } from './helpers';

test.beforeEach(async ({ page }) => fixtureArt(page));

test('compact desktop search focuses, escapes, submits, and follows browser history', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Search all titles', exact: true });
  await expect(trigger).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Find titles', exact: true })).toHaveCount(0);
  await trigger.click();
  const input = page.getByRole('searchbox', { name: 'Find titles', exact: true });
  await expect(input).toBeFocused();
  await input.fill('Paper');
  await input.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.press('Enter');
  await expect(input).toHaveValue('Paper');
  await input.press('Enter');
  await expect(page).toHaveURL(/\/search\?q=Paper$/);
  await expect(page.getByRole('link', { name: 'Open Paper Lantern', exact: true })).toBeVisible();
  await expect(page.getByText('1 title', { exact: true })).toBeVisible();
  await expect(input).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL('/');
  await expect(page.locator('#featured-title')).toBeVisible();
  await trigger.click();
  await expect(input).toHaveValue('');
  await input.press('Escape');
  await page.goForward();
  await expect(page).toHaveURL(/\/search\?q=Paper$/);
  await expect(page.getByRole('link', { name: 'Open Paper Lantern', exact: true })).toBeVisible();
  await trigger.click();
  await expect(input).toHaveValue('Paper');
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('320px navigation retains a directly usable search entry without a hidden form taking space', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Search all titles', exact: true })).toBeHidden();
  const entry = page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Search', exact: true });
  await expect(entry).toBeVisible();
  await expect(entry.locator('.icon')).toBeVisible();
  await entry.click();
  const input = page.getByRole('searchbox', { name: 'Search catalogue' });
  await expect(input).toBeVisible();
  await input.fill('Paper');
  await input.press('Enter');
  await expect(page).toHaveURL(/\/search\?q=Paper$/);
  await expect(page.getByRole('link', { name: 'Open Paper Lantern', exact: true })).toBeVisible();
  await expect(page.getByText('1 title', { exact: true })).toBeVisible();
  await noOverflow(page);
});
