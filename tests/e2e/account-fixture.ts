import { expect, type Page } from '@playwright/test';
import { generatedTestPassphrase } from '../helpers/auth-material';

/** Local fixture server only. Other account tests exercise the visible sign-up flow. */
export async function accountFixture(page: Page, values: Record<string, unknown> = {}) {
  await page.goto('/');
  const origin = new URL(page.url()).origin;
  if (origin !== 'http://127.0.0.1:18787') throw new Error('Account fixture must never target a deployed origin.');
  const registered = await page.request.post('/api/account/register', { headers: { origin, 'x-solanime-intent': 'account' },
    data: { email: `fixture-${crypto.randomUUID()}@example.test`, password: generatedTestPassphrase('ui fixture'), remember: false } });
  expect(registered.ok()).toBe(true);
  const session = await registered.json();
  const profile = session.profiles[0];
  for (const [key, value] of Object.entries(values)) {
    const saved = await page.request.post(`/api/account/profiles/${profile.id}/data`, {
      headers: { origin, 'x-solanime-intent': 'account', 'x-csrf-token': session.csrfToken }, data: { key, value, revision: 0 },
    });
    expect(saved.ok()).toBe(true);
  }
  await page.evaluate(({ account, profile }) => sessionStorage.setItem('solanime:profile:' + account, profile), { account: session.account.id, profile: profile.id });
  return { session, profile };
}
