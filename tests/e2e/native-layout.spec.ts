import { test, expect } from '@playwright/test';
import { fixtureArt, watch, noOverflow } from './helpers';

test.beforeEach(async ({ page }) => fixtureArt(page));

test('paused Play stays at the picture centre across viewport and theater changes', async ({ page }, info) => {
  await watch(page);
  const video = page.locator('.player-screen video');
  const play = page.getByRole('button', { name: 'Start playback', exact: true });
  await expect(play).toBeVisible();
  const handle = await video.elementHandle();

  for (const viewport of [{ width: 1440, height: 1000 }, { width: 768, height: 1024 }, { width: 320, height: 720 }]) {
    await page.setViewportSize(viewport);
    for (const theater of [false, true]) {
      if (theater) await page.getByRole('button', { name: 'Theater mode', exact: true }).click();
      const picture = await video.boundingBox();
      const button = await play.boundingBox();
      expect(picture).not.toBeNull();
      expect(button).not.toBeNull();
      expect(Math.abs(button!.x + button!.width / 2 - picture!.x - picture!.width / 2)).toBeLessThanOrEqual(1);
      expect(Math.abs(button!.y + button!.height / 2 - picture!.y - picture!.height / 2)).toBeLessThanOrEqual(1);
      expect(picture!.height).toBeLessThanOrEqual(viewport.height * (theater ? .78 : .62) + 1);
      expect(button!.width).toBeGreaterThanOrEqual(44);
      expect(await handle!.evaluate(element => element.isConnected)).toBe(true);
      if (viewport.width <= 820) await expect(page.locator('.main-nav')).toBeHidden();
      else await expect(page.locator('.main-nav')).toBeVisible();
      await noOverflow(page);
      if (theater) await page.getByRole('button', { name: 'Exit theater mode', exact: true }).click();
    }
  }
  await play.focus();
  await expect(play).toBeFocused();
  await play.press('Enter');
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(.15);
  await expect(play).toHaveCount(0);
  const controls = page.getByRole('group', { name: 'Playback controls', exact: true });
  await controls.focus();
  await expect(controls).toBeFocused();
  await controls.press('k');
  await expect(play).toBeVisible();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('native-centred-320.png'), fullPage: true });
});
