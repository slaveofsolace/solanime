import { expect, test } from '@playwright/test';
import { fixtureArt, noOverflow } from './helpers';
import { accountFixture } from './account-fixture';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await fixtureArt(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('compact navigation and protected destinations work without a Movies sector', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#featured-title')).toBeVisible();
  const nav = page.locator('.main-nav');
  await expect(nav.getByRole('link', { name: 'Movies', exact: true })).toHaveCount(0);
  for (const [name, scope] of [['Anime', 'anime'], ['TV Shows', 'tv']]) {
    await nav.getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`scope=${scope}`));
    await expect(nav.getByRole('link', { name, exact: true })).toHaveAttribute('aria-current', 'page');
  }
  await page.goto('/library');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Flibrary/);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fsettings/);
  await noOverflow(page);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath('protected-signin.png'), fullPage: true });
});

test('operator approval screen remains reachable before the first account is approved', async ({ page }) => {
  await page.route('**/api/account/session', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ account: null, profiles: [], csrfToken: null,
      registrationOpen: true, recoveryMethod: 'recovery-code', maxProfiles: 5, privateSite: true }),
  }));
  await page.goto('/');
  await expect(page).toHaveURL(/\/login\?returnTo=%2F/);
  await page.goto('/admin');
  await expect(page.getByLabel('Operator token')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Import diagnostics.' })).toBeVisible();
});

test('catalogue play opens episode one directly while details remain separately available', async ({ page }) => {
  await page.goto('/catalogue?scope=anime&q=Long%20Journey');
  const card = page.locator('.title-card').filter({ hasText: 'Long Journey' }).first();
  await expect(card.getByRole('link', { name: 'Open Long Journey' })).toBeVisible();
  await card.getByRole('button', { name: 'Start or continue Long Journey' }).click();
  await expect(page).toHaveURL(/\/watch\/long-journey\/[^/?]+\?language=sub/);
  await expect(page.getByRole('combobox', { name: 'Choose episode' })).toHaveValue(/.+/);
});

test('series cards, season changes and back navigation work at 320 and desktop widths', async ({ page }, info) => {
  await page.route('**/api/titles/paper-lantern', async route => {
    const response = await route.fetch(); const data = await response.json();
    data.episodes = data.episodes.map((episode: object, index: number) => ({ ...episode, seasonNumber: index < 2 ? 1 : 2 }));
    await route.fulfill({ response, json: data });
  });
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto('/title/paper-lantern');
    await expect(page.locator('#title-name')).toBeVisible();
    const season = page.getByRole('combobox', { name: 'Season', exact: true });
    await expect(page.locator('.episode-grid > li')).toHaveCount(2);
    await season.selectOption('season-2');
    await expect(page.locator('.episode-grid > li')).toHaveCount(1);
    await expect(page).toHaveURL(/season=season-2/);
    await season.selectOption('all');
    await expect(page.locator('.episode-grid > li')).toHaveCount(3);
    const thumbnail = page.locator('.episode-thumbnail').first();
    const bounds = await thumbnail.boundingBox();
    expect(bounds!.width / bounds!.height).toBeCloseTo(16 / 9, 1);
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath(`series-${width}.png`), fullPage: true });
    await page.locator('.episode-grid li > a').first().click();
    await expect(page).toHaveURL(/\/watch\/paper-lantern\//);
    await page.goBack();
    await expect(season).toHaveValue('all');
  }
});

test('long episode inventories without stills use dense rows rather than empty poster cards', async ({ page }) => {
  await page.goto('/title/long-journey');
  await expect(page.locator('#title-name')).toBeVisible();
  const browser = page.locator('.episode-browser--compact');
  await expect(browser).toBeVisible();
  await expect(browser.locator('.episode-grid > li')).toHaveCount(50);
  const first = await browser.locator('.episode-grid > li').first().boundingBox();
  expect(first!.height).toBeLessThanOrEqual(90);
  await page.setViewportSize({ width: 320, height: 820 });
  await noOverflow(page);
  await browser.getByRole('link', { name: /Episode 1 Subtitled/ }).first().click();
  await expect(page).toHaveURL(/\/watch\/long-journey\/[^/?]+\?language=sub/);
});

test('settings and series remain usable in both themes, narrow layout and enlarged text', async ({ page }, info) => {
  test.setTimeout(60000);
  await accountFixture(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const theme of ['Light', 'Dark']) {
    await page.goto('/settings');
    await page.getByRole('button', { name: theme, exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.toLowerCase());
    await expect(page.getByText('The operator needs to register Solanime with MyAnimeList', { exact: false })).toBeVisible();
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 960 });
      await noOverflow(page);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(results.violations.filter(v => ['serious', 'critical'].includes(v.impact ?? '')).map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
      await page.screenshot({ path: info.outputPath(`settings-${theme}-${width}.png`), fullPage: true });
    }
    await page.goto('/title/paper-lantern');
    await expect(page.locator('#title-name')).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath(`series-${theme}-320.png`), fullPage: true });
    const category = page.getByRole('button', { name: 'Categories', exact: true });
    await category.focus(); await page.keyboard.press('Enter');
    await expect(category).toHaveAttribute('aria-expanded', 'true');
    await noOverflow(page);
    const menuTarget = await page.locator('.category-navigation__panel a').first().boundingBox();
    expect(menuTarget?.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press('Escape');
    await expect(category).toHaveAttribute('aria-expanded', 'false');
    await expect(category).toBeFocused();
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  // CSS zoom exercises 200% reflow without depending on the test browser's UI.
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  await noOverflow(page);
  await expect(page.getByRole('checkbox', { name: /Remember progress/ })).toBeVisible();
  await page.screenshot({ path: info.outputPath('settings-200-percent.png'), fullPage: true });
  expect(errors).toEqual([]);
});
