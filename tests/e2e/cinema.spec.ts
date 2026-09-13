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
  await expect(page.locator('html')).toHaveAttribute('data-accent', '#EE791F');
  await noOverflow(page);
});
test('quick-look details preserve the originating route, focus and saved state', async ({ page, isMobile }, info) => {
  // Touch cards open the title; their preview entry is the featured More info
  // control. Desktop cards reveal quick look on pointer or keyboard intent.
  await page.goto(isMobile ? '/' : '/catalogue?q=Paper');
  let title = 'Paper Lantern';
  if (isMobile) {
    await expect(page.locator('#featured-title')).toBeVisible();
    title = await page.locator('#featured-title').innerText();
  } else {
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
  await region.getByRole('button', { name: 'Next Recent updates' }).click();
  await expect.poll(() => track.evaluate((el) => el.scrollLeft)).toBeGreaterThan(before);
  await region.getByRole('button', { name: 'Previous Recent updates' }).click();
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
  await revealActiveFacet();
  await page.getByRole('combobox', { name: 'Format' }).selectOption('tv');
  await expect(page).toHaveURL(/type=tv/);
  await expect(page.getByRole('combobox', { name: 'Format' })).toHaveValue('tv');
  await expect(page.locator('.title-card')).toHaveCount(24);
  await expect(page.locator('.title-card__meta > span:first-child')).toHaveText(
    Array.from({ length: 24 }, () => 'TV'),
  );

  await page.getByRole('combobox', { name: 'Format' }).selectOption('movie');
  await expect(page).toHaveURL(/type=movie/);
  await expect(page.getByRole('combobox', { name: 'Format' })).toHaveValue('movie');
  await expect(page.locator('.title-card')).toHaveCount(8);
  await expect(page.locator('.title-card__meta > span:first-child')).toHaveText(
    Array.from({ length: 8 }, () => 'Movie'),
  );

  await page.getByRole('combobox', { name: 'Format' }).selectOption('');
  await page.getByRole('combobox', { name: 'Language' }).selectOption('dub');
  await expect(page).toHaveURL(/language=dub/);
  await expect(page).not.toHaveURL(/type=/);
  await expect(page.getByRole('combobox', { name: 'Format' })).toHaveValue('');
  await expect(page.getByRole('combobox', { name: 'Language' })).toHaveValue('dub');
  await expect(page.locator('.title-card')).toHaveCount(24);
});
