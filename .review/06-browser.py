from pathlib import Path
r=Path.cwd()
def w(path,text):
 p=r/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text.strip()+'\n')
w('playwright.config.ts', '''import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', testMatch: '**/*.spec.ts', timeout: 30000, expect: { timeout: 10000 }, workers: 2, retries: process.env.CI ? 1 : 0, fullyParallel: true,
  outputDir: './test-results', reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:18787', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'node --import tsx tests/e2e/server.ts', url: 'http://127.0.0.1:18787/api/health', reuseExistingServer: false, timeout: 30000 },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 } } },
    { name: 'desktop-webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } },
  ],
});''')
w('tests/e2e/server.ts', '''import { resolve } from 'node:path';
import { createApp } from '../../server/app'; import { openDatabase, migrate } from '../../server/db'; import { importSnapshot } from '../../server/ingestion/snapshot'; import type { SnapshotTitle } from '../../server/types';
// This process cannot open or modify the user's catalogue file.
const db = openDatabase(':memory:'); migrate(db);
const titles: SnapshotTitle[] = Array.from({ length: 32 }, (_, index) => {
  const slug = index === 0 ? 'paper-lantern' : index === 1 ? 'long-journey' : `fixture-title-${index}`; const sourceId = `qa-title-${index}`;
  return {
    sourceId, slug, canonicalUrl: `https://anikototv.to/watch/${slug}`,
    name: index === 0 ? 'Paper Lantern' : index === 1 ? 'Long Journey' : `Fixture Title ${String(index).padStart(2, '0')}`,
    description: 'A fictional title used only to test catalogue navigation, episode selection, and saved preferences.',
    format: index % 4 === 0 ? 'Movie' : 'TV', releaseYear: 2020 + (index % 7), status: 'Finished Airing',
    artworkUrl: `https://images.example.test/${index}.svg`, artworkOrigin: 'test-fixture', artworkReuseStatus: 'original', genres: index % 2 ? ['Drama'] : ['Adventure', 'Drama'], aliases: [{ name: `Test alias ${index}` }],
    episodes: Array.from({ length: index === 1 ? 120 : 3 }, (_, episodeIndex) => {
      const id = `${sourceId}-ep-${episodeIndex + 1}`;
      return { sourceId: id, number: String(episodeIndex + 1), numberSort: episodeIndex + 1, label: `Episode ${episodeIndex + 1}`, slug: `ep-${episodeIndex + 1}`, canonicalUrl: `https://anikototv.to/watch/${slug}/ep-${episodeIndex + 1}`,
        versions: ['sub', 'dub'].map((language) => ({ sourceId: `${id}:${language}`, language, providers: ['hd-1', 'hd-2', 'kiwi'].map((providerId) => ({ sourceMappingId: `${id}:${language}:${providerId}`, providerId, providerResourceId: `fixture-${id}-${language}`, availability: providerId === 'kiwi' ? 'unavailable' : 'available', unavailableReason: providerId === 'kiwi' ? 'Fixture: download-only provider.' : undefined })) })),
      };
    }),
  };
});
importSnapshot(db, { schemaVersion: 1, source: 'anikoto', observedAt: '2026-09-11T00:00:00.000Z', titles });
const server = createApp(db, { staticDirectory: resolve('dist'), resolutionCooldownMs: 0, resolveProvider: async (mapping) => ({ mappingId: mapping.mappingId, providerId: mapping.providerId, playbackType: 'iframe', status: 'resolved', embedUrl: `https://megaplay.buzz/stream/s-2/fixture-${mapping.mappingId}` }) });
server.listen(18787, '127.0.0.1', () => console.log('Isolated browser fixture API on 127.0.0.1:18787'));
function stop() { server.close(() => { db.close(); process.exit(0); }); server.closeAllConnections(); }
process.once('SIGINT', stop); process.once('SIGTERM', stop);''')
w('tests/e2e/application.spec.ts',r'''import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs'; import { resolve } from 'node:path';
const image = '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="510" viewBox="0 0 360 510"><rect width="360" height="510" fill="#203747"/><circle cx="180" cy="185" r="80" fill="#edb17e"/><path d="M0 430 140 275 240 360 360 210V510H0Z" fill="#425c68"/></svg>';
test.beforeEach(async ({ page }) => {
  await page.route('https://images.example.test/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: image }));
  await page.route('https://megaplay.buzz/**', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><title>Isolated test player</title><body style="background:#17222b;color:white"><h1>Fixture player</h1><p>No external video connection.</p></body></html>' }));
});
async function noOverflow(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true); }
async function episode(page: Page) { const data = await (await page.request.get('/api/titles/paper-lantern')).json(); return { title: data.title, first: data.episodes[0], second: data.episodes[1] }; }
test('browse, search, save and reopen a persistent watchlist', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'Explore anime' })).toBeVisible();
  await page.goto('/catalogue?q=Paper'); await expect(page.getByRole('link', { name: 'Open Paper Lantern', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save Paper Lantern to your list', exact: true }).click();
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: /My list/ }).click();
  await expect(page.getByRole('link', { name: 'Open Paper Lantern', exact: true })).toBeVisible(); await page.reload(); await expect(page.getByRole('link', { name: 'Open Paper Lantern', exact: true })).toBeVisible();
  await noOverflow(page); expect(errors).toEqual([]);
});
test('corrupt saved browser data cannot blank the application', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('sol-anime:watchlist-records', 'null'); localStorage.setItem('sol-anime:history', '{"not":"an array"}'); localStorage.setItem('sol-anime:preferences', '{"theme":{},"autoplayNext":"yes"}'); });
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message)); await page.goto('/catalogue'); await expect(page.locator('.title-card').first()).toBeVisible(); expect(errors).toEqual([]);
});
test('HTML API errors are actionable and Try again retries', async ({ page }) => {
  let failures = 1; let requests = 0;
  await page.route('**/api/titles?**', (route) => { requests++; if (failures-- > 0) return route.fulfill({ contentType: 'text/html', body: '<html>wrong static host</html>' }); return route.continue(); });
  await page.goto('/catalogue'); await expect(page.getByText('The catalogue API is not connected.', { exact: false })).toBeVisible(); await page.getByRole('button', { name: 'Try again', exact: true }).click(); await expect(page.locator('.title-card').first()).toBeVisible(); expect(requests).toBeGreaterThan(1);
});
test('episode search stays paginated and a new title resets its range', async ({ page }) => {
  await page.goto('/title/long-journey'); await expect(page.locator('.episode-grid > li')).toHaveCount(50);
  await page.getByRole('group', { name: 'Episode range' }).getByRole('button', { name: '51–100', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Find an episode' }).fill('Episode');
  await expect(page.getByRole('group', { name: 'Episode range' }).getByRole('button', { name: '1–50', exact: true })).toHaveAttribute('aria-pressed', 'true'); await expect(page.locator('.episode-grid > li')).toHaveCount(50);
  await page.goto('/title/paper-lantern'); await expect(page.locator('.episode-grid > li')).toHaveCount(3); await noOverflow(page);
});
test('server switching, failed connections and history follow the selected source', async ({ page }) => {
  const data = await episode(page); await page.goto(`/watch/paper-lantern/${data.first.id}?language=sub`); await expect(page.getByRole('button', { name: 'Play here', exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sol-anime:history') ?? '[]'))).toHaveLength(0);
  await page.getByRole('button', { name: 'Play here', exact: true }).click(); await expect(page.locator('iframe')).toHaveCount(1);
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('sol-anime:history') ?? '[]').length)).toBe(1);
  await page.route('**/api/providers/*/resolve', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: { code: 'FIXTURE_FAILURE', message: 'Controlled failure for retry test.' } }) }));
  await page.locator('.server-list button').filter({ hasText: 'HD-2' }).click(); await expect(page.getByText('Controlled failure for retry test.', { exact: false })).toBeVisible(); await expect(page.locator('iframe')).toHaveCount(0);
  await page.unroute('**/api/providers/*/resolve'); await page.getByRole('button', { name: 'Retry selected server' }).click(); await expect(page.getByRole('button', { name: 'Play here', exact: true })).toBeVisible();
  await expect(page.locator('.server-list button').filter({ hasText: 'HD-2' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('group', { name: 'Episode language' }).getByRole('button', { name: 'dub', exact: true }).click(); await expect(page).toHaveURL(/language=dub/); await expect(page.getByRole('button', { name: 'Play here', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Next/ }).click(); await expect(page).toHaveURL(new RegExp(`/watch/paper-lantern/${data.second.id}\\?language=dub`)); await expect(page.getByRole('button', { name: 'Play here', exact: true })).toBeVisible(); await noOverflow(page);
});
test('provider list failures have a working retry', async ({ page }) => {
  const data = await episode(page); let first = true;
  await page.route('**/api/episodes/*/providers?*', (route) => { if (first) { first = false; return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"message":"Fixture provider list unavailable"}}' }); } return route.continue(); });
  await page.goto(`/watch/paper-lantern/${data.first.id}?language=sub`); await page.getByRole('button', { name: 'Retry selected server' }).click(); await expect(page.getByRole('button', { name: 'Play here', exact: true })).toBeVisible();
});
test('a late response cannot overwrite a newer selection', async ({ page }) => {
  const data = await episode(page); let delayed = true;
  await page.route('**/api/providers/*/resolve', async (route) => { if (delayed) { delayed = false; await new Promise((resolve) => setTimeout(resolve, 700)); } try { await route.continue(); } catch { /* Superseded requests may be cancelled. */ } });
  await page.goto(`/watch/paper-lantern/${data.first.id}?language=sub`); await page.locator('.server-list button').filter({ hasText: 'HD-2' }).click();
  await expect(page.locator('.server-list button').filter({ hasText: 'HD-2' })).toHaveAttribute('aria-pressed', 'true'); await page.waitForTimeout(800); await expect(page.locator('.server-list button').filter({ hasText: 'HD-2' })).toHaveAttribute('aria-pressed', 'true');
});
test('native media advances and moves to the next episode only after ending', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sol-anime:preferences', JSON.stringify({ autoplayNext: true, rememberProgress: true, preferredLanguage: 'sub', theme: 'dark' })));
  const data = await episode(page);
  await page.route('**/api/providers/*/resolve', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ mappingId: route.request().url().split('/').at(-2), providerId: 'hd-1', playbackType: 'direct', status: 'resolved', url: '/__fixture/motion.mp4' }) }));
  await page.route('**/__fixture/motion.mp4', (route) => route.fulfill({ contentType: 'video/mp4', body: readFileSync(resolve('tests/fixtures/motion.mp4')) }));
  await page.goto(`/watch/paper-lantern/${data.first.id}?language=sub`); const video = page.locator('video'); await expect(video).toBeVisible(); await video.evaluate(async (element: HTMLVideoElement) => { element.muted = true; await element.play(); });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0.2); await video.evaluate((element: HTMLVideoElement) => { element.currentTime = element.duration - 0.3; });
  await expect(page).toHaveURL(new RegExp(`/watch/paper-lantern/${data.second.id}\\?language=sub`));
});
test('theme, layout and accessibility remain usable', async ({ page }, testInfo) => {
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'Explore anime' })).toBeVisible(); await page.getByRole('button', { name: 'Use light theme' }).click(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light'); await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  for (const path of ['/', '/catalogue', '/title/paper-lantern', '/library']) {
    await page.goto(path); await expect(page.locator('main h1')).toBeVisible(); if (path === '/catalogue') await expect(page.locator('.title-card').first()).toBeVisible(); await noOverflow(page);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze(); expect(results.violations.map((item) => ({ id: item.id, nodes: item.nodes.map((node) => node.target) }))).toEqual([]);
  }
  await page.goto('/catalogue'); await expect(page.locator('.title-card').first()).toBeVisible(); await page.screenshot({ path: testInfo.outputPath('catalogue-light.png'), fullPage: true });
  await page.getByRole('button', { name: 'Use dark theme' }).click(); await page.goto('/'); await expect(page.locator('.home-feature')).toBeVisible(); await page.screenshot({ path: testInfo.outputPath('home-dark.png'), fullPage: true });
});''')
w('tests/fixtures/README.md', '''# Browser test assets

`motion.mp4` is an original four-second synthetic test pattern, not an anime episode. It is used only by the isolated browser tests and is not copied into the application build.

Regenerate with FFmpeg:

```sh
ffmpeg -f lavfi -i 'testsrc2=size=160x90:rate=10' -t 4 -c:v libx264 -crf 40 -preset veryslow -pix_fmt yuv420p -movflags +faststart motion.mp4
```

Browser tests use a fresh in-memory database. They cannot modify the imported catalogue and do not resolve live provider streams.''')
