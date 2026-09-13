import { expect, test } from '@playwright/test';
import { fixtureArt, noOverflow } from './helpers';

test.beforeEach(async ({ page }) => { await fixtureArt(page); await page.emulateMedia({ reducedMotion: 'reduce' }); });

test('shared chrome has one gutter, one navigation state and consistent UI typography', async ({ page }) => {
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto('/catalogue');
    await expect(page.locator('.title-card').first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    const brand = await page.locator('.masthead .wordmark').boundingBox();
    const heading = await page.locator('.catalogue-heading h1').boundingBox();
    expect(Math.abs(brand!.x - heading!.x)).toBeLessThanOrEqual(1);

    const browse = page.getByRole('navigation', { name: 'Primary navigation' })
      .getByRole('link', { name: 'Browse', exact: true });
    await expect(browse).toHaveAttribute('aria-current', 'page');
    if (width <= 820) {
      await expect(browse).toHaveCSS('border-radius', '8px');
    } else {
      await expect(browse).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
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

test('desktop home artwork continues behind navigation without covering feature controls', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.locator('#featured-title')).toBeVisible();
  const scene = await page.locator('.spotlight-scene').boundingBox();
  const header = await page.locator('.masthead').boundingBox();
  const copy = await page.locator('.home-feature__copy').boundingBox();
  const rail = await page.locator('.home-rail').first().boundingBox();
  expect(scene!.y).toBeCloseTo(0, 0);
  expect(header!.y).toBeCloseTo(0, 0);
  expect(copy!.y).toBeGreaterThan(header!.y + header!.height + 40);
  expect(rail!.y).toBeGreaterThan(720);
  expect(rail!.y).toBeLessThan(810);
  await page.getByRole('link', { name: 'View episodes', exact: true }).click();
  await expect(page.locator('.title-hero')).toBeVisible();
  expect(await page.locator('.masthead').evaluate(element => getComputedStyle(element).marginBottom)).toBe('-72px');
  await noOverflow(page);
});
