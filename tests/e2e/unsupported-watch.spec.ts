import { expect, test, type Route } from '@playwright/test';
import { episode } from './helpers';

const unsupportedProviders = [
  {
    mappingId: 'observed-webpage',
    providerId: 'observed-webpage-provider',
    label: 'Observed webpage mirror',
    playbackType: 'iframe',
    status: 'observed',
    supported: false,
  },
  {
    mappingId: 'blocked-upstream',
    providerId: 'blocked-provider',
    label: 'Blocked upstream mirror',
    playbackType: 'unknown',
    status: 'blocked',
    supported: false,
  },
];

async function serveUnsupportedProviders(route: Route) {
  const response = await route.fetch();
  const payload = (await response.json()) as Record<string, unknown>;
  await route.fulfill({ response, json: { ...payload, providers: unsupportedProviders } });
}

test('watch exposes truthful observed-source status without offering unsafe playback', async ({ page }) => {
  const firstEpisode = await episode(page);
  await page.route('**/api/episodes/*/providers*', serveUnsupportedProviders);

  await page.goto(`/watch/paper-lantern/${firstEpisode.id}?language=sub`);

  await expect(
    page.getByRole('heading', { name: 'Not playable here yet' }),
  ).toBeVisible();
  await expect(page.getByText('2 sources found · none playable here')).toBeVisible();
  await page.getByText('Why each source is unavailable').click();
  await expect(page.getByRole('list', { name: 'Sources checked for this episode' })).toContainText(
    'Observed webpage mirror',
  );
  await expect(page.getByRole('list', { name: 'Sources checked for this episode' })).toContainText(
    'Blocked upstream',
  );
  await expect(page.getByRole('group', { name: 'Server', exact: true })).toHaveCount(0);
  await expect(page.getByText('No playable servers', { exact: true })).toBeVisible();
  await expect(page.locator('video, iframe')).toHaveCount(0);
});

test('unsupported source inventory remains usable at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  const firstEpisode = await episode(page);
  await page.route('**/api/episodes/*/providers*', serveUnsupportedProviders);

  await page.goto(`/watch/paper-lantern/${firstEpisode.id}?language=sub`);

  await page.getByText('Why each source is unavailable').click();
  await expect(
    page.getByRole('list', { name: 'Sources checked for this episode' }).getByText('Observed webpage mirror'),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
  ).toBe(true);
  const episodeControl = page.getByRole('button', { name: 'Next episode', exact: true });
  await episodeControl.focus();
  await expect(episodeControl).toBeFocused();
});

test('phones open the watch page on the player, with the way back above it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const firstEpisode = await episode(page);
  await page.route('**/api/episodes/*/providers*', serveUnsupportedProviders);

  await page.goto(`/watch/paper-lantern/${firstEpisode.id}?language=sub`);

  const back = page.getByRole('link', { name: 'Back to Paper Lantern' });
  await expect(page.getByRole('heading', { name: 'Not playable here yet' })).toBeVisible();
  await expect(back).toBeVisible();
  await expect(page.locator('.masthead')).toBeHidden();
  const playerBox = await page.locator('.player-stage').boundingBox();
  const backBox = await back.boundingBox();
  // An app-style top bar: the way back sits directly above the player.
  expect(backBox!.y + backBox!.height).toBeLessThanOrEqual(playerBox!.y + 1);
  expect(playerBox!.y).toBeLessThanOrEqual(60);
});
