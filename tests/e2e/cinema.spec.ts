import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { accountFixture } from './account-fixture';
const image =
  '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="510"><rect width="360" height="510" fill="#253744"/><circle cx="180" cy="180" r="85" fill="#efb083"/><path d="M0 460 150 250 280 400 360 285V510H0Z" fill="#476570"/></svg>';
test.beforeEach(async ({ page }) => {
  await page.route('https://images.example.test/**', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: image }),
  );
});
async function appearance(page: Page) {
  await page.getByRole('banner').getByRole('link', { name: 'Settings', exact: true }).click();
  return page.locator('#appearance');
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}
test('profile appearance presets and custom accents persist and validate input', async ({
  page,
}, info) => {
  await accountFixture(page);
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
  await page.getByRole('banner').getByRole('link', { name: 'Sol Anime home', exact: true }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-accent', '#00AA88');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await appearance(page);
  await page.locator('#appearance').getByRole('button', { name: 'Reset accent' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-accent', '#EE791F');
  await noOverflow(page);
});
test('quick-look details preserve the originating route, focus and saved state', async ({ page, isMobile }, info) => {
  await accountFixture(page);
  // Touch cards use direct series navigation; desktop retains the focus-restoring dialog.
  await page.goto('/catalogue?q=Paper');
  let title = 'Paper Lantern';
  if (isMobile) {
    await page.getByRole('link', { name: 'Open Paper Lantern', exact: true }).click();
    await expect(page.locator('#title-name')).toHaveText(title);
    await page.locator('.title-hero__actions').getByRole('button', { name: 'My List', exact: true }).click();
    await page.goBack();
    await expect(page).toHaveURL(/\/catalogue\?q=Paper$/);
    await page.goto('/library');
    await expect(page.getByRole('link', { name: `Open ${title}`, exact: true })).toBeVisible();
    return;
  } else {
    await expect(page.getByRole('link', { name: 'Open Paper Lantern', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Open Paper Lantern', exact: true }).focus();
  }
  const trigger = page.getByRole('button', {
    name: isMobile ? 'More info' : 'Quick look at Paper Lantern', exact: true,
  });
  // Measure the position from which the user can actually press the control;
  // mobile WebKit otherwise scrolls it into view as part of click actionability.
  await trigger.scrollIntoViewIfNeeded();
  const originalUrl = page.url();
  const originalScroll = await page.evaluate(() => scrollY);
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(title, { exact: true }).first()).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'View episodes' })).toBeVisible();
  await dialog.getByRole('button', { name: 'My list', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('quick-look.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expect(trigger).toBeFocused();
  await expect(page).toHaveURL(originalUrl);
  await expect.poll(async () => Math.abs(await page.evaluate(() => scrollY) - originalScroll)).toBeLessThanOrEqual(1);
  await noOverflow(page);
  await page.goto('/library');
  await expect(page.getByRole('link', { name: `Open ${title}`, exact: true })).toBeVisible();
});
test('rails expose keyboard-accessible scrolling without expanding the page', async ({ page }) => {
  await page.goto('/');
  const region = page.getByRole('region', { name: 'Recent updates' });
  await expect(region.locator('.title-card').first()).toBeVisible();
  const track = region.locator('.rail-track');
  const before = await track.evaluate((el) => el.scrollLeft);
  await track.focus();
  await track.press('ArrowRight');
  await expect.poll(() => track.evaluate((el) => el.scrollLeft)).toBeGreaterThan(before);
  await track.press('Home');
  await expect.poll(() => track.evaluate((el) => el.scrollLeft)).toBe(0);
  await noOverflow(page);
});

test('catalogue format and language controls return matching imported records', async ({ page }) => {
  const revealActiveFacet = async () => {
    const disclosure = page.locator('.filter-disclosure');
    const summary = disclosure.locator('summary');
    await expect(disclosure).not.toHaveAttribute('open');
    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(disclosure).toHaveAttribute('open', '');
  };

  await page.goto('/catalogue');
  await expect(page.locator('.title-card').first()).toBeVisible();
  await revealActiveFacet();
  await page.getByRole('combobox', { name: 'Format' }).selectOption('tv');
  await expect(page).toHaveURL(/type=tv/);
  await expect(page.getByRole('combobox', { name: 'Format' })).toHaveValue('tv');
  await expect(page.locator('.title-card')).toHaveCount(24);
  const tv = await (await page.request.get('/api/titles?type=tv&pageSize=24&sort=updated')).json();
  expect(tv.items).toHaveLength(24);
  expect(tv.items.every((item: { type: string }) => item.type === 'TV')).toBe(true);
  await expect(page.locator('.title-card__copy h2')).toHaveText(tv.items.map((item: { name: string }) => item.name));

  await page.getByRole('combobox', { name: 'Format' }).selectOption('movie');
  await expect(page).toHaveURL(/type=movie/);
  await expect(page.getByRole('combobox', { name: 'Format' })).toHaveValue('movie');
  const movieCards = page.locator('.title-card');
  await expect(movieCards.first()).toBeVisible();
  const movieCount = await movieCards.count();
  expect(movieCount).toBeGreaterThan(0);
  const movies = await (await page.request.get('/api/titles?type=movie&pageSize=24&sort=updated')).json();
  expect(movies.items.every((item: { type: string }) => item.type === 'Movie')).toBe(true);
  await expect(page.locator('.title-card__copy h2')).toHaveText(movies.items.map((item: { name: string }) => item.name));

  await page.getByRole('combobox', { name: 'Format' }).selectOption('');
  await page.getByRole('combobox', { name: 'Language' }).selectOption('dub');
  await expect(page).toHaveURL(/language=dub/);
  await expect(page).not.toHaveURL(/type=/);
  await expect(page.getByRole('combobox', { name: 'Format' })).toHaveValue('');
  await expect(page.getByRole('combobox', { name: 'Language' })).toHaveValue('dub');
  await expect(page.locator('.title-card')).toHaveCount(24);
});
