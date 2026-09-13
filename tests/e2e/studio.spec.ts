import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fixtureArt, watch, noOverflow } from './helpers';
test.beforeEach(async ({ page }) => fixtureArt(page));
test('manual feature selection updates actual title actions', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#featured-title')).toBeVisible();
  const before = await page.locator('#featured-title').innerText();
  await page.getByRole('button', { name: 'Next featured title' }).click();
  await expect(page.locator('#featured-title')).not.toHaveText(before);
  await page.getByRole('button', { name: 'Previous featured title' }).click();
  await expect(page.locator('#featured-title')).toHaveText(before);
  await noOverflow(page);
});
test('motion preferences persist and do not remount native media', async ({ page }) => {
  await watch(page);
  const video = await page.locator('video').elementHandle();
  await page.getByRole('button', { name: 'Customize appearance' }).click();
  await page.getByRole('button', { name: 'Reduce motion', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await page.keyboard.press('Escape');
  expect(await video!.evaluate((v) => v.isConnected)).toBe(true);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
});
test('operating-system reduced motion overrides animation preference', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('#featured-title')).toBeVisible();
  await page.getByRole('button', { name: 'Next featured title' }).click();
  expect(
    await page.locator('.spotlight-art').evaluate((el) => getComputedStyle(el).animationDuration),
  ).toMatch(/0s|0.01ms|1e-05s/);
});
test('primary catalogue renders without waiting for optional home data', async ({ page }) => {
  await page.route('**/api/meta/filters', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"optional"}' });
  });
  await page.route('**/api/titles?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('type') === 'movie') {
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"optional"}' });
      return;
    }
    await route.continue();
  });
  await page.goto('/');
  await expect(page.locator('#featured-title')).toBeVisible({ timeout: 1_500 });
  await expect(page.getByText('Catalogue unavailable.')).toHaveCount(0);
});
test('tablet navigation stays visible and light history follows the hero before recent updates', async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await watch(page);
  await page.getByRole('button', { name: 'Mute video', exact: true }).click();
  await page.getByRole('button', { name: 'Play video', exact: true }).click();
  await expect
    .poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime))
    .toBeGreaterThan(0.2);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Continue watching' })).toBeVisible();
  await page.getByRole('button', { name: 'Customize appearance' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Light', exact: true }).click();
  await page.keyboard.press('Escape');

  const primaryLinks = page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link');
  await expect(primaryLinks).toHaveCount(6);
  for (const link of await primaryLinks.all()) {
    expect((await link.locator('.icon').isVisible()) || (await link.locator('span').first().isVisible())).toBe(
      true,
    );
  }
  const history = page.getByRole('region', { name: 'Continue watching', exact: true });
  await expect(page.locator('.home-feature + .continue-section--home + .home-rail[aria-labelledby="rail-recent-updates"]')).toHaveCount(1);
  const layout = await page.evaluate(() => {
    const hero = document.querySelector('.home-feature')!.getBoundingClientRect();
    const history = document.querySelector('.continue-section--home')!.getBoundingClientRect();
    const recent = document.querySelector('[aria-labelledby="rail-recent-updates"]')!.getBoundingClientRect();
    return { heroBottom: hero.bottom, historyTop: history.top, historyBottom: history.bottom, recentTop: recent.top };
  });
  // The reference's first rail overlaps only the empty bottom artwork fade.
  expect(layout.heroBottom - layout.historyTop).toBeGreaterThanOrEqual(30);
  expect(layout.heroBottom - layout.historyTop).toBeLessThanOrEqual(65);
  expect(layout.recentTop).toBeGreaterThanOrEqual(layout.historyBottom);
  expect(layout.recentTop - layout.historyBottom).toBeLessThan(40);
  await expect(history.getByRole('link', { name: 'Full history' })).toHaveAttribute('href', '/library');
  await expect(history.locator('.continue-card > a')).toHaveAttribute('href', /^\/watch\/paper-lantern\/[^?]+\?language=sub$/);
  await expect(history.getByRole('progressbar', { name: 'Paper Lantern viewing progress' })).toBeVisible();
  expect(Number(await history.getByRole('progressbar').getAttribute('aria-valuenow'))).toBeGreaterThan(0);
  await expect(history.getByRole('button', { name: /Remove Paper Lantern .* from history/ })).toBeVisible();
  await noOverflow(page);
});
test('major screens have meaningful content, no overflow and accessible controls in both themes', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  for (const theme of ['dark', 'light']) {
    await page.goto('/');
    await expect(page.locator('#featured-title')).toBeVisible();
    await page.getByRole('button', { name: 'Customize appearance' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: theme === 'light' ? 'Light' : 'Dark', exact: true })
      .click();
    await page.keyboard.press('Escape');
    for (const [label, path] of [
      ['home', '/'],
      ['browse', '/catalogue'],
      ['search', '/search?q=Paper'],
      ['title', '/title/paper-lantern'],
      ['collection', '/library'],
      ['empty', '/search?q=no-such-show-xyz'],
      ['error', '/title/unknown'],
    ]) {
      await page.goto(path);
      if (label === 'home') await expect(page.locator('#featured-title')).toBeVisible();
      else if (['browse', 'search'].includes(label))
        await expect(page.locator('.title-card').first()).toBeVisible();
      else if (label === 'empty')
        await expect(page.getByRole('heading', { name: 'No titles found' })).toBeVisible();
      else await expect(page.locator('main h1').first()).toBeVisible();
      await noOverflow(page);
      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(
        result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
      ).toEqual([]);
      await page.screenshot({ path: info.outputPath(`${label}-${theme}.png`), fullPage: true });
    }
  }
});
