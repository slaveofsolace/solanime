import { expect, test } from '@playwright/test';
import { accountFixture } from './account-fixture';
import { fixtureArt, noOverflow } from './helpers';

test.beforeEach(async ({ page }) => {
  await fixtureArt(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('saved-title views retain real order, filters and the last episode resume destination', async ({ page }, info) => {
  const paper = await (await page.request.get('/api/titles/paper-lantern')).json();
  const journey = await (await page.request.get('/api/titles/long-journey')).json();
  const entry = { titleId: paper.title.id, slug: paper.title.slug, title: paper.title.name,
    episodeId: paper.episodes[0].id, episodeLabel: 'Episode 1', language: 'sub',
    watchedAt: '2026-10-01T12:00:00Z', position: 25, duration: 100 };
  await accountFixture(page, { 'watchlist-records': [paper.title, journey.title], history: [entry] });
  await page.goto('/library');
  const navigation = page.getByRole('navigation', { name: 'Library views' });
  const cards = page.locator('.library-saved-grid .title-card');
  await expect(navigation.getByRole('link', { name: 'My List', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(cards).toHaveCount(2);
  await expect(cards.first().getByRole('heading')).toHaveText(paper.title.name);
  await expect(page.locator('.library-saved-grid .title-card--poster')).toHaveCount(2);
  await expect(page.locator('.history-list')).toHaveCount(0);
  const progress = page.getByRole('progressbar', { name: 'Paper Lantern Episode 1 progress', exact: true });
  await expect(progress).toHaveAttribute('aria-valuenow', '25');
  const resume = page.getByRole('link', { name: 'Resume · Episode 1', exact: true });
  const destination = `/watch/paper-lantern/${entry.episodeId}?language=sub`;
  await expect(resume).toHaveAttribute('href', destination);
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('library-saved-landscape.png'), scale: 'css' });

  await page.getByRole('combobox', { name: 'Sort saved titles', exact: true }).selectOption('title');
  await expect(cards.first().getByRole('heading')).toHaveText(journey.title.name);
  await page.reload();
  await expect(cards.first().getByRole('heading')).toHaveText(journey.title.name);
  await expect(page.getByRole('combobox', { name: 'Sort saved titles', exact: true })).toHaveValue('title');
  await page.getByRole('combobox', { name: 'Filter saved titles', exact: true }).selectOption('started');
  await expect(cards).toHaveCount(1);
  await expect(cards.first().getByRole('heading')).toHaveText(paper.title.name);
  await resume.click();
  await expect(page).toHaveURL(destination);
  await expect(page.locator('.watch-page')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('combobox', { name: 'Filter saved titles', exact: true })).toHaveValue('started');
  await page.getByRole('combobox', { name: 'Filter saved titles', exact: true }).selectOption('not-started');
  await expect(cards).toHaveCount(1);
  await expect(cards.first().getByRole('heading')).toHaveText(journey.title.name);
  const format = page.getByRole('combobox', { name: 'Saved title format', exact: true });
  await expect(format.locator('option')).toHaveText(['All formats', ...[paper.title.type, journey.title.type].sort()]);
  await format.selectOption(paper.title.type);
  await expect(page.getByText('No saved titles match these filters.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(cards).toHaveCount(2);
  await expect(cards.first().getByRole('heading')).toHaveText(paper.title.name);
  await navigation.getByRole('link', { name: 'History', exact: true }).click();
  await expect(page).toHaveURL(/\/library\?view=history$/);
  await expect(navigation.getByRole('link', { name: 'History', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.history-list > li')).toHaveCount(1);
  await expect(cards).toHaveCount(0);
  await noOverflow(page);
});

test('legacy history and imported-list links open the correct Library view', async ({ page }) => {
  const paper = await (await page.request.get('/api/titles/paper-lantern')).json();
  await accountFixture(page, { history: [{ titleId: paper.title.id, slug: paper.title.slug,
    title: paper.title.name, episodeId: paper.episodes[0].id, episodeLabel: 'Episode 1',
    language: 'sub', watchedAt: '2026-10-01T12:00:00Z' }] });
  await page.route('**/api/account/profiles/*/mal/list?*', route => route.fulfill({ json: {
    items: [{ id: 5114, title: 'Imported review title', status: 'watching', watchedEpisodes: 3,
      totalEpisodes: 64, score: 0, updatedAt: '2026-10-01T00:00:00Z' }], hasMore: false,
  } }));
  await page.goto('/library#history-title');
  await expect(page.getByRole('heading', { name: 'Watch history', exact: true })).toBeFocused();
  await expect(page.locator('.history-list > li')).toHaveCount(1);
  await expect(page.locator('#mal-list')).toHaveCount(0);
  await page.goto('/library?view=history#mal-list');
  await expect(page.getByRole('navigation', { name: 'Library views' }).getByRole('link', { name: 'My List', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#mal-list').getByRole('link', { name: 'Imported review title', exact: true })).toBeVisible();
  await expect(page.locator('#mal-list').getByRole('spinbutton', { name: 'Episodes watched', exact: true })).toHaveValue('3');
  await expect(page.locator('.history-list')).toHaveCount(0);
  await noOverflow(page);
});
