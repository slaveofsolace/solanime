import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const image =
  '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="510"><rect width="360" height="510" fill="#253744"/><circle cx="180" cy="180" r="85" fill="#efb083"/><path d="M0 460 150 250 280 400 360 285V510H0Z" fill="#476570"/></svg>';
test.beforeEach(async ({ page }) => {
  await page.route('https://images.example.test/**', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: image }),
  );
  await page.route('https://megaplay.buzz/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="en"><title>Test player</title><body><h1>Controlled player</h1><button id="popup" onclick="window.open(\'https://unwanted.example/\',\'_blank\')">Open unwanted popup</button><button id="navigate" onclick="top.location.href=\'https://unwanted.example/\'">Navigate top</button><p id="marker">Player active</p></body></html>',
    }),
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
  await expect(page.locator('html')).toHaveAttribute('data-accent', '#E50914');
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
test('iframe cannot open a popup or navigate its parent, and accent changes keep it mounted', async ({
  page,
  context,
}, info) => {
  const episode = await getEpisode(page);
  await page.goto(`/watch/paper-lantern/${episode.id}?language=sub`);
  await expect(page.getByText('This opens a third-party player.', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'Play here', exact: true }).click();
  const iframe = page.locator('iframe');
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin');
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('#marker')).toHaveText('Player active');
  const initialUrl = page.url();
  const initialPages = context.pages().length;
  const handle = await iframe.elementHandle();
  await frame.locator('#popup').click();
  await frame.locator('#navigate').click();
  await page.waitForTimeout(250);
  expect(context.pages().length).toBe(initialPages);
  expect(page.url()).toBe(initialUrl);
  const dialog = await appearance(page);
  await dialog.getByRole('button', { name: 'Jade', exact: true }).click();
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  expect(await handle!.evaluate((el) => el.isConnected)).toBe(true);
  await expect(frame.locator('#marker')).toHaveText('Player active');
  await page.getByRole('button', { name: 'Theater mode', exact: true }).click();
  await expect(page.locator('.watch-page')).toHaveClass(/watch-page--theater/);
  await page.screenshot({ path: info.outputPath('protected-watch.png'), fullPage: true });
  await noOverflow(page);
});
test('native controls drive actual playback, speed, mute, and theme without resetting time', async ({
  page,
}, info) => {
  const episode = await getEpisode(page);
  await page.route('**/api/providers/*/resolve', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        mappingId: route.request().url().split('/').at(-2),
        providerId: 'hd-1',
        status: 'resolved',
        playbackType: 'direct',
        url: '/__fixture/motion.mp4',
      }),
    }),
  );
  await page.goto(`/watch/paper-lantern/${episode.id}?language=sub`);
  await page.getByRole('button', { name: 'Mute video', exact: true }).click();
  await page.getByRole('button', { name: 'Play video', exact: true }).click();
  const video = page.locator('video');
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeGreaterThan(0.15);
  await page.getByRole('button', { name: 'Pause video', exact: true }).click();
  const time = await video.evaluate((el: HTMLVideoElement) => el.currentTime);
  await page.getByRole('combobox', { name: 'Playback speed' }).selectOption('1.5');
  expect(await video.evaluate((el: HTMLVideoElement) => el.playbackRate)).toBe(1.5);
  const dialog = await appearance(page);
  await dialog.getByRole('button', { name: 'Sky', exact: true }).click();
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  expect(await video.evaluate((el: HTMLVideoElement) => el.currentTime)).toBeCloseTo(time, 1);
  await page.screenshot({ path: info.outputPath('native-player.png'), fullPage: true });
  await noOverflow(page);
});
