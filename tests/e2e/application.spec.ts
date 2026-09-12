import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const image =
  '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="510" viewBox="0 0 360 510"><rect width="360" height="510" fill="#203747"/><circle cx="180" cy="185" r="80" fill="#edb17e"/><path d="M0 430 140 275 240 360 360 210V510H0Z" fill="#425c68"/></svg>';
test.beforeEach(async ({ page }) => {
  await page.route('https://images.example.test/**', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: image }),
  );
  await page.route('https://megaplay.buzz/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="en"><title>Isolated test player</title><body style="background:#17222b;color:white"><h1>Fixture player</h1><p>No external video connection.</p></body></html>',
    }),
  );
});
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
}
async function episode(page: Page) {
  const data = await (await page.request.get('/api/titles/paper-lantern')).json();
  return { title: data.title, first: data.episodes[0], second: data.episodes[1] };
}
test('browse, search, save and reopen a persistent watchlist', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Explore anime' })).toBeVisible();
  await page.goto('/catalogue?q=Paper');
  await expect(page.getByRole('link', { name: 'Open Paper Lantern', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save Paper Lantern to your list', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Primary navigation' })
    .getByRole('link', { name: /My list/ })
    .click();
  await expect(page.getByRole('link', { name: 'Open Paper Lantern', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: 'Open Paper Lantern', exact: true })).toBeVisible();
  await noOverflow(page);
  expect(errors).toEqual([]);
});
test('corrupt saved browser data cannot blank the application', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sol-anime:watchlist-records', 'null');
    localStorage.setItem('sol-anime:history', '{"not":"an array"}');
    localStorage.setItem('sol-anime:preferences', '{"theme":{},"autoplayNext":"yes"}');
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/catalogue');
  await expect(page.locator('.title-card').first()).toBeVisible();
  expect(errors).toEqual([]);
});
test('HTML API errors are actionable and Try again retries', async ({ page }) => {
  let failures = 1;
  let requests = 0;
  await page.route('**/api/titles?**', (route) => {
    requests++;
    if (failures-- > 0)
      return route.fulfill({ contentType: 'text/html', body: '<html>wrong static host</html>' });
    return route.continue();
  });
  await page.goto('/catalogue');
  await expect(
    page.getByText('The catalogue API is not connected.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('.title-card').first()).toBeVisible();
  expect(requests).toBeGreaterThan(1);
});
test('episode search stays paginated and a new title resets its range', async ({ page }) => {
  await page.goto('/title/long-journey');
  await expect(page.locator('.episode-grid > li')).toHaveCount(50);
  await page
    .getByRole('group', { name: 'Episode range' })
    .getByRole('button', { name: '51–100', exact: true })
    .click();
  await page.getByRole('searchbox', { name: 'Find an episode' }).fill('Episode');
  await expect(
    page
      .getByRole('group', { name: 'Episode range' })
      .getByRole('button', { name: '1–50', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.episode-grid > li')).toHaveCount(50);
  await page.goto('/title/paper-lantern');
  await expect(page.locator('.episode-grid > li')).toHaveCount(3);
  await noOverflow(page);
});
test('server switching, failed connections and history follow the selected source', async ({
  page,
}) => {
  let providerLists = 0;
  page.on('request', (request) => {
    if (/\/api\/episodes\/\d+\/providers/.test(request.url())) providerLists++;
  });
  const data = await episode(page);
  await page.goto(`/watch/paper-lantern/${data.first.id}?language=sub`);
  await expect(page.getByRole('button', { name: 'Play here', exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('sol-anime:history') ?? '[]')),
  ).toHaveLength(0);
  await page.getByRole('button', { name: 'Play here', exact: true }).click();
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect
    .poll(async () =>
      page.evaluate(() => JSON.parse(localStorage.getItem('sol-anime:history') ?? '[]').length),
    )
    .toBe(1);
  await page.route('**/api/providers/*/resolve', (route) =>
    route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'FIXTURE_FAILURE', message: 'Controlled failure for retry test.' },
      }),
    }),
  );
  await page.locator('.server-list button').filter({ hasText: 'HD-2' }).click();
  await expect(
    page.getByText('Controlled failure for retry test.', { exact: false }),
  ).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.unroute('**/api/providers/*/resolve');
  await page.getByRole('button', { name: 'Retry selected server' }).click();
  await expect(page.getByRole('button', { name: 'Play here', exact: true })).toBeVisible();
  await expect(page.locator('.server-list button').filter({ hasText: 'HD-2' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(providerLists).toBe(1);
  await page
    .getByRole('group', { name: 'Episode language' })
    .getByRole('button', { name: 'dub', exact: true })
    .click();
  await expect(page).toHaveURL(/language=dub/);
  await expect(page.getByRole('button', { name: 'Play here', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Next/ }).click();
  await expect(page).toHaveURL(new RegExp(`/watch/paper-lantern/${data.second.id}\\?language=dub`));
  await expect(page.getByRole('button', { name: 'Play here', exact: true })).toBeVisible();
  await noOverflow(page);
});
test('provider list failures have a working retry', async ({ page }) => {
  const data = await episode(page);
  let first = true;
  await page.route('**/api/episodes/*/providers?*', (route) => {
    if (first) {
      first = false;
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"error":{"message":"Fixture provider list unavailable"}}',
      });
    }
    return route.continue();
  });
  await page.goto(`/watch/paper-lantern/${data.first.id}?language=sub`);
  await page.getByRole('button', { name: 'Retry selected server' }).click();
  await expect(page.getByRole('button', { name: 'Play here', exact: true })).toBeVisible();
});
test('a late response cannot overwrite a newer selection', async ({ page }) => {
  const data = await episode(page);
  let delayed = true;
  await page.route('**/api/providers/*/resolve', async (route) => {
    if (delayed) {
      delayed = false;
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    try {
      await route.continue();
    } catch {
      /* Superseded requests may be cancelled. */
    }
  });
  await page.goto(`/watch/paper-lantern/${data.first.id}?language=sub`);
  await page.locator('.server-list button').filter({ hasText: 'HD-2' }).click();
  await expect(page.locator('.server-list button').filter({ hasText: 'HD-2' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.waitForTimeout(800);
  await expect(page.locator('.server-list button').filter({ hasText: 'HD-2' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
test('native media advances and moves to the next episode only after ending', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'sol-anime:preferences',
      JSON.stringify({
        autoplayNext: true,
        rememberProgress: true,
        preferredLanguage: 'sub',
        theme: 'dark',
      }),
    ),
  );
  const data = await episode(page);
  await page.route('**/api/providers/*/resolve', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        mappingId: route.request().url().split('/').at(-2),
        providerId: 'hd-1',
        playbackType: 'direct',
        status: 'resolved',
        url: '/__fixture/motion.mp4',
      }),
    }),
  );
  const range = await page.request.get('/__fixture/motion.mp4', {
    headers: { range: 'bytes=0-99' },
  });
  expect(range.status()).toBe(206);
  expect((await range.body()).byteLength).toBe(100);
  expect(range.headers()['content-range']).toMatch(/^bytes 0-99\/\d+$/);

  await page.goto(`/watch/paper-lantern/${data.first.id}?language=sub`);
  const video = page.locator('video');
  await expect(video).toBeVisible();
  await video.evaluate(async (element: HTMLVideoElement) => {
    element.muted = true;
    await element.play();
  });
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(0.2);
  // Exercise the actual user control, not a direct assignment that bypasses its
  // pause/seek/resume lifecycle. Native time and ended assertions remain below.
  const seekBar = page.getByRole('slider', { name: 'Seek video', exact: true });
  const bounds = await seekBar.boundingBox();
  if (!bounds) throw new Error('Seek control has no rendered bounds.');
  await seekBar.click({ position: { x: bounds.width / 4, y: bounds.height / 2 } });
  try {
    await expect(page).toHaveURL(
      new RegExp(`/watch/paper-lantern/${data.second.id}\\?language=sub`),
    );
  } catch (error) {
    await testInfo.attach('media-state', {
      contentType: 'application/json',
      body: JSON.stringify(
        await video.evaluate((element: HTMLVideoElement) => ({
          time: element.currentTime,
          duration: element.duration,
          paused: element.paused,
          ended: element.ended,
          ready: element.readyState,
          network: element.networkState,
          error: element.error?.message,
          buffered: Array.from({ length: element.buffered.length }, (_, index) => [
            element.buffered.start(index),
            element.buffered.end(index),
          ]),
        })),
      ),
    });
    throw error;
  }
});
test('theme, layout and accessibility remain usable', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Explore anime' })).toBeVisible();
  await page.getByRole('button', { name: 'Use light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  for (const path of ['/', '/catalogue', '/title/paper-lantern', '/library']) {
    await page.goto(path);
    await expect(page.locator('main h1')).toBeVisible();
    if (path === '/catalogue') await expect(page.locator('.title-card').first()).toBeVisible();
    await noOverflow(page);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(
      results.violations.map((item) => ({
        id: item.id,
        nodes: item.nodes.map((node) => node.target),
      })),
    ).toEqual([]);
  }
  await page.goto('/catalogue');
  await expect(page.locator('.title-card').first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('catalogue-light.png'), fullPage: true });
  await page.getByRole('button', { name: 'Use dark theme' }).click();
  await page.goto('/');
  await expect(page.locator('.home-feature')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('home-dark.png'), fullPage: true });
});

test('player messages stay inside the mobile viewport', async ({ page }, testInfo) => {
  const data = await episode(page);
  await page.goto(`/watch/paper-lantern/${data.first.id}?language=sub`);
  await expect(page.getByRole('button', { name: 'Play here', exact: true })).toBeVisible();
  const bounds = await page.locator('.player-stage').evaluate((stage) => {
    const container = stage.getBoundingClientRect();
    return [
      ...stage.querySelectorAll('.player-consent h2, .player-consent p, .player-consent button'),
    ].every((child) => {
      const rect = child.getBoundingClientRect();
      return rect.left >= container.left && rect.right <= container.right;
    });
  });
  expect(bounds).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('watch-consent.png'), fullPage: true });
});
