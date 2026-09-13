import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('normal-speed intro settles, remains geometrically stable, then exits once', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/branding.html?state=intro');
  const mark = page.locator('.sol-brand-demo__stage > .sol-brand');
  await expect(mark).toHaveAttribute('data-animation', 'intro');
  const bounds = await mark.boundingBox();
  const partial = await mark.locator('[data-front-reveal]').getAttribute('stroke-dashoffset');
  expect(Number(partial)).toBeGreaterThan(0);
  await expect(mark).toHaveAttribute('data-animation', 'loading');
  await expect(mark.locator('[data-front-reveal]')).toHaveAttribute('stroke-dashoffset', /^0(?:\.0+)?$/);
  await expect(mark.locator('[data-sun-rise]')).toHaveAttribute('transform', 'translate(0 0.000)');
  expect(await mark.boundingBox()).toEqual(bounds);
  await page.getByRole('button', { name: 'Exit now', exact: true }).click();
  await expect(page.locator('[data-demo-status]')).toHaveText('Exit complete · exit callbacks: 1');
  await expect(mark.locator('svg')).toHaveCSS('opacity', '0');
  expect(errors).toEqual([]);
});

test('actual ready removes the splash early; failure has retry and escape', async ({ page }) => {
  await page.goto('/branding.html?state=static');
  await page.getByRole('button', { name: 'Test application readiness' }).click();
  const overlay = page.getByRole('region', { name: 'Solanime readiness' });
  await expect(overlay).toBeVisible();
  const start = Date.now();
  await page.getByRole('button', { name: 'Application ready', exact: true }).click();
  await expect(overlay).toHaveCount(0, { timeout: 1200 });
  expect(Date.now() - start).toBeLessThan(1200);
  await page.getByRole('button', { name: 'Replay at normal speed' }).click();
  await page.getByRole('button', { name: 'Test application readiness' }).click();
  await page.getByRole('button', { name: 'Simulate loading failure' }).click();
  await expect(overlay.getByRole('alert')).toContainText('The catalogue could not be loaded.');
  await expect(overlay.locator('.sol-brand')).toHaveAttribute('data-animation', 'static');
  await overlay.getByRole('button', { name: 'Try again' }).click();
  await expect(overlay).toHaveAttribute('aria-busy', 'true');
  await page.getByRole('button', { name: 'Simulate loading failure' }).click();
  await overlay.getByRole('button', { name: 'Continue without waiting' }).click();
  await expect(overlay).toHaveCount(0);
  await page.getByRole('button', { name: 'Test application readiness' }).click();
  await expect(overlay).toHaveCount(0);
});

test('both themes fit the viewport, with compact navigation and keyboard-visible focus', async ({ page }, testInfo) => {
  for (const theme of ['dark', 'light']) {
    await page.goto(`/branding.html?state=static&theme=${theme}`);
    const bounds = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    expect(bounds.content).toBeLessThanOrEqual(bounds.viewport);
    const compact = page.locator('.sol-brand-demo__variants .sol-brand--compact');
    await expect(compact.locator('img')).toHaveAttribute('src', `/branding/solanime-compact-${theme}.webp`);
    expect((await compact.boundingBox())?.width).toBe(180);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Brand studio home' })).toBeFocused();
    const focus = await page.getByRole('link', { name: 'Brand studio home' }).evaluate(element => getComputedStyle(element).outlineStyle);
    expect(focus).not.toBe('none');
    const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(accessibility.violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`branding-${theme}.png`), fullPage: true });
  }
});

test('saved and OS reduced motion both suppress ribbon and sunrise motion', async ({ page }) => {
  await page.goto('/branding.html?state=intro&reduced=1');
  const mark = page.locator('.sol-brand-demo__stage > .sol-brand');
  await expect(mark).toHaveAttribute('data-animation', 'static');
  await expect(mark.locator('[data-sun-rise]')).toHaveAttribute('transform', 'translate(0 0.000)');
  await page.getByRole('checkbox', { name: 'Saved reduced motion' }).uncheck();
  await expect(mark).toHaveAttribute('data-animation', 'intro');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(mark).toHaveAttribute('data-animation', 'static');
  await expect(mark.locator('[data-front-reveal]')).toHaveAttribute('stroke-dashoffset', /^0(?:\.0+)?$/);
  await page.getByRole('button', { name: 'Exit now' }).click();
  await expect(page.locator('[data-demo-status]')).toHaveText('Exit complete · exit callbacks: 1');
});

test('loading loop endpoints use the same geometry and invisible wrapping highlight', async ({ page }) => {
  const snapshot = async (time: number) => {
    await page.goto(`/branding.html?export=1&state=loading&time=${time}`);
    await expect(page.locator('[data-sampled-ms]')).toHaveAttribute('data-sampled-ms', String(time));
    return page.locator('[data-brand-art]').evaluate(element => ({
      front: element.querySelector('[data-front-reveal]')?.getAttribute('stroke-dashoffset'),
      play: element.querySelector('[data-play]')?.getAttribute('opacity'),
      sun: element.querySelector('[data-sun-rise]')?.getAttribute('transform'),
      letters: [...element.querySelectorAll('[data-letter]')].map(letter => [letter.getAttribute('transform'), letter.getAttribute('opacity')]),
      highlight: element.querySelector('[data-travel-light]')?.getAttribute('opacity'),
      flare: element.querySelector('[data-flare]')?.getAttribute('opacity'),
    }));
  };
  const first = await snapshot(0);
  expect(first).toEqual(await snapshot(4800));
  expect(Number(first.highlight)).toBe(0);
});

test('missing layer has a readable fallback without trapping readiness', async ({ page }) => {
  await page.route('**/branding/solanime-sun.webp', route => route.abort('failed'));
  await page.goto('/branding.html?state=intro');
  const mark = page.locator('.sol-brand-demo__stage > .sol-brand');
  await expect(mark).toHaveAttribute('data-asset', 'error');
  await expect(mark.locator('.sol-brand-fallback')).toHaveText('Solanime');
  await page.getByRole('button', { name: 'Test application readiness' }).click();
  await page.getByRole('button', { name: 'Application ready', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Solanime readiness' })).toHaveCount(0);
});
