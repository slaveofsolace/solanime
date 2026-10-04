import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { accountFixture } from './account-fixture';

/** Fixture catalogue and fixture accounts: proves Explore mechanics, not live catalogue quality. */
const image = '<svg xmlns="http://www.w3.org/2000/svg" width="265" height="370"><rect width="265" height="370" fill="#2b3440"/><circle cx="132" cy="150" r="70" fill="#ee791f"/></svg>';
test.beforeEach(async ({ page }) => {
  await page.route('https://images.example.test/**', route => route.fulfill({ contentType: 'image/svg+xml', body: image }));
});

const history = [{ titleId: '3', slug: 'fixture-title-3', title: 'Fixture Title 03', episodeId: '1', episodeLabel: 'Episode 1', language: 'sub', watchedAt: '2026-09-20T10:00:00.000Z' }];
const progress = (page: Page) => page.locator('.explore-progress p');
const currentCard = (page: Page) => page.locator('article.explore-card');

async function openExplore(page: Page) {
  const fixture = await accountFixture(page, { history });
  await page.goto('/explore');
  await expect(page.getByRole('heading', { name: 'Find your next anime' })).toBeVisible();
  return fixture;
}
async function profileData(page: Page, profileId: string) {
  const response = await page.request.get(`/api/account/profiles/${profileId}/data`);
  return (await response.json()) as { values: Record<string, unknown> };
}

test('header links to Explore without replacing Discover', async ({ page }) => {
  await accountFixture(page);
  await page.goto('/');
  const explore = page.getByRole('link', { name: 'Explore', exact: true }).first();
  await expect(explore).toBeVisible();
  await explore.click();
  await expect(page).toHaveURL(/\/explore$/);
  await expect(page.getByRole('heading', { name: 'Find your next anime' })).toBeVisible();
});

test('a full round: swipe, keyboard, skip, undo, early results and resume', async ({ page, isMobile }, info) => {
  const { profile } = await openExplore(page);
  const before = (await profileData(page, profile.id)).values;
  await page.getByRole('button', { name: '10', exact: true }).click();
  await page.getByRole('button', { name: 'Start exploring' }).click();
  await expect(progress(page)).toHaveText('1 of 10');
  await expect(page.getByRole('button', { name: 'See recommendations now' })).toBeDisabled();
  if (!isMobile) await page.screenshot({ path: info.outputPath('explore-deck.png') });

  // A mostly vertical drag is page scrolling, never a decision.
  const box = (await currentCard(page).boundingBox())!;
  const firstName = await currentCard(page).locator('h2').innerText();
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 12, box.y + 320, { steps: 6 });
  await page.mouse.up();
  await expect(progress(page)).toHaveText('1 of 10');
  await expect(currentCard(page).locator('h2')).toHaveText(firstName);

  // A horizontal drag is Interested.
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 260, box.y + 210, { steps: 8 });
  await page.mouse.up();
  await expect(progress(page)).toHaveText('2 of 10');

  await page.keyboard.press('ArrowLeft');
  await expect(progress(page)).toHaveText('3 of 10');
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(progress(page)).toHaveText('4 of 10');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(progress(page)).toHaveText('3 of 10');
  await page.getByRole('button', { name: 'Interested', exact: true }).click();
  await page.getByRole('button', { name: 'Already seen' }).click();
  await expect(page.getByText('Did you like it?')).toBeVisible();
  await page.getByRole('button', { name: 'Liked it' }).click();
  await page.getByRole('button', { name: 'Pass', exact: true }).click();
  await expect(progress(page)).toHaveText('6 of 10');
  await expect(page.locator('.explore-sync')).toHaveText('Saved');

  // Reload resumes the same round and position.
  // The deck is deep-linked (?view=deck): a reload lands on the same card.
  await expect(page).toHaveURL(/\/explore\?view=deck$/);
  await page.reload();
  await expect(progress(page)).toHaveText('6 of 10');
  // Opening Explore fresh offers to resume the same round.
  await page.goto('/explore');
  await expect(page.getByText('You have a round in progress: 5 of 10 done.')).toBeVisible();
  await page.getByRole('button', { name: 'Resume round' }).click();
  await expect(progress(page)).toHaveText('6 of 10');

  // Typing in a dialog never triggers swipe shortcuts.
  await page.getByRole('button', { name: 'Series info' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  await expect(progress(page)).toHaveText('6 of 10');

  await page.getByRole('button', { name: 'See recommendations now' }).click();
  await expect(page.getByRole('heading', { name: 'Picked for you' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your picks' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recommended next' })).toBeVisible();
  const picks = page.locator('section[aria-labelledby="explore-picks-title"] .explore-result');
  await expect(picks).toHaveCount(2);
  await expect(page.locator('section[aria-labelledby="explore-next-title"] .explore-result').first()).toBeVisible();
  await expect(page.getByText(/% match/i)).toHaveCount(0);
  if (!isMobile) await page.screenshot({ path: info.outputPath('explore-results.png'), fullPage: true });
  const results = await new AxeBuilder({ page }).include('main').analyze();
  expect(results.violations.filter(item => item.impact === 'critical' || item.impact === 'serious')).toEqual([]);

  // Swiping and results never changed history, watched state or My List.
  const after = (await profileData(page, profile.id)).values;
  for (const key of ['history', 'watched-episodes', 'watchlist-records']) expect(after[key]).toEqual(before[key]);
});

test('touch swipe uses horizontal intent only', async ({ page }) => {
  await openExplore(page);
  await page.getByRole('button', { name: 'Start exploring' }).click();
  await expect(progress(page)).toHaveText('1 of 20');
  const card = currentCard(page);
  const swipe = async (dx: number, dy: number) => card.evaluate((element, [x, y]) => {
    const rect = element.getBoundingClientRect();
    const base = { pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true, button: 0, buttons: 1 };
    const at = (fx: number, fy: number) => ({ ...base, clientX: rect.left + rect.width / 2 + fx, clientY: rect.top + 160 + fy });
    element.dispatchEvent(new PointerEvent('pointerdown', at(0, 0)));
    for (let step = 1; step <= 6; step++) element.dispatchEvent(new PointerEvent('pointermove', at(x * step / 6, y * step / 6)));
    element.dispatchEvent(new PointerEvent('pointerup', at(x, y)));
  }, [dx, dy]);
  await swipe(10, 180);
  await expect(progress(page)).toHaveText('1 of 20');
  await swipe(-240, 12);
  await expect(progress(page)).toHaveText('2 of 20');
});

test('fewer eligible titles shrink the deck honestly', async ({ page }) => {
  await openExplore(page);
  await page.getByRole('button', { name: /Preferences/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Explore preferences' });
  await dialog.getByRole('group', { name: 'Never show' }).getByRole('button', { name: 'Adventure' }).click();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: '30', exact: true }).click();
  await page.getByRole('button', { name: 'Start exploring' }).click();
  await expect(page.getByText(/titles? match your filters, so this round has/)).toBeVisible();
  await expect(progress(page)).toContainText(/of (?!30)\d+/);
});
