import { expect, test, type Page } from '@playwright/test';
import { episode, noOverflow } from './helpers';

async function serveProvider(page: Page, embedUrl: string) {
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
        }],
      },
    });
  });
  await page.route('**/api/providers/*/resolve', (route) =>
    route.fulfill({
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
    }),
  );
}

test('verified MegaPlay embed stays inside the watch page with least-privilege navigation', async ({ page }) => {
  const first = await episode(page);
  await serveProvider(page, 'https://megaplay.buzz/stream/s-2/12345/sub');
  await page.route('https://megaplay.buzz/stream/s-2/12345/sub', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Provider fixture</title><p>Player</p>' }),
  );

  await page.goto(`/watch/paper-lantern/${first.id}?language=sub`);
  const frame = page.getByTitle('MegaPlay provider player');
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
  const sandbox = await frame.getAttribute('sandbox');
  expect(sandbox).not.toMatch(/popup|top-navigation|download|forms/);
  await expect(frame).toHaveAttribute('allow', 'autoplay; encrypted-media; fullscreen; picture-in-picture');
  await expect(page.locator('video')).toHaveCount(0);
  expect(page.context().pages()).toHaveLength(1);
  await noOverflow(page);
});
test('client policy rejects an alternate host even when a resolve response claims it is supported', async ({ page }) => {
  const first = await episode(page);
  await serveProvider(page, 'https://megaplay.buzz.evil.example/stream/s-2/12345/sub');

  await page.goto(`/watch/paper-lantern/${first.id}?language=sub`);
  await expect(page.getByRole('heading', { name: 'This source cannot play here' })).toBeVisible();
  await expect(page.locator('iframe, video')).toHaveCount(0);
  expect(page.context().pages()).toHaveLength(1);
});
