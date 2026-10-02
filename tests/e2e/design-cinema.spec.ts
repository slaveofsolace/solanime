import { expect, test } from '@playwright/test';

const image =
  '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="510"><rect width="360" height="510" fill="#253744"/><circle cx="180" cy="180" r="85" fill="#efb083"/></svg>';

test.use({ viewport: { width: 320, height: 720 } });

test.beforeEach(async ({ page }) => {
  await page.route('https://images.example.test/**', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: image }),
  );
});

async function expectNoOverflow(page: import('@playwright/test').Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ),
    )
    .toBe(true);
}

test('320px catalogue and watch surfaces stay usable without horizontal page overflow', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.home-feature')).toBeVisible();
  await expectNoOverflow(page);

  await page.goto('/catalogue?q=Paper');
  await expect(page.getByRole('link', { name: 'Open Paper Lantern' })).toBeVisible();
  await expectNoOverflow(page);

  const title = await (await page.request.get('/api/titles/paper-lantern')).json();
  const episode = title.episodes[0];
  await page.goto(`/watch/paper-lantern/${episode.id}?language=sub`);
  const source = page.getByRole('group', { name: 'Server', exact: true });
  const version = page.getByRole('group', { name: 'Audio', exact: true });
  await expect(source.getByRole('button').first()).toBeVisible();
  await expect(version).toBeVisible();
  for (const button of [...await source.getByRole('button').all(), ...await version.getByRole('button').all()]) {
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await expectNoOverflow(page);

  // Phones get a focused watch screen: a top bar with the way back replaces the masthead.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.masthead')).toBeHidden();
  const topbar = (await page.locator('.watch-topbar').boundingBox())!;
  expect(topbar.y).toBe(0);
  expect(topbar.height).toBeGreaterThanOrEqual(44);
  expect((await source.getByRole('button').first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await version.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expectNoOverflow(page);
});

test('unresolved account restoration cannot write private intent into guest storage', async ({
  page,
}) => {
  await page.route('**/api/account/session', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    await route.continue();
  });
  await page.goto('/');
  await expect(page.locator('.home-feature')).toBeVisible();
  await page.getByRole('button', { name: 'Save featured title' }).click();
  expect(await page.evaluate(() => localStorage.getItem('sol-anime:watchlist-records'))).toBeNull();
  await expectNoOverflow(page);
});
