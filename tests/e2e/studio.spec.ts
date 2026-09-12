import { test, expect } from '@playwright/test';
const art =
  '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="510"><rect width="360" height="510" fill="#263946"/><circle cx="180" cy="180" r="95" fill="#ebba8a"/></svg>';
test.beforeEach(async ({ page }) => {
  await page.route('https://images.example.test/**', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: art }),
  );
  await page.route('https://megaplay.buzz/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="en"><title>Controlled provider</title><body style="background:#111;color:white"><p id="loaded">Player document loaded</p></body></html>',
    }),
  );
});
test('compatibility is the initial mode and survives episode, language, source and reload changes', async ({
  page,
}) => {
  const data = await (await page.request.get('/api/titles/paper-lantern')).json();
  await page.goto(`/watch/paper-lantern/${data.episodes[0].id}?language=sub`);
  await page.getByRole('button', { name: 'Play here', exact: true }).click();
  await expect(page.locator('iframe')).not.toHaveAttribute('sandbox', /.*/);
  await expect(page.frameLocator('iframe').locator('#loaded')).toBeVisible();
  await page.getByRole('button', { name: 'Theater mode', exact: true }).click();
  await page.getByRole('button', { name: /^Next/ }).click();
  await expect(page.locator('.watch-page')).toHaveClass(/watch-page--theater/);
  await page.getByRole('button', { name: 'Play here', exact: true }).click();
  await expect(page.locator('iframe')).not.toHaveAttribute('sandbox', /.*/);
  await page
    .getByRole('group', { name: 'Episode language' })
    .getByRole('button', { name: 'dub', exact: true })
    .click();
  await page.getByRole('button', { name: 'Play here', exact: true }).click();
  await expect(page.locator('iframe')).not.toHaveAttribute('sandbox', /.*/);
  await page.locator('.server-list button').filter({ hasText: 'HD-2' }).click();
  await page.getByRole('button', { name: 'Play here', exact: true }).click();
  await expect(page.locator('iframe')).not.toHaveAttribute('sandbox', /.*/);
  await page.reload();
  await page.getByRole('button', { name: 'Play here', exact: true }).click();
  await expect(page.locator('iframe')).not.toHaveAttribute('sandbox', /.*/);
});
test('explicit restricted mode persists and the sandbox repair recreates a standard frame', async ({
  page,
}) => {
  const data = await (await page.request.get('/api/titles/paper-lantern')).json();
  await page.goto(`/watch/paper-lantern/${data.episodes[0].id}?language=sub`);
  await page.getByRole('button', { name: 'Play here', exact: true }).click();
  await page.locator('.player-help summary').click();
  const original = await page.locator('iframe').elementHandle();
  await page.getByRole('button', { name: 'Restricted embed', exact: true }).click();
  expect(await original!.evaluate((el) => el.isConnected)).toBe(false);
  await expect(page.locator('iframe')).toHaveAttribute(
    'sandbox',
    'allow-scripts allow-same-origin',
  );
  await page.reload();
  await page.getByRole('button', { name: 'Play here', exact: true }).click();
  await expect(page.locator('iframe')).toHaveAttribute(
    'sandbox',
    'allow-scripts allow-same-origin',
  );
  await page.locator('.player-help summary').click();
  const restricted = await page.locator('iframe').elementHandle();
  await page.getByRole('button', { name: 'Fix sandbox warning', exact: true }).click();
  expect(await restricted!.evaluate((el) => el.isConnected)).toBe(false);
  await expect(page.locator('iframe')).not.toHaveAttribute('sandbox', /.*/);
  await page.reload();
  await page.getByRole('button', { name: 'Play here', exact: true }).click();
  await expect(page.locator('iframe')).not.toHaveAttribute('sandbox', /.*/);
});
test('spotlight navigation changes the actual title and links, without an autoplay timer', async ({
  page,
}, info) => {
  await page.goto('/');
  await expect(page.locator('#featured-title')).toBeVisible();
  const initial = await page.locator('#featured-title').innerText();
  const link = await page
    .getByRole('link', { name: 'View episodes', exact: true })
    .getAttribute('href');
  await page.getByRole('button', { name: 'Next featured title', exact: true }).click();
  await expect(page.locator('#featured-title')).not.toHaveText(initial);
  await expect(page.getByRole('link', { name: 'View episodes', exact: true })).not.toHaveAttribute(
    'href',
    link!,
  );
  await page.getByRole('button', { name: 'Previous featured title', exact: true }).click();
  await expect(page.locator('#featured-title')).toHaveText(initial);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: info.outputPath('studio-home.png'), fullPage: true });
});
test('reduced motion persists and does not remount a loaded player', async ({ page }) => {
  const data = await (await page.request.get('/api/titles/paper-lantern')).json();
  await page.goto(`/watch/paper-lantern/${data.episodes[0].id}?language=sub`);
  await page.getByRole('button', { name: 'Play here', exact: true }).click();
  const frame = await page.locator('iframe').elementHandle();
  await page.getByRole('button', { name: 'Customize appearance' }).click();
  await page.getByRole('button', { name: 'Reduce motion', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  expect(await page.getByRole('dialog').evaluate((el) => getComputedStyle(el).animationName)).toBe(
    'none',
  );
  await page.getByRole('button', { name: 'Close dialog' }).click();
  expect(await frame!.evaluate((el) => el.isConnected)).toBe(true);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
});
test('the served frontend and backend advertise the same release', async ({ page }) => {
  await page.goto('/catalogue');
  await expect(page.getByLabel('Solanime version 0.5.0')).toBeVisible();
  const health = await (await page.request.get('/api/health')).json();
  expect(health.release).toBe('0.5.0');
  await page.setViewportSize({ width: 320, height: 740 });
  await expect(page.locator('.title-card').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
});
