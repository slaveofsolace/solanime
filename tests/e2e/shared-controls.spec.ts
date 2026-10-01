import { expect, test, type Locator, type Page } from '@playwright/test';
import { accountFixture } from './account-fixture';
import { fixtureArt, noOverflow, watch } from './helpers';

const LONG_EPISODE_LABEL = 'Episode 1 — The remarkably long journey to the distant mountain village';

async function readableSelection(field: Locator, expected: string) {
  await expect(field).toBeVisible();
  await expect(field.locator('option:checked')).toHaveText(expected);
  const geometry = await field.evaluate(async element => {
    await document.fonts.ready;
    const style = getComputedStyle(element);
    if (!(element instanceof HTMLSelectElement)) throw new Error("Expected a native select.");
    const select = element;
    const box = select.getBoundingClientRect();
    const context = document.createElement('canvas').getContext('2d');
    if (!context) throw new Error('Text measurement is unavailable.');
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    return {
      available: select.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      text: context.measureText(select.selectedOptions[0]?.textContent?.trim() ?? '').width,
      height: box.height,
      left: box.left,
      right: box.right,
      viewport: innerWidth,
    };
  });
  expect(geometry.text, `${expected} must fit the closed field`).toBeLessThanOrEqual(geometry.available + 1);
  expect(geometry.height).toBeGreaterThanOrEqual(44);
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewport + 1);
}

async function longEpisodeFixture(page: Page) {
  await page.route('**/api/titles/paper-lantern', async route => {
    const response = await route.fetch();
    const detail = await response.json();
    detail.episodes = detail.episodes.map((episode: Record<string, unknown>, index: number) =>
      index === 0 ? { ...episode, label: LONG_EPISODE_LABEL } : episode,
    );
    await route.fulfill({ response, json: detail });
  });
}

test.beforeEach(async ({ page }, info) => {
  await fixtureArt(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Mobile projects exercise the signed host's styling; these remain browser fixtures.
  if (info.project.name.startsWith('mobile')) await page.addInitScript(() => {
    const mark = () => document.documentElement?.classList.add('solanime-native-ios');
    mark();
    document.addEventListener('DOMContentLoaded', mark, { once: true });
  });
});

test('preferred version keeps every ordinary option readable at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await accountFixture(page);
  await page.goto('/settings?section=playback');
  const field = page.getByRole('combobox', { name: 'Preferred version', exact: true });
  await field.selectOption('raw');
  await readableSelection(field, 'No subtitles');
  await noOverflow(page);
});

test('Discover shows its selected sort fully at narrow phone widths', async ({ page }) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/catalogue');
    const sort = page.getByRole('combobox', { name: 'Sort titles', exact: true });
    await expect(sort).toBeVisible();
    const filters = page.locator('.filter-disclosure summary');
    await filters.click();
    const triggerBox = await filters.boundingBox();
    const panelBox = await page.locator('.filter-grid').boundingBox();
    // The popup belongs directly beneath Filters even when Sort wraps below it.
    expect(panelBox!.y - triggerBox!.y - triggerBox!.height).toBeGreaterThanOrEqual(0);
    expect(panelBox!.y - triggerBox!.y - triggerBox!.height).toBeLessThanOrEqual(12);
    await page.getByRole('combobox', { name: 'Genre', exact: true }).selectOption({ index: 1 });
    await readableSelection(sort, 'Recently updated');
    await noOverflow(page);
  }
});

test('a long episode does not squeeze source and language at tablet width', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await longEpisodeFixture(page);
  await watch(page);
  await readableSelection(page.getByRole('combobox', { name: 'Playback source', exact: true }), 'HD-1');
  await readableSelection(page.getByRole('combobox', { name: 'Episode language', exact: true }), 'SUB');
  await noOverflow(page);
});

test('a long native episode option does not widen the phone document', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await longEpisodeFixture(page);
  await watch(page);
  const episode = page.getByRole('combobox', { name: 'Choose episode', exact: true });
  await expect(episode.locator('option:checked')).toHaveText(LONG_EPISODE_LABEL);
  // WebKit can keep the field's box narrow while its option widens scrollWidth.
  await noOverflow(page);
  const next = await episode.locator('option').nth(1).evaluate(option => ({ value: option.getAttribute('value')!, label: option.textContent! }));
  await episode.selectOption(next.value);
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/watch/paper-lantern/${next.value}`);
  await expect(episode.locator('option:checked')).toHaveText(next.label);
  await noOverflow(page);
});
