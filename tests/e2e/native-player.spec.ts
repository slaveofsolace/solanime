import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fixtureArt, episode, watch, noOverflow } from './helpers';
import { accountFixture } from './account-fixture';
test.beforeEach(async ({ page }) => fixtureArt(page));
test('actual native controls change media state without provider requests or popups', async ({
  page,
  context,
}, info) => {
  const external: string[] = [];
  const popups: string[] = [];
  page.on('popup', (p) => popups.push(p.url()));
  page.on('request', (r) => {
    if (/megaplay|unwanted\.example|advert/.test(r.url())) external.push(r.url());
  });
  await watch(page);
  const initialUrl = page.url(),
    pages = context.pages().length,
    video = page.locator('video');
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.duration)).toBeGreaterThan(2);
  await page.getByRole('button', { name: 'Mute video', exact: true }).click();
  await page.getByRole('button', { name: 'Play video', exact: true }).click();
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0.2);
  await page.getByRole('button', { name: 'Pause video', exact: true }).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await page.getByRole('combobox', { name: 'Playback speed' }).selectOption('1.5');
  expect(await video.evaluate((v: HTMLVideoElement) => v.playbackRate)).toBe(1.5);
  const slider = page.getByRole('slider', { name: 'Seek video' });
  await slider.focus();
  await slider.press('Home');
  await slider.press('ArrowRight');
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeCloseTo(0.1, 1);
  await page.getByRole('button', { name: 'Show remaining time' }).click();
  await expect(page.getByRole('button', { name: 'Show elapsed time' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Captions', exact: true }).selectOption('0');
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.textTracks[0]?.mode))
    .toBe('showing');
  const h = await video.elementHandle();
  // Header controls must not remount or reset an already loaded player.
  await page.getByRole('button', { name: 'Categories', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Categories', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  expect(await h!.evaluate((e) => e.isConnected)).toBe(true);
  await page.getByRole('button', { name: 'Theater mode', exact: true }).click();
  await expect(page.locator('.watch-page')).toHaveClass(/watch-page--theater/);
  expect(await h!.evaluate((e) => e.isConnected)).toBe(true);
  const controls = page.getByRole('group', { name: 'Playback controls' });
  await controls.focus();
  await controls.press('m');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.muted)).toBe(false);
  await controls.press('k');
  await expect(page.getByRole('button', { name: 'Pause video', exact: true })).toBeVisible();
  await controls.press('k');
  await expect(page.getByRole('button', { name: 'Play video', exact: true })).toBeVisible();
  expect(context.pages().length).toBe(pages);
  expect(popups).toEqual([]);
  expect(external).toEqual([]);
  expect(page.url()).toBe(initialUrl);
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('native-controls.png'), fullPage: true });
  const a11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(a11y.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual(
    [],
  );
});
test('legacy iframe responses are refused without loading their document', async ({
  page,
  context,
}, info) => {
  let requested = 0,
    popups = 0;
  page.on('popup', () => popups++);
  await page.route('https://unwanted.example/**', (r) => {
    requested++;
    return r.fulfill({
      contentType: 'text/html',
      body: '<script>window.open("https://unwanted.example/ad");top.location="https://unwanted.example/redirect"</script>',
    });
  });
  await page.route('**/api/providers/*/resolve', (r) =>
    r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        mappingId: r.request().url().split('/').at(-2),
        providerId: 'hd-1',
        status: 'resolved',
        playbackType: 'iframe',
        embedUrl: 'https://unwanted.example/player',
      }),
    }),
  );
  const e = await episode(page);
  await page.goto(`/watch/paper-lantern/${e.id}?language=sub`);
  await expect(
    page.getByRole('heading', { name: 'This source cannot play here', exact: true }),
  ).toBeVisible();
  await page.getByRole('heading', { name: 'This source cannot play here', exact: true }).click();
  await expect(page.locator('iframe,video')).toHaveCount(0);
  expect(requested).toBe(0);
  expect(popups).toBe(0);
  expect(context.pages()).toHaveLength(1);
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('sol-anime:history') ?? '[]')),
  ).toEqual([]);
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('unsupported-source.png'), fullPage: true });
  await page.getByRole('button', { name: 'My List', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fwatch/);
});
test('provider mappings without a documented embed destination remain unavailable despite legacy compatibility settings', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem('sol-anime:preferences', '{"embedMode":"compatible"}'),
  );
  const e = await episode(page, 'fixture-title-2');
  let resolutions = 0;
  page.on('request', (r) => {
    if (r.url().includes('/resolve')) resolutions++;
  });
  await page.goto(`/watch/fixture-title-2/${e.id}?language=sub`);
  await expect(
    page.getByRole('heading', { name: 'Video unavailable', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('The public resolver response no longer contains the documented embed destination.')).toBeVisible();
  await expect(page.locator('iframe,video')).toHaveCount(0);
  expect(resolutions).toBe(1);
  await expect(
    page.getByRole('button', { name: 'Provider compatibility', exact: true }),
  ).toHaveCount(0);
  expect((await page.request.get('/')).headers()['content-security-policy']).not.toContain('frame-src *');
});
test('native ended events update watched state and navigate when autoplay-next is enabled', async ({
  page,
}) => {
  const { profile } = await accountFixture(page, { preferences: { autoplayNext: true } });
  const e = await watch(page);
  const video = page.locator('video');
  await page.getByRole('button', { name: 'Mute video', exact: true }).click();
  const slider = page.getByRole('slider', { name: 'Seek video' });
  await slider.focus();
  await slider.press('Home');
  // Seek via the actual control, but do not first seek to duration: that can itself end media.
  for (let step = 0; step < 30; step++) await slider.press('ArrowRight');
  await page.getByRole('button', { name: 'Play video', exact: true }).click();
  await expect(page).not.toHaveURL(new RegExp(`/watch/paper-lantern/${e.id}\\?`));
  await expect(page.locator('video')).toBeVisible();
  await expect
    .poll(() =>
      page.request.get(`/api/account/profiles/${profile.id}/data`).then(async response => {
        const data = await response.json();
        return data.values['watched-episodes']?.some((item: { episodeId: string }) => item.episodeId === e.id) ?? false;
      }),
    )
    .toBe(true);
});
test('failed media load offers a real retry with no iframe fallback', async ({ page }) => {
  let failures = 1;
  await page.route('**/__fixture/motion.mp4', (r) =>
    failures-- > 0 ? r.fulfill({ status: 404, body: 'Missing' }) : r.continue(),
  );
  const e = await episode(page);
  await page.goto(`/watch/paper-lantern/${e.id}?language=sub`);
  await expect(page.getByRole('heading', { name: 'Video unavailable', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect
    .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThan(1);
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('compatible native source switching carries the current version position', async ({ page }) => {
  const e = await watch(page);
  const source = page.getByRole('combobox', { name: 'Playback source' });
  const options = await source.locator('option:not([disabled])').evaluateAll(options =>
    options.map(option => (option as HTMLOptionElement).value),
  );
  expect(options.length).toBeGreaterThan(1);
  const video = page.locator('video');
  await video.evaluate((element: HTMLVideoElement) => {
    element.currentTime = Math.min(0.75, element.duration / 2);
    element.dispatchEvent(new Event('timeupdate'));
  });
  const carried = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
  let failures = 1;
  await page.route('**/api/providers/*/resolve', route =>
    failures-- > 0
      ? route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: '{"error":{"code":"UNAVAILABLE","message":"Transient source failure"}}',
        })
      : route.continue(),
  );
  await source.selectOption(options[1]);
  await expect(page.getByText('Transient source failure')).toBeVisible();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('video')).toBeVisible();
  await expect
    .poll(() => page.locator('video').evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeCloseTo(carried, 1);
  await expect(page.locator('iframe')).toHaveCount(0);
});

for (const format of ['hls', 'dash'] as const)
  test(`native ${format} renders moving media without a webpage player`, async ({ page }) => {
    const e = await episode(page);
    await page.route('**/api/providers/*/resolve', (r) =>
      r.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          mappingId: r.request().url().split('/').at(-2),
          providerId: 'hd-1',
          delivery: 'native',
          playbackType: format,
          status: 'resolved',
          url: `/__fixture/${format}/index.${format === 'hls' ? 'm3u8' : 'mpd'}`,
        }),
      }),
    );
    await page.goto(`/watch/paper-lantern/${e.id}?language=sub`);
    const video = page.locator('video');
    const playbackAvailable = await page.evaluate((kind) => {
      const probe = document.createElement('video');
      return kind === 'hls'
        ? Boolean(probe.canPlayType('application/vnd.apple.mpegurl')) ||
            typeof MediaSource !== 'undefined'
        : typeof MediaSource !== 'undefined';
    }, format);
    if (!playbackAvailable) {
      await expect(
        page.getByRole('heading', { name: 'Video unavailable', exact: true }),
      ).toBeVisible();
      await expect(page.locator('iframe')).toHaveCount(0);
      return;
    }
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 20000 })
      .toBeGreaterThanOrEqual(1);
    await page.getByRole('button', { name: 'Mute video', exact: true }).click();
    await page.getByRole('button', { name: 'Play video', exact: true }).click();
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeGreaterThan(0.2);
    await expect(page.locator('iframe')).toHaveCount(0);
  });
