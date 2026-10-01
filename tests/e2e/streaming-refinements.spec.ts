import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fixtureArt, noOverflow } from './helpers';
import { accountFixture } from './account-fixture';

test.beforeEach(async ({ page }) => {
  await fixtureArt(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

for (const nativeStyle of [false, true]) {
  test(`phone header stays usable over artwork and after scrolling (${nativeStyle ? 'native-style' : 'website'})`, async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    if (nativeStyle) await page.addInitScript(() => {
      const mark = () => document.documentElement?.classList.add('solanime-native-ios');
      mark(); document.addEventListener('DOMContentLoaded', mark, { once: true });
    });
    await page.goto('/');
    await expect(page.locator('#featured-title')).toBeVisible();
    const header = page.locator('.masthead');
    await expect(header).toHaveAttribute('data-scrolled', 'false');
    await page.evaluate(() => window.scrollTo(0, 420));
    await expect(header).toHaveAttribute('data-scrolled', 'true');
    expect((await header.boundingBox())?.y).toBeCloseTo(0, 0);
    await expect(page.locator('.wordmark')).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`header-scrolled-${nativeStyle}.png`) });
    await page.locator('.header-search__trigger').click();
    const input = page.getByRole('searchbox', { name: 'Find titles', exact: true });
    await expect(input).toBeVisible();
    await input.fill('Paper');
    await input.press('Enter');
    await expect(page.getByRole('link', { name: 'Open Paper Lantern', exact: true })).toBeVisible();
    await noOverflow(page);
  });
}

test('episode action sheet preserves history while hiding a continuing series', async ({ page }, info) => {
  const detail = await (await page.request.get('/api/titles/paper-lantern')).json();
  const title = detail.title;
  const episode = detail.episodes[0];
  const entry = { titleId: title.id, slug: title.slug, title: title.name, episodeId: episode.id,
    episodeLabel: 'Episode 1', language: 'sub', position: 1, duration: 100,
    imageUrl: title.imageUrl, watchedAt: '2026-01-01T00:00:00Z' };
  await accountFixture(page, { history: [entry] });
  await page.goto('/');
  const continuing = page.getByRole('region', { name: 'Continue watching', exact: true });
  const more = continuing.getByRole('button', { name: 'More options for Paper Lantern Episode 1', exact: true });
  await more.click();
  const sheet = page.getByRole('dialog', { name: 'Paper Lantern', exact: true });
  await expect(sheet.getByRole('link', { name: 'Series info', exact: true })).toHaveAttribute('href', '/title/paper-lantern');
  await sheet.getByRole('button', { name: 'Add to Watchlist', exact: true }).click();
  await expect(sheet.getByRole('button', { name: 'Remove from Watchlist', exact: true })).toBeVisible();
  await sheet.getByRole('button', { name: 'Mark as watched', exact: true }).click();
  await expect(sheet.getByRole('button', { name: 'Mark as unwatched', exact: true })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Share episode', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('episode-actions.png') });
  const a11y = await new AxeBuilder({ page }).include('.history-actions-sheet').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  expect(a11y.violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
  await more.click();
  await sheet.getByRole('button', { name: 'Hide from Continue Watching', exact: true }).click();
  await expect(continuing).toHaveCount(0);
  await page.goto('/library#history-title');
  await expect(page.locator('.history-list > li')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Open Paper Lantern', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'More options for Paper Lantern Episode 1', exact: true }).click();
  await sheet.getByRole('button', { name: 'Remove from History', exact: true }).click();
  await expect(page.locator('.history-list > li')).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Episodes you watch will appear here.', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Paper Lantern', exact: true })).toBeVisible();
  await noOverflow(page);
});
