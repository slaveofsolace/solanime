import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { accountFixture } from './account-fixture';
import { fixtureArt } from './helpers';

const widthsFor = (info: TestInfo) => info.project.name.startsWith('mobile') ? [320, 390] : [1440];

async function noOverflow(page: Page) {
  // Mobile layout viewports can expand to overflowing content; compare against
  // the configured viewport so that expansion cannot manufacture a pass.
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
}

// Exercise text expansion independently of zoom so fixed control geometry cannot
// conceal clipping. This is browser coverage, not a native Dynamic Type claim.
async function enlargeText(page: Page) {
  await page.evaluate(() => {
    const measured = [...document.querySelectorAll<HTMLElement>('main *, dialog *')]
      .filter(element => [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())
        || element.matches('input, select, textarea'))
      .map(element => ({ element, size: parseFloat(getComputedStyle(element).fontSize), line: getComputedStyle(element).lineHeight }));
    for (const { element, size, line } of measured) {
      element.style.setProperty('font-size', `${size * 2}px`, 'important');
      if (line !== 'normal') element.style.setProperty('line-height', `${parseFloat(line) * 2}px`, 'important');
    }
  });
}

async function expectInset(surface: Locator, content: Locator) {
  const outer = await surface.boundingBox();
  const inner = await content.boundingBox();
  expect(outer).not.toBeNull();
  expect(inner).not.toBeNull();
  expect(inner!.x - outer!.x).toBeGreaterThanOrEqual(16);
  expect(outer!.x + outer!.width - inner!.x - inner!.width).toBeGreaterThanOrEqual(16);
  expect(inner!.y).toBeGreaterThanOrEqual(outer!.y);
  expect(inner!.y + inner!.height).toBeLessThanOrEqual(outer!.y + outer!.height + 1);
}

async function visibleBetweenBars(page: Page, element: Locator) {
  await element.evaluate(node => node.scrollIntoView({ block: 'center' }));
  const bounds = await element.evaluate(node => {
    const box = node.getBoundingClientRect();
    const header = document.querySelector('.masthead')?.getBoundingClientRect();
    const tabs = document.querySelector('.native-tab-bar')?.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom, header: Math.max(0, header?.bottom ?? 0),
      bottomLimit: tabs && tabs.height > 0 ? tabs.top : innerHeight };
  });
  expect(bounds.top).toBeGreaterThanOrEqual(bounds.header);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.bottomLimit);
}

async function capture(page: Page, info: TestInfo, name: string) {
  await info.attach(`${name}-identity`, { contentType: 'application/json', body: JSON.stringify(await page.evaluate(() => ({
    route: location.pathname, viewport: { width: innerWidth, height: innerHeight },
    assets: [...document.scripts].map(script => script.src).filter(Boolean),
    stylesheets: [...document.querySelectorAll<HTMLLinkElement>('link[rel=stylesheet]')].map(link => link.href),
  }))) });
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: false, scale: 'css',
    // Forms remain empty: do not hide their real field geometry with masks.
    maskColor: '#34363a', mask: [page.locator('.account-heading p')] });
}

test.beforeEach(async ({ page }) => {
  await fixtureArt(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    const mark = () => document.documentElement?.classList.toggle('solanime-native-ios', innerWidth <= 820);
    mark(); document.addEventListener('DOMContentLoaded', mark, { once: true });
  });
  await accountFixture(page);
});

test('security forms stay inside their selected disclosure with usable insets and exclusive expansion', async ({ page }, info) => {
  for (const width of widthsFor(info)) {
    await page.setViewportSize({ width, height: width > 820 ? 1000 : 844 });
    await page.goto('/account');
    const group = page.getByRole('group', { name: 'Security action' });
    for (const [action, submit] of [
      ['Change password', 'Update password'], ['Recovery code', 'Generate recovery code'], ['Delete account', 'Delete my account'],
    ]) {
      const trigger = group.getByRole('button', { name: action, exact: true });
      await trigger.click();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      const region = group.getByRole('region', { name: action, exact: true });
      await expect(group.getByRole('region')).toHaveCount(1);
      await expect(region.locator('#account-security-form')).toBeVisible();
      await expectInset(trigger.locator('..'), region.locator('#account-security-form'));
      await expectInset(trigger.locator('..'), region.getByLabel('Current password', { exact: true }));
      await visibleBetweenBars(page, region.getByRole('button', { name: submit, exact: true }));
      await noOverflow(page);
      await capture(page, info, `${width}-${action.toLowerCase().replaceAll(' ', '-')}-dark`);
    }
    await group.getByRole('button', { name: 'Change password', exact: true }).click();
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await enlargeText(page);
    const expanded = group.getByRole('region', { name: 'Change password', exact: true });
    await expectInset(expanded.locator('..'), expanded.locator('form'));
    await visibleBetweenBars(page, expanded.getByRole('button', { name: 'Update password', exact: true }));
    await noOverflow(page);
    await capture(page, info, `${width}-password-light-text200`);
    await group.getByRole('button', { name: 'Change password', exact: true }).click();
    await expect(group.getByRole('region')).toHaveCount(0);
  }
});

test('accent disclosure contains its narrow editor and preserves usable hex and action controls', async ({ page }, info) => {
  for (const width of widthsFor(info)) {
    await page.setViewportSize({ width, height: width > 820 ? 1000 : 844 });
    await page.goto('/settings?section=appearance');
    const trigger = page.getByRole('button', { name: 'Accent color', exact: true });
    await trigger.click();
    const region = page.getByRole('region', { name: 'Accent color', exact: true });
    await expectInset(trigger.locator('..'), region.locator('.accent-options'));
    for (const theme of ['dark', 'light']) {
      await page.getByRole('button', { name: theme === 'dark' ? 'Dark' : 'Light', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await visibleBetweenBars(page, region.getByRole('button', { name: 'Apply', exact: true }));
      await noOverflow(page);
      await capture(page, info, `${width}-accent-${theme}`);
    }
    await enlargeText(page);
    const hex = region.getByRole('textbox', { name: 'Custom hex', exact: true });
    const dimensions = await hex.evaluate(element => {
      const style = getComputedStyle(element);
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d')!;
      context.font = `${style.fontSize} ${style.fontFamily}`;
      return { width: element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        needed: context.measureText('#ffffff').width };
    });
    expect(dimensions.width).toBeGreaterThanOrEqual(dimensions.needed - 1);
    await expectInset(trigger.locator('..'), region.locator('.accent-options'));
    await visibleBetweenBars(page, region.getByRole('button', { name: 'Apply', exact: true }));
    await noOverflow(page);
    await capture(page, info, `${width}-accent-light-text200`);
    await trigger.click();
    await expect(region).toHaveCount(0);
    if (width <= 820) {
      await page.locator('.settings-back').click();
      await expect(page).toHaveURL(/\/settings$/);
      await expect(page.getByRole('navigation', { name: 'Settings sections' }).filter({ visible: true }).getByRole('link', { name: 'Appearance', exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Appearance', exact: true })).toHaveAttribute('aria-current', 'page');
    }
  }
});

test('title and account details keep their content within the shared inset and bottom actions remain reachable', async ({ page }, info) => {
  for (const width of widthsFor(info)) {
    await page.setViewportSize({ width, height: width > 820 ? 1000 : 844 });
    await page.goto('/title/paper-lantern');
    const about = page.locator('.title-about');
    await about.locator('summary').click();
    await expect(about).toHaveAttribute('open', '');
    await expectInset(about, about.locator('.disclosure-content > p').first());
    for (const theme of ['dark', 'light']) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      await about.scrollIntoViewIfNeeded();
      await capture(page, info, `${width}-title-about-${theme}`);
    }
    await enlargeText(page);
    await expectInset(about, about.locator('.disclosure-content > p').first());
    await noOverflow(page);
    await capture(page, info, `${width}-title-about-light-text200`);
    await page.goto('/account');
    await page.locator('summary').filter({ hasText: 'Your data' }).click();
    const data = page.locator('details').filter({ has: page.getByRole('button', { name: 'Export my data', exact: true }) });
    await expectInset(data, data.locator('.disclosure-content > p'));
    await enlargeText(page);
    const exportButton = page.getByRole('button', { name: 'Export my data', exact: true });
    await visibleBetweenBars(page, exportButton);
    await expectInset(data, exportButton);
    await noOverflow(page);
    await capture(page, info, `${width}-account-data-text200`);
  }
});
