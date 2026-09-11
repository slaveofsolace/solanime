import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const password = 'Our long sample passphrase 2026';
const image =
  '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="510"><rect width="360" height="510" fill="#253744"/><circle cx="180" cy="180" r="85" fill="#efb083"/></svg>';
test.beforeEach(async ({ page }) => {
  await page.route('https://images.example.test/**', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: image }),
  );
});
async function register(page: Page) {
  const email = `test-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
  await page.goto('/register');
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Keep a way back in' })).toBeVisible();
  const code = await page.locator('.recovery-value').innerText();
  await page.getByLabel('I have saved my recovery code').check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Who’s watching?' })).toBeVisible();
  return { email, code };
}
async function choose(page: Page, name = 'You') {
  await page
    .locator('.profile-tile')
    .filter({ has: page.getByText(name, { exact: true }) })
    .click();
  await expect(page).toHaveURL(/\/$/);
}
async function overflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}

test('five profiles keep appearance and saved lists separate across reloads', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await register(page);
  for (const [index, name] of ['Mira', 'Omar', 'Lina', 'Guest'].entries()) {
    await page.getByRole('button', { name: /Add profile/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Profile name').fill(name);
    await dialog
      .getByRole('button', { name: ['ocean', 'violet', 'emerald', 'amber'][index], exact: true })
      .click();
    await dialog.getByRole('button', { name: 'Save profile' }).click();
    await expect(dialog).not.toBeVisible();
  }
  await expect(page.locator('.profile-tile')).toHaveCount(5);
  await expect(page.getByRole('button', { name: /Add profile/ })).toHaveCount(0);
  await expect(page.locator('.skip-link')).not.toBeFocused();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect(page.getByRole('heading', { name: 'Who’s watching?' })).toBeInViewport();
  await overflow(page);
  await page.screenshot({ path: info.outputPath('five-profiles.png'), fullPage: true });
  await choose(page);
  await page.goto('/catalogue?q=Paper');
  await page.getByRole('button', { name: 'Save Paper Lantern to your list', exact: true }).click();
  await page.getByRole('button', { name: 'Customize appearance' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Violet', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Switch profile', exact: true }).click();
  await choose(page, 'Mira');
  await expect(page.locator('html')).toHaveAttribute('data-accent', '#E50914');
  await page.goto('/library');
  await expect(page.getByRole('link', { name: 'Open Paper Lantern', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Switch profile', exact: true }).click();
  await choose(page);
  await expect(page.locator('html')).toHaveAttribute('data-accent', '#A78BFA');
  await page.goto('/library');
  await expect(page.getByRole('link', { name: 'Open Paper Lantern', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: 'Open Paper Lantern', exact: true })).toBeVisible();
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => /session|token|csrf/i.test(key)),
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
});
test('registration, sign-in and recovery work without exposing session tokens', async ({
  page,
  context,
}, info) => {
  const { email, code } = await register(page);
  await page.goto('/account');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('wrong password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect.');
  await page.goto('/recover');
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Recovery code', { exact: true }).fill(code);
  await page.getByLabel('New password', { exact: true }).fill('Our changed sample passphrase 2026');
  await page
    .getByLabel('Confirm password', { exact: true })
    .fill('Our changed sample passphrase 2026');
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(page.getByRole('heading', { name: 'Save your new recovery code' })).toBeVisible();
  await page.getByLabel('I have saved my recovery code').check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Our changed sample passphrase 2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/profiles$/);
  const cookies = await context.cookies();
  expect(
    cookies.some((c) => c.name === 'solanime_session' && c.httpOnly && c.sameSite === 'Strict'),
  ).toBe(true);
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'Security', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('account-settings.png'), fullPage: true });
  await overflow(page);
});
test('account screens retain accessible contrast, focus and mobile layout', async ({
  page,
}, info) => {
  for (const path of ['/login', '/register', '/recover']) {
    await page.goto(path);
    await expect(page.getByLabel('Email address', { exact: true })).toBeVisible();
    await expect(page.locator('.auth-panel form')).toBeVisible();
    await overflow(page);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(
      results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
    ).toEqual([]);
  }
  await page.goto('/login');
  await expect(page.getByLabel('Email address', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('sign-in.png'), fullPage: true });
  await page.getByRole('button', { name: 'Use light theme' }).click();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations).toEqual([]);
});
test('provider compatibility is an explicit mode and recreates only the provider frame', async ({
  page,
}, info) => {
  await page.route('https://megaplay.buzz/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><body style="background:#111;color:white"><p id="message">A controlled provider fixture</p><script>try{window.localStorage.setItem("fixture","1");}catch{}<\/script></body></html>',
    }),
  );
  const episode = (await (await page.request.get('/api/titles/paper-lantern')).json()).episodes[0];
  await page.goto(`/watch/paper-lantern/${episode.id}?language=sub`);
  await page.getByRole('button', { name: 'Play here', exact: true }).click();
  await expect(page.locator('iframe')).toHaveAttribute(
    'sandbox',
    'allow-scripts allow-same-origin',
  );
  await page.getByRole('button', { name: 'Provider compatibility', exact: true }).click();
  await expect(page.locator('iframe')).not.toHaveAttribute('sandbox', /.*/);
  await expect(page.getByText('Provider compatibility active', { exact: false })).toBeVisible();
  await expect(page.frameLocator('iframe').locator('#message')).toBeVisible();
  await page.getByRole('button', { name: 'Restricted embed', exact: true }).click();
  await expect(page.locator('iframe')).toHaveAttribute(
    'sandbox',
    'allow-scripts allow-same-origin',
  );
  await overflow(page);
  await page.screenshot({ path: info.outputPath('playback-modes.png'), fullPage: true });
});

test('a sync conflict does not trap an authenticated session', async ({ page }) => {
  await register(page);
  await choose(page);
  await page.goto('/catalogue?q=Paper');
  await expect(
    page.getByRole('button', { name: 'Save Paper Lantern to your list', exact: true }),
  ).toBeVisible();
  await page.route('**/api/account/profiles/*/data', (route) => {
    if (route.request().method() === 'POST')
      return route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'BAD_REQUEST',
            message: 'This profile changed in another tab. Reload it before saving again.',
          },
        }),
      });
    return route.continue();
  });
  await page.getByRole('button', { name: 'Save Paper Lantern to your list', exact: true }).click();
  await expect(
    page
      .getByText('This profile changed in another tab. Reload it before saving again.', {
        exact: false,
      })
      .first(),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Switch profile', exact: true }).click();
  await page.getByRole('link', { name: 'Account settings', exact: true }).click();
  await page
    .getByRole('button', { name: 'Discard unsaved changes and sign out', exact: true })
    .click();
  await expect(page).toHaveURL(/\/login$/);
  const session = await (await page.request.get('/api/account/session')).json();
  expect(session.account).toBeNull();
});
