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
