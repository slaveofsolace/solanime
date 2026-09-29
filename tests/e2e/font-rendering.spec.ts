import { expect, test } from '@playwright/test';
import { fixtureArt } from './helpers';

test('local regular and bold font weights produce distinct rendered strokes', async ({ page }) => {
  await fixtureArt(page);
  await page.goto('/title/paper-lantern');
  await expect(page.locator('.title-hero h1')).toBeVisible();
  const weights = await page.evaluate(async () => {
    const measure = async (weight: number) => {
      const font = `${weight} 64px "Manrope Local"`;
      const loaded = await document.fonts.load(font, 'HHHHHHHH');
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 100;
      const context = canvas.getContext('2d')!;
      context.font = font;
      context.fillText('HHHHHHHH', 8, 78);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0;
      for (let index = 3; index < pixels.length; index += 4) ink += pixels[index];
      return { loaded: loaded.length, ink };
    };
    return { regular: await measure(400), bold: await measure(700) };
  });
  expect(weights.regular.loaded).toBeGreaterThan(0);
  expect(weights.bold.loaded).toBeGreaterThan(0);
  expect(weights.regular.ink).toBeGreaterThan(0);
  // Computed font-weight alone misses a renderer using the same thin instance
  // for every requested weight. Compare actual ink, allowing antialiasing drift.
  expect(weights.bold.ink / weights.regular.ink).toBeGreaterThan(1.15);
});
