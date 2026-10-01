import { expect, test } from '@playwright/test';
import { fixtureArt, noOverflow } from './helpers';
import { accountFixture } from './account-fixture';

test('history searches every retained entry and exposes the next page without fabricated progress', async ({ page }) => {
  await fixtureArt(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await accountFixture(page, { history: Array.from({length:25}, (_, i) => ({
    titleId:'1', slug:'paper-lantern', title:'Paper Lantern', episodeId:String(i+1),
    episodeLabel:`Episode ${i+1}`,language:'sub',watchedAt:'2026-01-01T00:00:00Z',
    ...(i===0 ? {position:99,duration:100} : i===1 ? {position:25,duration:100} : {}),
  })) });
  await page.goto('/library');
  await expect(page.getByRole('heading', {name:'Library',exact:true})).toBeVisible();
  const history = page.getByRole('region', {name:'Watch history',exact:true});
  await expect(history.locator('li')).toHaveCount(20);
  await expect(history.getByRole('progressbar')).toHaveCount(2);
  await expect(history.locator('li').first()).toContainText('Watch again');
  await expect(history.locator('li').nth(1)).toContainText('Resume');
  await expect(history.locator('li').nth(2)).toContainText('Open episode');
  await history.getByRole('button',{name:'Show more history'}).click();
  await expect(history.locator('li')).toHaveCount(25);
  await expect(history.getByRole('button',{name:'Show more history'})).toHaveCount(0);
  await history.getByRole('searchbox',{name:'Find in watch history'}).fill('episode 25');
  await expect(history.locator('li')).toHaveCount(1);
  await expect(history.locator('a')).toHaveAttribute('href','/watch/paper-lantern/25?language=sub');
  await history.getByRole('button',{name:'Remove Paper Lantern Episode 25 from history'}).click();
  await expect(history.getByText('No episodes match this search.')).toBeVisible();
  await page.reload();
  await history.getByRole('searchbox',{name:'Find in watch history'}).fill('episode 25');
  await expect(history.locator('li')).toHaveCount(0);
  await expect(page.locator('.library-settings')).toHaveCount(0);
  await page.goto('/settings');
  await expect(page.getByRole('heading',{name:'Playback', exact:true})).toBeVisible();
  await noOverflow(page);
});

test('continue watching selects one latest episode per series and advances only to a real next episode', async ({ page }) => {
  await fixtureArt(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const detail = await (await page.request.get('/api/titles/paper-lantern')).json();
  const episodes = detail.episodes;
  await accountFixture(page, { history: [0, 1].map(index => ({
    titleId: detail.title.id, slug: 'paper-lantern', title: 'Paper Lantern', episodeId: episodes[index].id,
    episodeLabel: `Episode ${index + 1}`, language: 'sub', watchedAt: `2026-09-27T1${index}:00:00Z`,
    position: index === 1 ? 99 : 20, duration: 100,
  })) });
  await page.goto('/');
  const continuing = page.locator('.continue-section');
  await expect(continuing.locator('.continue-card')).toHaveCount(1);
  await expect(page.locator('.home-feature + .continue-section--home + .home-rail[aria-labelledby="rail-recent-updates"]')).toHaveCount(1);
  await expect(continuing).toContainText('Up next');
  await expect(continuing.locator('.continue-card > a')).toHaveAttribute('href', `/watch/paper-lantern/${episodes[2].id}?language=sub`);
  await expect(continuing.getByRole('progressbar')).toHaveCount(0);
  await continuing.getByRole('button', { name: 'Remove Paper Lantern from Continue watching', exact: true }).click();
  await expect(continuing).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#featured-title')).toBeVisible();
  await expect(continuing).toHaveCount(0);
  await page.goto('/library');
  await expect(page.locator('.history-list > li')).toHaveCount(2);
});
