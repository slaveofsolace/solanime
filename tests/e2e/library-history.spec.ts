import { expect, test } from '@playwright/test';
import { fixtureArt, noOverflow } from './helpers';

test('history searches every retained entry and exposes the next page without fabricated progress', async ({ page }) => {
  await fixtureArt(page);
  await page.goto('/library');
  await expect(page.getByRole('heading', {name:'Library',exact:true})).toBeVisible();
  await page.evaluate(() => localStorage.setItem('sol-anime:history', JSON.stringify(Array.from({length:25}, (_, i) => ({
    titleId:'1', slug:'paper-lantern', title:'Paper Lantern', episodeId:String(i+1),
    episodeLabel:`Episode ${i+1}`,language:'sub',watchedAt:'2026-01-01T00:00:00Z',
    ...(i===0 ? {position:99,duration:100} : i===1 ? {position:25,duration:100} : {}),
  })))));
  await page.reload();
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
  await expect(page.locator('.library-settings')).not.toHaveAttribute('open');
  await page.locator('.library-settings summary').click();
  await expect(page.getByRole('heading',{name:'Playback defaults'})).toBeVisible();
  await noOverflow(page);
});
