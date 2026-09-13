import { expect, test, type Page } from '@playwright/test';
import { fixtureArt, noOverflow } from './helpers';

test.beforeEach(async ({ page }) => fixtureArt(page));

async function fixtureBanner(page: Page, bannerUrl: string) {
  await page.route('**/api/titles?*', async route => {
    const response = await route.fetch();
    const body = await response.json();
    if (body.items?.length && !new URL(route.request().url()).searchParams.has('type')) {
      body.items[0] = { ...body.items[0], backdropUrl: bannerUrl };
    }
    await route.fulfill({ response, json: body });
  });
  await page.route('**/api/titles/paper-lantern', async route => {
    const response = await route.fetch();
    const body = await response.json();
    body.title = { ...body.title, backdropUrl: bannerUrl };
    await route.fulfill({ response, json: body });
  });
}

test('home uses the cinematic reference scale with an uncropped fallback poster', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('#featured-title')).toBeVisible();
  const image = page.locator('.home-feature .spotlight-art__poster img');
  await expect(image).toHaveCSS('object-fit', 'contain');
  const measurements = await page.evaluate(() => {
    const hero = document.querySelector('.home-feature')!.getBoundingClientRect();
    const copy = document.querySelector('.home-feature__copy')!.getBoundingClientRect();
    const poster = document.querySelector('.spotlight-art__poster')!.getBoundingClientRect();
    const rail = document.querySelector('.home-rail')!.getBoundingClientRect();
    return {
      heroX: hero.x, heroWidth: hero.width, viewport: innerWidth,
      copyX: copy.x, copyY: copy.y, copyRight: copy.right,
      posterX: poster.x, posterBottom: poster.bottom, posterWidth: poster.width,
      fontSize: parseFloat(getComputedStyle(document.querySelector('#featured-title')!).fontSize),
      railY: rail.y,
    };
  });
  expect(measurements.heroX).toBeCloseTo(0, 0);
  expect(measurements.heroWidth).toBeCloseTo(measurements.viewport, 0);
  expect(measurements.fontSize).toBeLessThanOrEqual(64);
  expect(measurements.posterWidth).toBeLessThan(measurements.viewport * .5);
  if (info.project.name.startsWith('desktop')) {
    expect(measurements.copyX).toBeCloseTo(47.52, 0);
    expect(measurements.copyRight).toBeLessThan(measurements.posterX);
    expect(measurements.railY).toBeGreaterThan(780);
    expect(measurements.railY).toBeLessThan(850);
  } else {
    expect(measurements.copyY).toBeGreaterThanOrEqual(measurements.posterBottom);
  }
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('home-composition.png'), fullPage: true });
});

test('a loaded wide banner fills the home and title artwork field without a second poster', async ({ page }, info) => {
  const bannerUrl = 'https://images.example.test/ratio-check.svg';
  await page.route(bannerUrl, route => route.fulfill({ contentType: 'image/svg+xml', body:
    '<svg xmlns="http://www.w3.org/2000/svg" width="1900" height="400"><rect width="1900" height="400" fill="#74746b"/></svg>',
  }));
  await fixtureBanner(page, bannerUrl);
  for (const surface of [
    { route: '/', selector: '.home-feature', action: 'View episodes', name: 'home' },
    { route: '/title/paper-lantern', selector: '.title-hero', action: 'Open first episode', name: 'title' },
  ]) {
    await page.goto(surface.route);
    const art = page.locator(`${surface.selector} .spotlight-art`);
    const banner = art.locator('.spotlight-art__banner');
    await expect(art).toHaveAttribute('data-banner', 'loaded');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveCSS('object-fit', 'cover');
    await expect(art.locator('.spotlight-art__poster')).toBeHidden();
    const measurements = await banner.evaluate((image: HTMLImageElement) => {
      const imageBox = image.getBoundingClientRect();
      const field = image.parentElement!.getBoundingClientRect();
      return { sourceRatio: image.naturalWidth / image.naturalHeight, imageWidth: imageBox.width, imageHeight: imageBox.height, fieldWidth: field.width, fieldHeight: field.height };
    });
    expect(measurements.sourceRatio).toBeCloseTo(4.75, 2);
    expect(measurements.imageWidth).toBeCloseTo(measurements.fieldWidth, 1);
    expect(measurements.imageHeight).toBeCloseTo(measurements.fieldHeight, 1);
    expect(measurements.imageWidth / measurements.imageHeight).toBeLessThan(measurements.sourceRatio);
    await expect(page.getByRole('link', { name: surface.action, exact: true })).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath(`${surface.name}-banner-loaded.png`), fullPage: true });
    if (surface.name === 'home') {
      await page.getByRole('button', { name: 'Next featured title', exact: true }).click();
      await expect(art).toHaveAttribute('data-banner', 'none');
      await expect(art.locator('.spotlight-art__poster')).toBeVisible();
    }
  }
});

test('a delayed then failed banner keeps the poster and stable home geometry', async ({ page }) => {
  // This isolates fallback layout from the independently tested entrance animation.
  // Set the real OS preference before navigation rather than injecting test-only CSS.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const bannerUrl = 'https://images.example.test/delayed-banner';
  let failBanner!: () => void;
  const delayed = new Promise<void>(resolve => { failBanner = resolve; });
  await page.route(bannerUrl, async route => {
    await delayed;
    await route.fulfill({ status: 503, body: '' });
  });
  await fixtureBanner(page, bannerUrl);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const art = page.locator('.home-feature .spotlight-art');
  const poster = art.locator('.spotlight-art__poster');
  await expect(art).toHaveAttribute('data-banner', 'loading');
  await expect(poster).toBeVisible();
  await expect(art.locator('.spotlight-art__banner')).toBeHidden();
  await expect.poll(() => poster.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('.sol-brand-readiness')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('.home-page')).toHaveCSS('transform', 'none');
  await expect(page.locator('.home-feature__copy')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.home-feature__copy')).toHaveCSS('transform', 'none');
  const positions = () => page.evaluate(() => ['.home-feature', '.home-feature__copy', '.home-rail'].map(selector => {
    const { x, y, width, height } = document.querySelector(selector)!.getBoundingClientRect();
    return { x, y, width, height };
  }));
  const before = await positions();
  const featuredTitle = await page.locator('#featured-title').innerText();
  const openEpisodes = page.getByRole('link', { name: 'View episodes', exact: true });
  const destination = await openEpisodes.getAttribute('href');
  expect(destination).toMatch(/^\/title\/[^/?#]+$/);
  failBanner();
  await expect(art).toHaveAttribute('data-banner', 'failed');
  await expect(art.locator('.spotlight-art__banner')).toHaveCount(0);
  await expect(poster).toBeVisible();
  const after = await positions();
  for (const [index, rect] of after.entries()) {
    for (const coordinate of ['x', 'y', 'width', 'height'] as const) {
      // Prior traces contained at most 0.000061px of DOMRect numeric noise.
      // A 0.001px bound preserves the no-shift contract without accepting visible drift.
      expect(Math.abs(rect[coordinate] - before[index]![coordinate]), `rectangle ${index} ${coordinate}`).toBeLessThanOrEqual(0.001);
    }
  }
  await expect(openEpisodes).toBeVisible();
  await expect(openEpisodes).toHaveAttribute('href', destination!);
  await noOverflow(page);
  const destinationUrl = new URL(destination!, page.url()).href;
  await openEpisodes.click();
  await expect(page).toHaveURL(destinationUrl);
  await expect(page.locator('#title-name')).toHaveText(featuredTitle);
});

test('mobile title actions do not shift when the banner arrives', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 820 });
  const bannerUrl = 'https://images.example.test/mobile-delayed-banner';
  let deliverBanner!: () => void;
  const delayed = new Promise<void>(resolve => { deliverBanner = resolve; });
  await page.route(bannerUrl, async route => {
    await delayed;
    await route.fulfill({ contentType: 'image/svg+xml', body:
      '<svg xmlns="http://www.w3.org/2000/svg" width="1900" height="400"><rect width="1900" height="400" fill="#74746b"/></svg>',
    });
  });
  await fixtureBanner(page, bannerUrl);
  await page.goto('/title/paper-lantern', { waitUntil: 'domcontentloaded' });
  const art = page.locator('.title-hero__art');
  await expect(art).toHaveAttribute('data-banner', 'loading');
  await page.evaluate(() => document.fonts.ready);
  const measure = () => page.evaluate(() => ['.title-hero__actions', '.title-facts', '.episode-section'].map(selector => {
    const { x, y, width, height } = document.querySelector(selector)!.getBoundingClientRect();
    return { x, y, width, height };
  }));
  const before = await measure();
  const poster = await art.locator('.spotlight-art__poster').boundingBox();
  expect(poster!.y + poster!.height).toBeLessThanOrEqual(before[0]!.y);
  deliverBanner();
  await expect(art).toHaveAttribute('data-banner', 'loaded');
  await expect(art.locator('.spotlight-art__poster')).toBeHidden();
  const after = await measure();
  for (let index = 0; index < before.length; index++) {
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(Math.abs(after[index]![key] - before[index]![key])).toBeLessThanOrEqual(.001);
    }
  }
  await expect(page.getByRole('link', { name: 'Open first episode', exact: true })).toBeVisible();
  await noOverflow(page);
});

test('title keeps episode navigation close and full information available on demand', async ({ page }, info) => {
  await page.goto('/title/paper-lantern');
  await expect(page.locator('#title-name')).toBeVisible();
  const hero = await page.locator('.title-hero').boundingBox();
  // The approved reference gives artwork most of the viewport. Episodes must
  // begin immediately after it, rather than restoring the rejected short hero.
  expect(hero!.height).toBeGreaterThanOrEqual(600);
  expect(hero!.height).toBeLessThan(850);
  const episodes = await page.getByRole('heading', { name: 'Episodes', exact: true }).boundingBox();
  expect(episodes!.y - (hero!.y + hero!.height)).toBeLessThan(50);
  await expect(page.locator('.title-about')).not.toHaveAttribute('open');
  await page.locator('.title-about summary').click();
  await expect(page.locator('.title-about')).toHaveAttribute('open');
  await expect(page.locator('.title-about__body')).toBeVisible();
  await page.locator('.title-about summary').click();
  const openEpisode = page.getByRole('link', { name: /Open first episode/ });
  const destination = await openEpisode.getAttribute('href');
  expect(destination).toMatch(/^\/watch\/paper-lantern\/[^?]+\?language=sub$/);
  await openEpisode.click();
  await expect(page).toHaveURL(new RegExp('/watch/paper-lantern/'));
  await expect(page.locator('video')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#title-name')).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('title-composition.png'), fullPage: true });
});

test('artwork failure preserves the real title, episode inventory and navigation', async ({ page }) => {
  await page.route('https://images.example.test/unavailable-*', route => route.fulfill({ status: 404, body: '' }));
  await page.route('**/api/titles/paper-lantern', async route => {
    const response = await route.fetch();
    const body = await response.json();
    body.title = { ...body.title, imageUrl: 'https://images.example.test/unavailable-original', posterUrl: 'https://images.example.test/unavailable-poster', backdropUrl: 'https://images.example.test/unavailable-banner' };
    await route.fulfill({ response, json: body });
  });
  await page.goto('/title/paper-lantern');
  await expect(page.locator('#title-name')).toHaveText('Paper Lantern');
  await expect(page.locator('.title-hero .spotlight-art')).toHaveAttribute('data-banner', 'failed');
  await expect(page.locator('.title-hero .spotlight-art__poster')).toBeVisible();
  await expect(page.locator('.title-hero .cover-fallback')).toBeVisible();
  await expect(page.locator('.title-hero .spotlight-art__banner')).toHaveCount(0);
  await expect(page.locator('.episode-grid > li')).toHaveCount(3);
  await expect(page.getByRole('link', { name: /Open first episode/ })).toBeVisible();
  await noOverflow(page);
});

test('a failed title request can be retried without refreshing the route', async ({ page }) => {
  let unavailable = true;
  await page.route('**/api/titles/paper-lantern', async route => {
    if (unavailable) {
      await route.fulfill({ status: 503, json: { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Title service temporarily unavailable.' } } });
    } else {
      await route.continue();
    }
  });
  await page.goto('/title/paper-lantern');
  await expect(page.getByRole('heading', { name: 'Title unavailable', exact: true })).toBeVisible();
  await expect(page.getByText('Title service temporarily unavailable.', { exact: true })).toBeVisible();
  unavailable = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('#title-name')).toHaveText('Paper Lantern');
  await expect(page.locator('.episode-grid > li')).toHaveCount(3);
  await expect(page).toHaveURL(/\/title\/paper-lantern$/);
  await noOverflow(page);
});

test('320px home and title preserve readable controls in both themes', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 820 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const theme of ['Dark', 'Light']) {
    await page.goto('/');
    await expect(page.locator('#featured-title')).toBeVisible();
    await page.getByRole('button', { name: 'Customize appearance' }).click();
    await page.getByRole('dialog').getByRole('button', { name: theme, exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('link', { name: 'View episodes', exact: true })).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath(`home-320-${theme.toLowerCase()}.png`), fullPage: true });
    await page.goto('/title/paper-lantern');
    await expect(page.locator('#title-name')).toBeVisible();
    await expect(page.getByRole('link', { name: /Open first episode/ })).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath(`title-320-${theme.toLowerCase()}.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
});
