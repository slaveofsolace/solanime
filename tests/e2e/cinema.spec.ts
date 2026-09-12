import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const image =
  '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="510"><rect width="360" height="510" fill="#253744"/><circle cx="180" cy="180" r="85" fill="#efb083"/><path d="M0 460 150 250 280 400 360 285V510H0Z" fill="#476570"/></svg>';
test.beforeEach(async ({ page }) => {
  await page.route('https://images.example.test/**', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: image }),
  );
});
async function getEpisode(page: Page) {
  return (await (await page.request.get('/api/titles/paper-lantern')).json()).episodes[0];
}
async function appearance(page: Page) {
  await page.getByRole('button', { name: 'Customize appearance' }).click();
  return page.getByRole('dialog', { name: 'Make it yours', exact: true });
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}
test('preset and custom accents persist, validate input, and restore focus', async ({
  page,
}, info) => {
  await page.goto('/');
  const dialog = await appearance(page);
  await dialog.getByRole('button', { name: 'Violet', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-accent', '#A78BFA');
  await dialog.getByRole('textbox', { name: 'Custom hex' }).fill('#GGGGGG');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Custom hex' }).fill('#00aa88');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-accent', '#00AA88');
  await dialog.getByRole('button', { name: 'Light', exact: true }).click();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
  await page.screenshot({ path: info.outputPath('appearance-custom.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Customize appearance' })).toBeFocused();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-accent', '#00AA88');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await appearance(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Reset accent' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-accent', '#AE9CFF');
  await noOverflow(page);
});
test('quick-look details preserve catalogue position and saved state', async ({ page }, info) => {
  await page.goto('/catalogue?q=Paper');
  const trigger = page.getByRole('button', { name: 'Quick look at Paper Lantern', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Paper Lantern', { exact: true }).first()).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'View episodes' })).toBeVisible();
  await dialog.getByRole('button', { name: 'My list', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('quick-look.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expect(trigger).toBeFocused();
  await expect(page).toHaveURL(/catalogue\?q=Paper/);
  await noOverflow(page);
});
test('rails expose keyboard-accessible scrolling without expanding the page', async ({ page }) => {
  await page.goto('/');
  const region = page.getByRole('region', { name: 'Recent updates' });
  await expect(region.locator('.title-card').first()).toBeVisible();
  const track = region.locator('.rail-track');
  const before = await track.evaluate((el) => el.scrollLeft);
  await region.getByRole('button', { name: 'Next Recent updates' }).click();
  await expect.poll(() => track.evaluate((el) => el.scrollLeft)).toBeGreaterThan(before);
  await region.getByRole('button', { name: 'Previous Recent updates' }).click();
  await expect.poll(() => track.evaluate((el) => el.scrollLeft)).toBe(0);
  await noOverflow(page);
});
