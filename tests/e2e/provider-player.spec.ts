import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { episode, fixtureArt, noOverflow } from './helpers';

async function serveProvider(page: Page, embedUrl: string) {
  let resolutionRequests = 0;
  await page.route('**/api/episodes/*/providers*', async (route) => {
    const response = await route.fetch();
    const payload = (await response.json()) as Record<string, unknown>;
    await route.fulfill({
      response,
      json: {
        ...payload,
        providers: [{
          mappingId: 'mapping-embed',
          providerId: 'hd-1',
          label: 'HD-1',
          playbackType: 'iframe',
          status: 'available',
          supported: true,
          kind: 'embed',
        }],
      },
    });
  });
  await page.route('**/api/providers/*/resolve', (route) => {
    resolutionRequests += 1;
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        kind: 'embed',
        delivery: 'provider',
        mappingId: 'mapping-embed',
        providerId: 'hd-1',
        language: 'sub',
        playbackType: 'iframe',
        status: 'resolved',
        embedUrl,
        allowedEmbedHosts: ['megaplay.buzz'],
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    });
  });
  return () => resolutionRequests;
}

test('an incomplete provider embed response cannot mount a player', async ({ page }) => {
  const first = await episode(page);
  const resolutionRequests = await serveProvider(
    page,
    'https://megaplay.buzz/stream/s-2/12345/sub',
  );
  await page.route('https://megaplay.buzz/stream/s-2/12345/sub', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Provider fixture</title><p>Player</p>' }),
  );

  await page.goto(`/watch/paper-lantern/${first.id}?language=sub`);
  await expect(page.getByRole('heading', { name: 'This source cannot play here' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Playback source' })).toHaveValue('mapping-embed');
  await expect(page.locator('video, iframe')).toHaveCount(0);
  expect(resolutionRequests()).toBe(1);
  expect(page.context().pages()).toHaveLength(1);
  await noOverflow(page);
});
test('a lookalike iframe origin cannot mount or navigate the parent', async ({ page }) => {
  const first = await episode(page);
  const resolutionRequests = await serveProvider(
    page,
    'https://megaplay.buzz.evil.example/stream/s-2/12345/sub',
  );

  await page.goto(`/watch/paper-lantern/${first.id}?language=sub&server=mapping-embed`);
  await expect(page.getByRole('heading', { name: 'This source cannot play here' })).toBeVisible();
  await expect(page.locator('iframe, video')).toHaveCount(0);
  expect(resolutionRequests()).toBe(1);
  await expect(page).toHaveURL(new RegExp(`/watch/paper-lantern/${first.id}`));
  expect(page.context().pages()).toHaveLength(1);
});

test('browser-only provider mode stays compatible and discloses its actual protection boundary', async ({ page }, testInfo) => {
  await fixtureArt(page);
  const first = await episode(page);
  const embedUrl = 'https://megaplay.buzz/stream/s-2/12345/sub?s=tcdn';
  await serveProvider(page, embedUrl);
  await page.route(embedUrl, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Provider test</title><button>Play</button>' }));
  await page.goto(`/watch/paper-lantern/${first.id}?language=sub&server=mapping-embed`);
  const frame = page.locator('iframe[title="MegaPlay provider player"]');
  await expect(frame).toBeVisible();
  expect(await frame.getAttribute('sandbox')).toBeNull();
  await expect(page.locator('.provider-player')).toHaveAttribute('data-guard-mode', 'browser');
  await expect(page.getByText('Built-in Guard · On')).toHaveCount(0);
  const summary = page.getByText('About this player');
  await summary.click();
  await expect(page.getByText(/Popup and redirect blocking depends on your browser/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Desktop Guard' })).toHaveAttribute('download', '');
  await noOverflow(page);
  const accessibility = await new AxeBuilder({ page }).include('.provider-player__footer').analyze();
  expect(accessibility.violations.filter(item => ['serious', 'critical'].includes(item.impact ?? ''))).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('browser-provider-mode.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await noOverflow(page);
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.provider-player__notice')).not.toHaveAttribute('open', '');
  await page.keyboard.press('Enter');
  await expect(page.locator('.provider-player__notice')).toHaveAttribute('open', '');
  await page.screenshot({ path: testInfo.outputPath('browser-provider-320-light.png'), fullPage: true });
  await page.setViewportSize({ width: 720, height: 1000 });
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  await noOverflow(page);
});

test('default source favors an official publisher over an uncontained provider iframe', async ({ page }) => {
  const first = await episode(page);
  const resolved: string[] = [];
  await page.route('**/api/episodes/*/providers*', async (route) => {
    const response = await route.fetch();
    const payload = (await response.json()) as Record<string, unknown>;
    await route.fulfill({
      response,
      json: {
        ...payload,
        providers: [
          { mappingId: 'mapping-embed', providerId: 'hd-1', label: 'HD-1', playbackType: 'iframe', status: 'available', supported: true, kind: 'embed' },
          { mappingId: 'mapping-official', providerId: 'youtube-official', label: 'YouTube', playbackType: 'iframe', status: 'available', supported: true, kind: 'official-youtube' },
        ],
      },
    });
  });
  await page.route('**/api/providers/*/resolve', (route) => {
    resolved.push(route.request().url());
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        kind: 'official-youtube',
        mappingId: 'mapping-official',
        providerId: 'youtube-official',
        language: 'sub',
        playbackType: 'iframe',
        status: 'resolved',
        delivery: 'provider',
        videoId: '_3Gcm-iGAQk',
        allowedEmbedHosts: ['www.youtube-nocookie.com'],
        publisher: {
          label: "It's Anime powered by REMOW",
          channelId: 'UCsj_CYajUSQ2ca8bYCMan9g',
          channelUrl: 'https://www.youtube.com/channel/UCsj_CYajUSQ2ca8bYCMan9g',
          handleUrl: 'https://www.youtube.com/@ItsAnimeJP',
        },
      }),
    });
  });

  await page.goto(`/watch/paper-lantern/${first.id}?language=sub`);
  await expect.poll(() => resolved.length).toBeGreaterThan(0);
  expect(resolved[0]).toContain('/api/providers/mapping-official/resolve');
  await expect(page.getByRole('combobox', { name: 'Playback source' })).toHaveValue('mapping-official');
  expect(resolved).toHaveLength(1);
});
