import { expect, test, type Page } from '@playwright/test';
import { episode, noOverflow } from './helpers';

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

test('provider iframe mappings are preserved without being offered as playable video', async ({ page }) => {
  const first = await episode(page);
  const resolutionRequests = await serveProvider(
    page,
    'https://megaplay.buzz/stream/s-2/12345/sub',
  );
  await page.route('https://megaplay.buzz/stream/s-2/12345/sub', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Provider fixture</title><p>Player</p>' }),
  );

  await page.goto(`/watch/paper-lantern/${first.id}?language=sub`);
  await expect(page.getByRole('heading', { name: 'No in-player stream' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Playback source' })).toBeDisabled();
  await expect(page.locator('video, iframe')).toHaveCount(0);
  expect(resolutionRequests()).toBe(0);
  expect(page.context().pages()).toHaveLength(1);
  await noOverflow(page);
});
test('a stale iframe server deep link cannot trigger resolution or navigation', async ({ page }) => {
  const first = await episode(page);
  const resolutionRequests = await serveProvider(
    page,
    'https://megaplay.buzz.evil.example/stream/s-2/12345/sub',
  );

  await page.goto(`/watch/paper-lantern/${first.id}?language=sub&server=mapping-embed`);
  await expect(page.getByRole('heading', { name: 'No in-player stream' })).toBeVisible();
  await expect(page.locator('iframe, video')).toHaveCount(0);
  expect(resolutionRequests()).toBe(0);
  expect(page.context().pages()).toHaveLength(1);
});
