import { expect, test } from '@playwright/test';
import { generatedTestPassphrase } from '../helpers/auth-material';

const operatorToken = 'private-fixture-operator-token-not-for-release';
const origin = 'http://127.0.0.1:18788';

test('browse navigation stays hidden while the private session check is unresolved', async ({ page }) => {
  let releaseSession!: () => void;
  const held = new Promise<void>((resolve) => { releaseSession = resolve; });
  await page.route('**/api/account/session', async (route) => {
    await held;
    await route.continue();
  });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.site-shell')).toBeAttached();
    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toHaveCount(0);
  } finally {
    releaseSession();
  }
  await expect(page).toHaveURL(/\/login\?returnTo=%2F/);
});

test('private browsing requires an approved account and survives a reload', async ({ page }, info) => {
  const email = `private-${crypto.randomUUID()}@example.test`;
  const password = generatedTestPassphrase('private browser acceptance');

  await page.goto('/');
  await expect(page).toHaveURL(/\/login\?returnTo=%2F/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Search all titles' })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('private-sign-in.png'), fullPage: true });
  expect((await page.request.get('/api/titles?pageSize=1')).status()).toBe(401);

  await page.goto('/register?returnTo=%2F');
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Keep a way back in' })).toBeVisible();
  await page.getByLabel('I have saved my recovery code').check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Once approved, you should receive an email')).toBeVisible();
  expect((await page.request.get('/api/titles?pageSize=1')).status()).toBe(401);

  const unapproved = await page.request.post('/api/account/login', {
    headers: { origin, 'x-solanime-intent': 'account' },
    data: { email, password },
  });
  expect(unapproved.status()).toBe(403);
  expect((await unapproved.json()).error.details.reason).toBe('ACCOUNT_PENDING_APPROVAL');

  const queueResponse = await page.request.get('/api/admin/accounts/pending', {
    headers: { 'x-admin-token': operatorToken },
  });
  expect(queueResponse.status()).toBe(200);
  const queue = (await queueResponse.json()).items as Array<{ id: string; email: string }>;
  const request = queue.find((item) => item.email === email);
  expect(request).toBeDefined();
  const decision = await page.request.post(`/api/admin/accounts/${request!.id}/decision`, {
    headers: { origin, 'x-admin-token': operatorToken, 'content-type': 'application/json' },
    data: { decision: 'approved' },
  });
  expect(decision.status()).toBe(200);

  await page.goto('/login?returnTo=%2F');
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/profiles(?:\?.*)?$/);
  await page.locator('.profile-tile').first().click();
  await expect(page.locator('#featured-title')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('private-home.png'), fullPage: true });
  expect((await page.request.get('/api/titles?pageSize=1')).status()).toBe(200);

  await page.reload();
  await expect(page.locator('#featured-title')).toBeVisible();
  await page.goto('/account');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
  await expect(page.getByRole('link', { name: 'Sol Anime sign in' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toHaveCount(0);
  expect((await page.request.get('/api/titles?pageSize=1')).status()).toBe(401);
});
