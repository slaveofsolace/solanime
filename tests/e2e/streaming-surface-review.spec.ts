import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { accountFixture } from './account-fixture';
import { fixtureArt, noOverflow, watch } from './helpers';
import { generatedTestPassphrase } from '../helpers/auth-material';

/** Local, disposable catalogue/accounts only. iPhone CSS is not native containment evidence. */
async function capture(page: Page, info: TestInfo, name: string) {
  await expect(page.locator('.application-content')).not.toHaveAttribute('inert');
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true,
    maskColor: '#2d3038', mask: [page.locator('.recovery-value'), page.locator('input[type="password"]')] });
}

test('streaming product surface review across account and viewing journeys', async ({ page, context, isMobile }, info) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await fixtureArt(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if (isMobile) await page.addInitScript(() => {
    const mark = () => document.documentElement?.classList.add('solanime-native-ios');
    mark(); document.addEventListener('DOMContentLoaded', mark, { once: true });
  });
  await page.goto('/');
  await expect(page.locator('#featured-title')).toBeVisible();
  await capture(page, info, 'home');
  await page.evaluate(() => window.scrollTo(0, 450));
  await page.screenshot({ path: info.outputPath('home-scrolled.png') });
  await page.goto('/catalogue?scope=anime');
  await expect(page.locator('.title-grid .title-card').first()).toBeVisible();
  await capture(page, info, 'discover');
  await page.goto('/title/paper-lantern');
  await expect(page.locator('#title-name')).toHaveText('Paper Lantern');
  await capture(page, info, 'title-episodes');
  await watch(page);
  await capture(page, info, 'watch-controls');

  await accountFixture(page);
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
  await capture(page, info, 'library-empty');
  await page.goto('/title/paper-lantern');
  await page.getByRole('button', { name: 'My List', exact: true }).click();
  await expect(page.getByRole('button', { name: 'In My List', exact: true })).toBeVisible();
  await page.goto('/library');
  await expect(page.getByRole('link', { name: 'Open Paper Lantern', exact: true })).toBeVisible();
  await capture(page, info, 'library-saved');
  await page.getByRole('button', { name: 'More options for Paper Lantern', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Paper Lantern', exact: true })).toBeVisible();
  await capture(page, info, 'library-actions');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  for (const [route, heading, name] of [
    ['/settings?section=playback', 'Playback', 'settings-playback'],
    ['/settings?section=appearance', 'Appearance', 'settings-appearance'],
    ['/settings?section=connections', 'Connected apps', 'settings-connections'],
    ['/account', 'Account', 'account'],
    ['/profiles', 'Who’s watching?', 'profiles'],
  ]) {
    await page.goto(route);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await capture(page, info, name);
  }
  await context.clearCookies();
  for (const [route, name] of [['/login', 'sign-in'], ['/recover', 'recovery-form'], ['/register', 'register']]) {
    await page.goto(route);
    await expect(page.locator('.auth-panel form')).toBeVisible();
    await capture(page, info, name);
  }
  const email = `surface-${crypto.randomUUID()}@example.test`;
  const password = generatedTestPassphrase('surface review');
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Save your recovery code' })).toBeVisible();
  await capture(page, info, 'recovery-code');
  await page.getByLabel('I have saved my recovery code').check();
  await page.getByRole('button', { name: 'Choose a profile', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Who’s watching?' })).toBeVisible();
  await capture(page, info, 'new-profile');
  expect(errors).toEqual([]);
});
