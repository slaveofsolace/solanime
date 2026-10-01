import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { accountFixture } from './account-fixture';
import { fixtureArt, noOverflow, watch } from './helpers';

test('signed iPhone presentation keeps readable controls and consistent surfaces', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const mark = () => document.documentElement?.classList.add('solanime-native-ios');
    mark();
    document.addEventListener('DOMContentLoaded', mark, { once: true });
  });
  await fixtureArt(page);

  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/solanime-native-ios/);
  await expect(page.getByRole('heading', { name: 'Recent updates' })).toBeVisible();
  await expect(page.locator('.wordmark .sol-brand--emblem')).toBeVisible();
  await expect(page.locator('.home-feature .spotlight-art')).toBeVisible();
  await expect(page.locator('.home-feature__mobile-art')).toBeHidden();
  await noOverflow(page);
  const home = await page.evaluate(() => {
    const css = (selector: string) => getComputedStyle(document.querySelector(selector)!);
    return {
      font: css('body').fontFamily,
      posterRadius: parseFloat(css('.home-feature__mobile-art').borderTopLeftRadius),
      actionRadius: parseFloat(css('.home-feature .button--primary').borderTopLeftRadius),
      heroHeight: document.querySelector('.home-feature')!.getBoundingClientRect().height,
      tabHeight: document.querySelector('.native-tab-bar')!.getBoundingClientRect().height,
      tabs: [...document.querySelectorAll('.native-tab-bar > a')].map((tab) => tab.textContent?.trim()),
      websiteNavHidden: getComputedStyle(document.querySelector('.main-nav')!).display === 'none',
      actionToDots: Math.round(document.querySelector('.feature-dots span')!.getBoundingClientRect().top - document.querySelector('.home-feature .button-row')!.getBoundingClientRect().bottom),
      dotsToUpdates: Math.round(document.querySelector('.home-feature + .home-rail .rail-heading')!.getBoundingClientRect().top - document.querySelector('.feature-dots span')!.getBoundingClientRect().bottom),
    };
  });
  expect(home.font).toMatch(/-apple-system/);
  expect(home.posterRadius).toBeGreaterThanOrEqual(8);
  expect(home.actionRadius).toBeGreaterThanOrEqual(10);
  expect(home.heroHeight).toBeGreaterThanOrEqual(550);
  expect(home.heroHeight).toBeLessThanOrEqual(670);
  expect(home.tabHeight).toBeGreaterThanOrEqual(56);
  expect(home.tabs).toEqual(['Home', 'Discover', 'Library', 'Account']);
  expect(home.websiteNavHidden).toBe(true);
  expect(home.actionToDots).toBeGreaterThanOrEqual(0);
  expect(home.actionToDots).toBeLessThanOrEqual(28);
  expect(home.dotsToUpdates).toBeGreaterThanOrEqual(0);
  expect(home.dotsToUpdates).toBeLessThanOrEqual(32);
  await expect(page.locator('.feature-arrows').getByRole('button', { name: /pause/i })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('native-home.png') });
  const initialFeature = await page.locator('#featured-title').textContent();
  await page.evaluate(() => {
    document.addEventListener('animationstart', (event) => {
      if (event.animationName.startsWith('spotlight-')) {
        document.documentElement.dataset.spotlightAnimations = [
          document.documentElement.dataset.spotlightAnimations,
          event.animationName,
        ].filter(Boolean).join(',');
      }
    }, true);
  });
  await page.locator('.feature-dots button').nth(1).click();
  await expect(page.locator('html')).toHaveAttribute('data-spotlight-animations', /spotlight-in-forward/);
  await expect(page.locator('html')).toHaveAttribute('data-spotlight-animations', /spotlight-out-forward/);
  await expect(page.locator('#featured-title')).not.toHaveText(initialFeature ?? '');

  await page.goto('/title/paper-lantern');
  await expect(page.getByRole('heading', { name: 'Paper Lantern' })).toBeVisible();
  await noOverflow(page);
  await expect(page.locator('.title-hero__actions').getByRole('button', { name: 'My List' })).toBeVisible();
  const saveWidth = await page.locator('.title-hero__actions .button--outline').evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  expect(saveWidth).toBe(48);
  for (const theme of ['dark', 'light']) {
    await page.locator('html').evaluate((element, value) => element.setAttribute('data-theme', value), theme);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const primary = await page.locator('.title-page .button--primary').evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, color: style.color, text: element.textContent };
    });
    expect(results.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target),
    })), `${theme} appearance primary ${JSON.stringify(primary)}`).toEqual([]);
  }
  await page.locator('html').evaluate((element) => element.setAttribute('data-theme', 'dark'));
  await page.screenshot({ path: info.outputPath('native-title.png') });

  await watch(page);
  await noOverflow(page);
  const sourceHeight = await page.locator('.source-choice select').evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  expect(sourceHeight).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: info.outputPath('native-watch.png') });

  await accountFixture(page);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.locator('.settings-navigation')).toBeHidden();
  await expect(page.getByRole('link', { name: /Switch profile\. Current profile:/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Manage account' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accent color' })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('checkbox', { name: 'Reduce motion' })).toBeVisible();
  const motionSwitchHeight = await page.getByRole('checkbox', { name: 'Reduce motion' }).evaluate(
    (element) => Math.round(element.getBoundingClientRect().height),
  );
  expect(motionSwitchHeight).toBe(31);
  const playbackRows = await page.locator('.settings-page .preference-list label').evaluateAll((rows) =>
    rows.map((row) => Math.round(row.getBoundingClientRect().height)),
  );
  expect(playbackRows).toHaveLength(3);
  expect(Math.max(...playbackRows)).toBeLessThanOrEqual(80);
  await noOverflow(page);
  for (const theme of ['dark', 'light']) {
    await page.locator('html').evaluate((element, value) => element.setAttribute('data-theme', value), theme);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target),
    })), `${theme} Settings accessibility`).toEqual([]);
  }
  await page.locator('html').evaluate((element) => element.setAttribute('data-theme', 'dark'));
  await page.screenshot({ path: info.outputPath('native-settings.png') });
  await page.setViewportSize({ width: 320, height: 700 });
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('native-settings-320.png') });
});
