import { expect, test } from '@playwright/test';
import { episode, fixtureArt, noOverflow } from './helpers';
import { sourceIds, chooseSource, selectedSource } from './helpers';

test.beforeEach(async ({ page }) => {
  await fixtureArt(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('mobile WebKit waiting for a Play gesture does not show a false load failure', async ({ page }) => {
  await page.clock.install();
  const first = await episode(page);
  await page.goto(`/watch/paper-lantern/${first.id}?language=sub`);
  await expect(page.getByRole('button', { name: 'Start playback' })).toBeVisible();
  await page.clock.fastForward('00:00:26');
  await expect(page.getByRole('button', { name: 'Start playback' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Video unavailable' })).toHaveCount(0);
});

test('mobile WebKit offers Play after metadata, then plays and switches protected sources', async ({ page, context }, info) => {
  const popups: string[] = [];
  page.on('popup', popup => popups.push(popup.url()));
  const first = await episode(page);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/watch/paper-lantern/${first.id}?language=sub`);
    const video = page.locator('video');
    await expect(video).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start playback' })).toBeVisible();
    await expect(page.locator('.media-loading')).toHaveCount(0);
    expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath(`watch-before-play-${width}.png`), fullPage: true });

    await page.getByRole('button', { name: 'Start playback' }).click();
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
      .toBeGreaterThan(0.2);
    const values = await sourceIds(page);
    expect(values.length).toBeGreaterThan(1);
    await chooseSource(page, values[1]!);
    await expect(selectedSource(page)).toHaveAttribute('data-mapping-id', values[1]!);
    await expect(page).toHaveURL(new RegExp(`/watch/paper-lantern/${first.id}\\?`));
    await expect(page.getByRole('button', { name: 'Start playback' })).toBeVisible();
    await page.getByRole('button', { name: 'Start playback' }).click();
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
      .toBeGreaterThan(0.2);
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath(`watch-playing-${width}.png`), fullPage: true });
  }
  await page.getByRole('group', { name: 'Episode navigation' }).getByRole('button', { name: 'Next episode' }).click();
  await expect(page).toHaveURL(/\/watch\/paper-lantern\/[^?]+\?/);
  expect(page.url()).not.toContain(`/watch/paper-lantern/${first.id}?`);
  await expect(page.getByRole('button', { name: 'Start playback' })).toBeVisible();
  await expect(context.pages()).toHaveLength(1);
  expect(popups).toEqual([]);
});
