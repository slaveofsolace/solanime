import { test, expect } from '@playwright/test';
import { fixtureArt, noOverflow, episode, watch, sourceIds, chooseSource, selectedSource, chooseLanguage, selectedLanguage } from './helpers';
import { accountFixture } from './account-fixture';
test.beforeEach(async ({ page }) => fixtureArt(page));

test('browse, search, save and reopen a persistent list', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await accountFixture(page);
  await page.goto('/');
  await expect(page.locator('#featured-title')).toBeVisible();
    await page.getByRole('button', { name: 'Search all titles', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Find titles', exact: true }).fill('Paper');
    await page.getByRole('searchbox', { name: 'Find titles', exact: true }).press('Enter');
  await expect(page).toHaveURL(/search\?q=Paper/);
  await page.getByRole('link', { name: 'Open Paper Lantern', exact: true }).click();
  await page.getByRole('button', { name: 'My List', exact: true }).click();
  const phoneNavigation = page.getByRole('navigation', { name: 'iPhone navigation' });
  if (await phoneNavigation.isVisible()) await phoneNavigation.getByRole('link', { name: 'Library', exact: true }).click();
  else await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: /My list/ }).click();
  await expect(page.getByRole('link', { name: 'Open Paper Lantern', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: 'Open Paper Lantern', exact: true })).toBeVisible();
  await noOverflow(page);
  expect(errors).toEqual([]);
});
test('corrupt browser records cannot blank the interface', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sol-anime:watchlist-records', 'null');
    localStorage.setItem('sol-anime:history', '{"bad":true}');
    localStorage.setItem('sol-anime:preferences', '{"theme":{}}');
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/catalogue');
  await expect(page.locator('.title-card').first()).toBeVisible();
  expect(errors).toEqual([]);
});
test('catalogue retries HTML backend failures rather than interpreting them as data', async ({
  page,
}) => {
  let failures = 1;
  await page.route('**/api/titles?**', (route) =>
    failures-- > 0
      ? route.fulfill({ contentType: 'text/html', body: '<html>Wrong backend</html>' })
      : route.continue(),
  );
  await page.goto('/catalogue');
  await expect(
    page.locator('.sol-brand-readiness').getByText('The catalogue API is not connected.', { exact: false }),
  ).toBeVisible();
  await page.locator('.sol-brand-readiness').getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('.title-card').first()).toBeVisible();
});
test('large episode lists remain paginated and searchable', async ({ page }) => {
  await page.goto('/title/long-journey');
  await expect(page.locator('.episode-grid > li')).toHaveCount(50);
  await page.getByRole('button', { name: '51–100', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Find an episode' }).fill('Episode');
  await expect(page.getByRole('button', { name: '1–50', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('searchbox', { name: 'Find an episode' }).fill('120');
  await expect(page.locator('.episode-grid > li')).toHaveCount(1);
  await page.goto('/title/paper-lantern');
  await expect(page.locator('.episode-grid > li')).toHaveCount(3);
  await noOverflow(page);
});
test('source switching replaces the media element, preserves language and handles retries', async ({
  page,
}) => {
  const e = await watch(page);
  const first = await page.locator('video').elementHandle();
  const options = await sourceIds(page);
  expect(options.length).toBeGreaterThan(1);
  await page.route('**/api/providers/*/resolve', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"error":{"code":"UNAVAILABLE","message":"Controlled media failure"}}',
    }),
  );
  await chooseSource(page, options[1]);
  await expect(page.getByText('Controlled media failure')).toBeVisible();
  expect(await first!.evaluate((el) => el.isConnected)).toBe(false);
  await expect(page.locator('video,iframe')).toHaveCount(0);
  await page.unroute('**/api/providers/*/resolve');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('video')).toBeVisible();
  await chooseLanguage(page, 'dub');
  await expect(page.locator('video')).toBeVisible();
  await expect(page).toHaveURL(/language=dub/);
  await page
    .getByRole('group', { name: 'Episode navigation' })
    .getByRole('button', { name: 'Next episode', exact: true })
    .click();
  await expect(page.locator('video')).toBeVisible();
  expect(new URL(page.url()).pathname).not.toBe(`/watch/paper-lantern/${e.id}`);
  await expect(selectedLanguage(page)).toHaveAttribute('data-language', 'dub');
  await noOverflow(page);
});
test('unavailable source lists retry without losing the episode', async ({ page }) => {
  const e = await episode(page);
  let first = true;
  await page.route('**/api/episodes/*/providers?*', (route) => {
    if (first) {
      first = false;
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"error":{"message":"Sources unavailable"}}',
      });
    }
    return route.continue();
  });
  await page.goto(`/watch/paper-lantern/${e.id}?language=sub`);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('video')).toBeVisible();
});
test('late resolutions cannot overwrite a newer native source', async ({ page }) => {
  let first = true;
  await page.route('**/api/providers/*/resolve', async (route) => {
    if (first) {
      first = false;
      await new Promise((r) => setTimeout(r, 600));
    }
    try {
      await route.continue();
    } catch {
      /* superseded request */
    }
  });
  const e = await episode(page);
  await page.goto(`/watch/paper-lantern/${e.id}?language=sub`);
  const values = await sourceIds(page);
  await chooseSource(page, values[1]);
  await expect(page.locator('video')).toBeVisible();
  await page.waitForTimeout(650);
  await expect(selectedSource(page)).toHaveAttribute('data-mapping-id', values[1]);
  await expect(page.locator('video')).toHaveCount(1);
});
