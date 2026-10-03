import { expect, test } from '@playwright/test';
import { fixtureArt, noOverflow } from './helpers';

test.beforeEach(async ({ page }) => { await fixtureArt(page); await page.emulateMedia({ reducedMotion: 'reduce' }); });

test('shared chrome has one gutter, one navigation state and consistent UI typography', async ({ page }) => {
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto('/catalogue?scope=anime');
    await expect(page.locator('.title-card').first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    const brand = await page.locator('.masthead .wordmark').boundingBox();
    const heading = await page.locator('.catalogue-heading h1').boundingBox();
    expect(Math.abs(brand!.x - heading!.x)).toBeLessThanOrEqual(1);

    const browse = width <= 820
      ? page.getByRole('navigation', { name: 'iPhone navigation' }).getByRole('link', { name: 'Discover', exact: true })
      : page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Anime', exact: true });
    await expect(browse).toHaveAttribute('aria-current', 'page');
    if (width <= 820) {
      await expect(browse).toHaveCSS('border-radius', '0px');
      const navigationGeometry = await page.locator('.native-tab-bar > a').evaluateAll((links) =>
        links
          .filter((link) => (link as HTMLElement).offsetWidth > 0)
          .map((link) => {
            const box = link.getBoundingClientRect();
            const label = link.querySelector('span');
            return {
              left: box.left,
              right: box.right,
              height: box.height,
              labelClipped: label ? label.scrollWidth > label.clientWidth + 1 : false,
            };
          }),
      );
      expect(navigationGeometry).toHaveLength(5);
      expect(navigationGeometry.every(({ left, right }) => left >= 0 && right <= width)).toBe(true);
      expect(navigationGeometry.every(({ height }) => height >= 44)).toBe(true);
      expect(navigationGeometry.some(({ labelClipped }) => labelClipped)).toBe(false);
    } else {
      await expect(browse).toHaveCSS('background-color', 'rgb(20, 21, 25)');
      await expect(browse).toHaveCSS('border-radius', '0px');
    }
    await expect(browse).toHaveCSS('box-shadow', 'none');
    expect(await browse.evaluate(element => getComputedStyle(element, '::before').content))
      .toMatch(/^(none|normal)$/);

    const families = await page.locator('.catalogue-heading h1, .main-nav > a, .search-field input, .search-field button')
      .evaluateAll(elements => elements.map(element => getComputedStyle(element).fontFamily));
    expect(new Set(families).size).toBe(1);
    expect(families[0]).toContain('Manrope Local');
    await expect(page.locator('.utility-bar')).toHaveCount(0);
    await noOverflow(page);
  }
});

test('compact desktop navigation sits above artwork without covering feature controls', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.locator('#featured-title')).toBeVisible();
  const scene = await page.locator('.spotlight-scene').boundingBox();
  const header = await page.locator('.masthead').boundingBox();
  const copy = await page.locator('.home-feature__copy').boundingBox();
  const rail = await page.locator('.home-rail').first().boundingBox();
  expect(scene!.y).toBeCloseTo(header!.height, 0);
  expect(header!.y).toBeCloseTo(0, 0);
  expect(copy!.y).toBeGreaterThan(header!.y + header!.height + 40);
  // Keep discovery visibly attached to the artwork field; this is a catalogue
  // shell, not a landing-page hero followed by content below the fold.
  expect(rail!.y).toBeGreaterThan(550);
  expect(rail!.y).toBeLessThan(690);
  await page.locator('#featured-title a').click();
  await expect(page.locator('.title-hero')).toBeVisible();
  expect(await page.locator('.masthead').evaluate(element => getComputedStyle(element).marginBottom)).toBe('0px');
  await noOverflow(page);
});
