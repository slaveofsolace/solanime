import { expect, test } from '@playwright/test';
import { fixtureArt, noOverflow } from './helpers';

test.beforeEach(async ({ page }) => { await fixtureArt(page); await page.emulateMedia({ reducedMotion: 'reduce' }); });

test('desktop catalogue uses dense artwork rows with detail revealed on intent', async ({ page }, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Desktop geometry contract');
  await page.goto('/catalogue');
  const cards = page.locator('.title-grid .title-card');
  await expect(cards).toHaveCount(24);

  await expect
    .poll(() =>
      cards.evaluateAll((elements) => {
        const rows = elements.slice(0, 8).map((element) => (element as HTMLElement).offsetTop);
        return rows.length === 8 && rows.slice(0, 6).every((top) => top === rows[0]) && rows[6] > rows[0] + 20;
      }),
    )
    .toBe(true);

  const card = cards.first();
  const details = card.locator('.title-card__actions');
  const openLabel = await card.locator('.title-card__art').getAttribute('aria-label');
  const visibleName = openLabel?.replace(/^Open /, '');
  expect(visibleName).toBeTruthy();
  await expect(card.locator('.title-card__copy h2')).toHaveText(visibleName!);
  await expect(card.locator('.title-card__copy h2')).toBeVisible();
  const composedPoster = card.locator('.title-card__art > img');
  await expect(composedPoster).toBeVisible();
  await expect(composedPoster).toHaveCSS('object-fit', 'cover');
  await expect(card.locator('.cover-composition')).toHaveCount(0);
  const artBox = await card.locator('.title-card__art').boundingBox();
  const posterBox = await composedPoster.boundingBox();
  const titleBox = await card.locator('.title-card__copy h2').boundingBox();
  expect(artBox).not.toBeNull();
  expect(posterBox).not.toBeNull();
  expect(titleBox).not.toBeNull();
  expect(posterBox!.x).toBeCloseTo(artBox!.x, 0);
  expect(posterBox!.width).toBeCloseTo(artBox!.width, 0);
  expect(artBox!.width / artBox!.height).toBeCloseTo(2 / 3, 2);
  expect(titleBox!.y).toBeGreaterThanOrEqual(artBox!.y + artBox!.height);
  expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(artBox!.x + artBox!.width);
  await expect(card.locator('.title-card__copy h2')).toHaveCSS('white-space', 'nowrap');
  await expect(details).toHaveCSS('opacity', '0');
  await card.hover();
  await expect(details).toHaveCSS('opacity', '1');
  const quickLook = card.getByRole('button', { name: /Quick look at/ });
  await expect(quickLook).toBeVisible();
  await quickLook.click();
  await expect(page.locator('.title-preview__copy h3')).toHaveText(visibleName!);
  await page.getByRole('button', { name: 'Close dialog' }).click();

  await page.getByRole('button', { name: 'Compact' }).click();
  await expect(page).toHaveURL(/(?:\?|&)view=compact(?:&|$)/);
  await expect(cards).toHaveCount(24);
  await expect
    .poll(() =>
      cards.evaluateAll((elements) => {
        const rows = elements.slice(0, 8).map((element) => (element as HTMLElement).offsetTop);
        return rows.length === 8 && rows.slice(0, 7).every((top) => top === rows[0]) && rows[7] > rows[0] + 20;
      }),
    )
    .toBe(true);
  await noOverflow(page);
});

test('catalogue utility controls remain compact and title episodes use the available width', async ({
  page,
}, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Desktop geometry contract');
  await page.goto('/catalogue');
  await expect(page.locator('.title-card').first()).toBeVisible();
  expect((await page.locator('.search-field input').boundingBox())!.height).toBeLessThanOrEqual(42);
  expect((await page.locator('.catalogue-heading').boundingBox())!.height).toBeLessThanOrEqual(100);
  expect(
    Number.parseFloat(await page.locator('.catalogue-controls').evaluate((node) => getComputedStyle(node).marginBottom)),
  ).toBeLessThanOrEqual(10);

  await page.goto('/title/paper-lantern');
  await expect(page.locator('.title-hero')).toHaveCSS('box-sizing', 'border-box');
  expect((await page.locator('.title-hero').boundingBox())!.height).toBeGreaterThanOrEqual(700);
  expect((await page.locator('.title-hero').boundingBox())!.height).toBeLessThanOrEqual(850);
  const episodes = page.locator('.episode-grid > li');
  await expect(episodes).toHaveCount(3);
  const rows = await Promise.all([0, 1, 2].map((index) => episodes.nth(index).boundingBox()));
  expect(Math.abs(rows[1]!.y - rows[0]!.y)).toBeLessThanOrEqual(1);
  expect(rows[2]!.y).toBeGreaterThan(rows[0]!.y + rows[0]!.height - 1);
  expect(Math.abs(rows[2]!.x - rows[0]!.x)).toBeLessThanOrEqual(1);
  expect(rows.every((row) => Math.abs(row!.width - rows[0]!.width) <= 1)).toBe(true);
  expect(rows[1]!.x).toBeGreaterThan(rows[0]!.x + rows[0]!.width);
  const grid = await page.locator('.episode-grid').boundingBox();
  expect(rows[0]!.x).toBeCloseTo(grid!.x, 0);
  expect(rows[1]!.x + rows[1]!.width).toBeCloseTo(grid!.x + grid!.width, 0);
  expect(rows.every((row) => row!.height >= 44 && row!.height <= 80)).toBe(true);
  const detail = await (await page.request.get('/api/titles/paper-lantern')).json();
  const expectedEpisode = `/watch/paper-lantern/${encodeURIComponent(detail.episodes[1].id)}?language=sub`;
  await expect(episodes.nth(1).locator('a')).toHaveAttribute('href', expectedEpisode);
  await episodes.nth(1).locator('a').click();
  await expect(page).toHaveURL(expectedEpisode);
  await noOverflow(page);
});

test('catalogue keeps advanced filters behind a compact, state-aware disclosure', async ({ page }) => {
  await page.goto('/catalogue');
  const disclosure = page.locator('.filter-disclosure');
  await expect(disclosure).not.toHaveAttribute('open', '');
  await expect(page.getByRole('combobox', { name: 'Genre' })).not.toBeVisible();

  await page.getByText('Filters', { exact: true }).click();
  const genreSelect = page.getByRole('combobox', { name: 'Genre' });
  await expect(genreSelect).toBeVisible();
  const genreValue = await genreSelect.locator('option').nth(1).getAttribute('value');
  expect(genreValue).toBeTruthy();
  await genreSelect.selectOption(genreValue!);
  await expect(page).toHaveURL(new RegExp(`(?:\\?|&)genre=${encodeURIComponent(genreValue!)}(?:&|$)`));
  await expect(disclosure).toHaveAttribute('open', '');
  await expect(disclosure).toContainText('1 active');
  await noOverflow(page);
});

test('title episode controls remain a single usable column at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto('/title/paper-lantern');
  const episodes = page.locator('.episode-grid > li');
  await expect(episodes).toHaveCount(3);
  const rows = await Promise.all([0, 1, 2].map((index) => episodes.nth(index).boundingBox()));
  expect(rows.every((row) => Math.abs(row!.x - rows[0]!.x) <= 1)).toBe(true);
  expect(rows[1]!.y).toBeGreaterThan(rows[0]!.y);
  expect(rows[2]!.y).toBeGreaterThan(rows[1]!.y);
  const toggle = episodes.first().getByRole('button', { name: /Mark watched/ });
  const target = await toggle.boundingBox();
  expect(target!.width).toBeGreaterThanOrEqual(44);
  expect(target!.height).toBeGreaterThanOrEqual(44);
  await toggle.click();
  await expect(episodes.first().getByRole('button', { name: /Mark unwatched/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('searchbox', { name: 'Find an episode' }).fill('2');
  await expect(episodes).toHaveCount(1);
  await noOverflow(page);
});

test('home genre discovery is a dense text index rather than decorative panels', async ({ page }, info) => {
  test.skip(info.project.name.startsWith('mobile'), 'Desktop density contract');
  await page.goto('/');
  await expect(page.locator('.feature-kicker')).toHaveCount(0);
  const genre = page.locator('.genre-grid a').first();
  await expect(genre).toBeVisible();
  await expect(genre).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  expect((await genre.boundingBox())!.height).toBeLessThanOrEqual(66);
});

test('title defaults to a mapped version and presents a single grammatical episode count', async ({
  page,
}) => {
  await page.route('**/api/titles/provider-backed-language', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        collectionState: 'complete',
        title: {
          id: 'mapped-title',
          sourceId: 'mapped-source',
          slug: 'provider-backed-language',
          name: 'Provider-backed language',
          type: 'Movie',
          releaseYear: null,
          status: 'Finished Airing',
          collectionState: 'complete',
        },
        aliases: [],
        genres: [],
        related: [],
        episodes: [
          {
            id: 'mapped-episode',
            sourceId: 'mapped-episode-source',
            number: '1',
            label: 'Episode 1',
            versions: [
              { id: 'sub-version', language: 'sub', label: 'Subtitled', providerCount: 2, availability: 'observed' },
              { id: 'silent-version', language: 'silent', label: 'Restored', providerCount: 2, availability: 'available' },
            ],
          },
        ],
      }),
    }),
  );

  await page.goto('/title/provider-backed-language');
  await expect(page.getByRole('heading', { name: 'Provider-backed language' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'silent', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'sub', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.getByRole('link', { name: /Open first episode/ })).toHaveAttribute(
    'href',
    /language=silent/,
  );
  await expect(page.getByText('YEAR UNKNOWN')).toHaveCount(0);
  await expect(page.getByText('1 episode', { exact: true })).toHaveCount(1);
});

test('touch cards keep original posters and full accessible title links without text over artwork', async ({ page }, info) => {
  test.skip(!info.project.name.startsWith('mobile'), 'Touch presentation contract');
  const longName = 'The Extremely Long Journey Beyond the Last Lantern';
  let expectedDestination = '';
  await page.route('**/api/titles?*', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (body.items?.length >= 2) {
      expectedDestination = `/title/${encodeURIComponent(body.items[0].slug)}`;
      body.items[0] = { ...body.items[0], name: longName, backdropUrl: null };
      body.items[1] = {
        ...body.items[1],
        backdropUrl: 'https://images.example.test/verified-wide-fi.svg',
      };
    }
    await route.fulfill({ response, json: body });
  });
  await page.goto('/catalogue');
  const card = page.locator('.title-card').first();
  await expect(card).toBeVisible();
  await expect(card.locator('.title-card__copy')).toHaveCSS('opacity', '1');
  const title = card.locator('.title-card__copy h2');
  const art = card.locator('.title-card__art');
  const poster = card.locator('.title-card__art > img');
  await expect(title).toHaveText(longName);
  await expect(title).toBeVisible();
  await expect(title.locator('a')).toBeVisible();
  await expect(art).toBeVisible();
  await expect(poster).toBeVisible();
  await expect(title).toHaveCSS('white-space', 'nowrap');
  await expect(art).toHaveAttribute('aria-label', `Open ${longName}`);
  const artBox = await art.boundingBox();
  const titleBox = await title.boundingBox();
  const posterBox = await poster.boundingBox();
  expect(titleBox!.height).toBeLessThan(24);
  expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(posterBox!.x + posterBox!.width);
  expect(titleBox!.y).toBeGreaterThanOrEqual(artBox!.y + artBox!.height);
  expect(artBox!.width / artBox!.height).toBeCloseTo(2 / 3, 2);

  const backdropCard = page.locator('.title-card').nth(1);
  await expect(backdropCard.locator('.cover-composition')).toHaveCount(0);
  await expect(backdropCard.locator('.title-card__copy')).toHaveCSS('position', 'relative');
  await expect(backdropCard.locator('.title-card__copy h2')).toBeVisible();
  await noOverflow(page);

  expect(expectedDestination).toMatch(/^\/title\/[^/?#]+$/);
  const destination = await title.locator('a').getAttribute('href');
  expect(destination).toBe(expectedDestination);
  await expect(art).toHaveAttribute('href', expectedDestination);
  await title.locator('a').click();
  await expect(page).toHaveURL(expectedDestination);
  await page.goBack();
  const restoredCard = page.locator('.title-card').first();
  await expect(restoredCard.locator('.title-card__copy h2')).toHaveText(longName);
  await expect(restoredCard.locator('.title-card__art')).toHaveAttribute(
    'href',
    expectedDestination,
  );
  await restoredCard.locator('.title-card__art').click();
  await expect(page).toHaveURL(expectedDestination);
});
