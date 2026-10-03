import { expect, type Page } from '@playwright/test';
export const art =
  '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="510"><rect width="360" height="510" fill="#292740"/><circle cx="180" cy="180" r="85" fill="#d6b8d3"/><path d="M0 450 150 260 280 390 360 260V510H0Z" fill="#60587c"/></svg>';
export async function fixtureArt(page: Page) {
  await page.route('https://images.example.test/**', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: art }),
  );
}
export async function episode(page: Page, slug = 'paper-lantern') {
  return (await (await page.request.get(`/api/titles/${slug}`)).json()).episodes[0];
}
export async function watch(page: Page) {
  const e = await episode(page);
  await page.goto(`/watch/paper-lantern/${e.id}?language=sub`);
  await expect(page.locator('video')).toBeVisible();
  // WebKit may stop at HAVE_METADATA until the user presses Play. This helper
  // only waits for controls to be ready; playback tests verify advancing media
  // separately after the gesture.
  await expect
    .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThanOrEqual(1);
  await expect(page.getByRole('button', { name: 'Start playback' })).toBeVisible();
  return e;
}
export async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}

/** The website and signed-style phone shell use an Account tab instead of desktop chrome. */
export async function openSettings(page: Page, section?: 'playback' | 'appearance' | 'connections') {
  await expect(page.locator('.masthead')).toBeVisible();
  const direct = page.getByRole('banner').getByRole('link', { name: 'Settings', exact: true });
  if (await direct.isVisible()) await direct.click();
  else {
    await page.getByRole('navigation', { name: 'iPhone navigation' }).getByRole('link', { name: 'Account', exact: true }).click();
    await page.locator('.settings-back').getByText('Settings', { exact: true }).click();
  }
  await expect(page).toHaveURL(/\/settings(?:\?|$)/);
  if (section) {
    await page.locator(`a[href="/settings?section=${section}"]:visible`).click();
    await expect(page).toHaveURL(new RegExp(`/settings\\?section=${section}$`));
  }
}
export async function openProfiles(page: Page) {
  await expect(page.locator('.masthead')).toBeVisible();
  const profileMenu = page.getByRole('button', { name: 'Open profile menu', exact: true });
  const direct = page.getByRole('link', { name: 'Switch profile', exact: true });
  if (await profileMenu.isVisible()) {
    await profileMenu.click();
    await page.getByRole('dialog', { name: 'Profile', exact: true })
      .getByRole('link', { name: 'Switch profile', exact: true }).click();
  } else if (await direct.isVisible()) await direct.click();
  else {
    await page.getByRole('navigation', { name: 'iPhone navigation' }).getByRole('link', { name: 'Account', exact: true }).click();
    await page.getByRole('link', { name: 'Manage', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: 'Who’s watching?', exact: true })).toBeVisible();
}
export async function expandAccent(page: Page) {
  const disclosure = page.getByRole('button', { name: 'Accent color', exact: true });
  if (await disclosure.getAttribute('aria-expanded') === 'false') await disclosure.click();
}
