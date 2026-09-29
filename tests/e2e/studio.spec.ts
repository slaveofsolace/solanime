import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fixtureArt, watch, noOverflow } from './helpers';
import { accountFixture } from './account-fixture';
test.beforeEach(async ({ page }) => fixtureArt(page));
test('manual feature selection updates actual title actions', async ({ page, isMobile }) => {
  await page.goto('/');
  await expect(page.locator('#featured-title')).toBeVisible();
  const before = await page.locator('#featured-title').innerText();
  if (isMobile) await page.locator('.feature-dots button').nth(1).click();
  else await page.getByRole('button', { name: 'Next featured title' }).click();
  await expect(page.locator('#featured-title')).not.toHaveText(before);
  if (isMobile) await page.locator('.feature-dots button').first().click();
  else await page.getByRole('button', { name: 'Previous featured title' }).click();
  await expect(page.locator('#featured-title')).toHaveText(before);
  await noOverflow(page);
});
test('profile motion preferences persist from Settings into the player', async ({ page }) => {
  await accountFixture(page);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Reduce motion', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await watch(page);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
});
test('operating-system reduced motion overrides animation preference', async ({ page, isMobile }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('#featured-title')).toBeVisible();
  if (isMobile) await page.locator('.feature-dots button').nth(1).click();
  else await page.getByRole('button', { name: 'Next featured title' }).click();
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
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('#featured-title')).toBeVisible({ timeout: 1_500 });
  await expect(page.getByText('Catalogue unavailable.')).toHaveCount(0);
});
test('tablet navigation stays visible and light history follows the hero before recent updates', async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await accountFixture(page, { preferences: { theme: 'light', rememberProgress: true, preferredLanguage: 'sub', autoplayNext: false } });
  await watch(page);
  await page.getByRole('button', { name: 'Mute video', exact: true }).click();
  await page.getByRole('button', { name: 'Play video', exact: true }).click();
  await expect
    .poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime))
    .toBeGreaterThan(0.2);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Continue watching' })).toBeVisible();

  const primaryLinks = page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link');
  await expect(primaryLinks).toHaveCount(3);
  for (const link of await primaryLinks.all()) {
    await expect(link).toBeVisible();
    expect(await link.textContent()).toBeTruthy();
  }
  const history = page.getByRole('region', { name: 'Continue watching', exact: true });
  await expect(page.locator('.home-feature + .continue-section--home + .home-rail[aria-labelledby="rail-recent-updates"]')).toHaveCount(1);
  const layout = await page.evaluate(() => {
    const hero = document.querySelector('.home-feature')!.getBoundingClientRect();
    const history = document.querySelector('.continue-section--home')!.getBoundingClientRect();
    const recent = document.querySelector('[aria-labelledby="rail-recent-updates"]')!.getBoundingClientRect();
    return { heroBottom: hero.bottom, historyTop: history.top, historyBottom: history.bottom, recentTop: recent.top };
  });
  expect(layout.historyTop).toBeGreaterThanOrEqual(layout.heroBottom);
  expect(layout.historyTop - layout.heroBottom).toBeLessThanOrEqual(48);
  expect(layout.recentTop).toBeGreaterThanOrEqual(layout.historyBottom);
  expect(layout.recentTop - layout.historyBottom).toBeLessThan(40);
  await expect(history.getByRole('link', { name: 'Full history' })).toHaveAttribute('href', '/library#history-title');
  await expect(history.locator('.continue-card > a')).toHaveAttribute('href', /^\/watch\/paper-lantern\/[^?]+\?language=sub$/);
  await expect(history.getByRole('progressbar', { name: 'Paper Lantern viewing progress' })).toBeVisible();
  expect(Number(await history.getByRole('progressbar').getAttribute('aria-valuenow'))).toBeGreaterThan(0);
  await expect(history.getByRole('button', { name: 'Remove Paper Lantern from Continue watching' })).toBeVisible();
  await noOverflow(page);
  await history.getByRole('link', { name: 'Full history' }).click();
  await expect(page.getByRole('heading', { name: 'Watch history', exact: true })).toBeFocused();
});
test('major screens have meaningful content, no overflow and accessible controls in both themes', async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await accountFixture(page);
  for (const theme of ['dark', 'light']) {
    await page.goto('/settings');
    await page
      .locator('#appearance')
      .getByRole('button', { name: theme === 'light' ? 'Light' : 'Dark', exact: true })
      .click();
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
      else if (label === 'error') {
        await page.getByRole('button', { name: 'View page status' }).click();
        await expect(page.getByRole('heading', { name: 'Title unavailable' })).toBeVisible();
      }
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
