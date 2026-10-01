import { expect, test, type Page } from '@playwright/test';
import { fixtureArt, noOverflow } from './helpers';
import { accountFixture } from './account-fixture';

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

test('home uses cinematic artwork with an uncropped desktop poster and full-bleed mobile art', async ({ page }, info) => {
  if (info.project.name.startsWith('mobile')) await page.setViewportSize({ width: 393, height: 852 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('#featured-title')).toBeVisible();
  const image = page.locator('.home-feature .spotlight-art__poster img');
  const mobile = info.project.name.startsWith('mobile');
  await expect(image).toHaveCSS('object-fit', mobile ? 'cover' : 'contain');
  const measurements = await page.evaluate(() => {
    const hero = document.querySelector('.home-feature')!.getBoundingClientRect();
    const copy = document.querySelector('.home-feature__copy')!.getBoundingClientRect();
    const poster = document.querySelector('.spotlight-art__poster > img')!.getBoundingClientRect();
    const artwork = document.querySelector('.home-feature .spotlight-art')!.getBoundingClientRect();
    const rail = document.querySelector('.home-rail')!.getBoundingClientRect();
    const railTrack = document.querySelector('.home-rail .rail-track')!.getBoundingClientRect();
    const visibleRailCards = [...document.querySelectorAll('.home-rail .title-card')]
      .map(element => element.getBoundingClientRect())
      .filter(card => card.right > railTrack.left && card.left < railTrack.right).length;
    const firstCard = document.querySelector('.home-rail .title-card')!.getBoundingClientRect();
    const firstCardCopy = document.querySelector('.home-rail .title-card__copy')!.getBoundingClientRect();
    return {
      heroX: hero.x, heroWidth: hero.width, viewport: innerWidth,
      copyX: copy.x, copyY: copy.y, copyRight: copy.right,
      posterX: poster.x, posterBottom: poster.bottom, posterWidth: poster.width,
      artWidth: artwork.width, artHeight: artwork.height,
      fontSize: parseFloat(getComputedStyle(document.querySelector('#featured-title')!).fontSize),
      railY: rail.y,
      visibleRailCards,
      cardTop: firstCard.top,
      cardBottom: firstCard.bottom,
      cardCopyTop: firstCardCopy.top,
      cardCopyBottom: firstCardCopy.bottom,
    };
  });
  expect(measurements.heroX).toBeCloseTo(0, 0);
  expect(measurements.heroWidth).toBeCloseTo(measurements.viewport, 0);
  expect(measurements.fontSize).toBeLessThanOrEqual(64);
  if (info.project.name.startsWith('desktop')) {
    expect(measurements.posterWidth).toBeLessThan(measurements.viewport * .5);
    expect(measurements.copyX).toBeCloseTo(measurements.viewport * .046, 0);
    expect(measurements.copyRight).toBeLessThan(measurements.posterX);
    // The first content row should read as part of the feature composition and
    // remain visible in the first viewport, rather than sitting below a tall
    // marketing-style hero.
    expect(measurements.railY).toBeGreaterThan(550);
    expect(measurements.railY).toBeLessThan(690);
    expect(measurements.visibleRailCards).toBeGreaterThanOrEqual(6);
    const quickLook = page.locator('.home-rail .card-info').first();
    await page.locator('.home-rail .title-card__art').first().focus();
    await quickLook.focus();
    await expect(quickLook).toHaveCSS('width', '44px');
    await expect(quickLook).toHaveAccessibleName(/^Quick look at /);
  } else {
    expect(measurements.artWidth).toBeCloseTo(measurements.viewport, 0);
    expect(measurements.artHeight).toBeGreaterThan(500);
    expect(measurements.posterWidth).toBeCloseTo(measurements.viewport, 0);
    expect(measurements.copyY).toBeLessThan(measurements.posterBottom);
    expect(measurements.visibleRailCards).toBeGreaterThanOrEqual(2);
    await expect(page.locator('.wordmark .sol-brand--emblem')).toBeVisible();
    await expect(page.locator('.wordmark .sol-brand--compact')).toBeHidden();
  }
  expect(measurements.cardCopyTop).toBeGreaterThanOrEqual(measurements.cardTop);
  expect(measurements.cardCopyBottom).toBeLessThanOrEqual(measurements.cardBottom + .01);
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('home-composition.png'), fullPage: true });
});

test('a short panoramic banner keeps its aspect ratio alongside a sharp poster', async ({ page }, info) => {
  const bannerUrl = 'https://images.example.test/ratio-check.svg';
  await page.route(bannerUrl, route => route.fulfill({ contentType: 'image/svg+xml', body:
    '<svg xmlns="http://www.w3.org/2000/svg" width="1900" height="400"><rect width="1900" height="400" fill="#74746b"/></svg>',
  }));
  await fixtureBanner(page, bannerUrl);
  for (const surface of [
    { route: '/', selector: '.home-feature', action: 'Start watching', name: 'home' },
    { route: '/title/paper-lantern', selector: '.title-hero', action: 'Start watching: Episode 1', name: 'title' },
  ]) {
    await page.goto(surface.route);
    const art = page.locator(`${surface.selector} .spotlight-art`);
    const banner = art.locator('.spotlight-art__banner');
    await expect(art).toHaveAttribute('data-banner', 'loaded');
    const narrow = (page.viewportSize()?.width ?? 0) <= 600;
    if (narrow) {
      await expect(art).toHaveAttribute('data-mobile-art', 'poster');
      await expect(banner).toBeHidden();
      if (surface.name === 'home') {
        await expect(art.locator('.spotlight-art__poster')).toBeVisible();
        await expect(art.locator('.spotlight-art__poster img')).toHaveCSS('object-fit', 'cover');
        await expect(page.locator('.home-feature__mobile-art')).toBeHidden();
      } else {
        await expect(art.locator('.spotlight-art__poster img')).toBeVisible();
        await expect(page.locator('.title-hero__mobile-art')).toBeHidden();
      }
    } else {
      await expect(banner).toBeVisible();
      await expect(art.locator('.spotlight-art__poster')).toBeVisible();
      await expect(banner).toHaveCSS('object-fit', 'contain');
    }
    const measurements = await banner.evaluate((image: HTMLImageElement) => {
      const imageBox = image.getBoundingClientRect();
      const field = image.parentElement!.getBoundingClientRect();
      return { sourceRatio: image.naturalWidth / image.naturalHeight, imageWidth: imageBox.width, imageHeight: imageBox.height, fieldWidth: field.width, fieldHeight: field.height };
    });
    expect(measurements.sourceRatio).toBeCloseTo(4.75, 2);
    if (!narrow) {
      expect(measurements.imageWidth).toBeCloseTo(measurements.fieldWidth, 1);
      expect(measurements.imageWidth / measurements.imageHeight).toBeCloseTo(measurements.sourceRatio, 2);
      expect(measurements.imageHeight).toBeLessThan(measurements.fieldHeight);
    } else {
      // A hidden banner can retain its measured box while the actual poster
      // remains the visible art surface.
      await expect(banner).toBeHidden();
      if (surface.name === 'home') {
        const posterWidth = await art.locator('.spotlight-art__poster').evaluate(element => element.getBoundingClientRect().width);
        expect(posterWidth).toBeCloseTo(measurements.fieldWidth, 0);
      } else {
        await expect(art.locator('.spotlight-art__poster img')).toBeVisible();
      }
    }
    await expect(page.getByRole('link', { name: surface.action, exact: true })).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath(`${surface.name}-banner-loaded.png`), fullPage: true });
    if (surface.name === 'home')
      await expect(page.getByRole('button', { name: 'Next featured title', exact: true })).toHaveCount(0);
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
  const narrow = (page.viewportSize()?.width ?? 0) <= 600;
  const visiblePoster = poster;
  await expect(art).toHaveAttribute('data-banner', 'loading');
  await expect(visiblePoster).toBeVisible();
  if (narrow) {
    const width = await visiblePoster.evaluate(element => element.getBoundingClientRect().width);
    expect(width).toBeCloseTo(page.viewportSize()!.width, 0);
    await expect(page.locator('.home-feature__mobile-art')).toBeHidden();
  }
  await expect(art.locator('.spotlight-art__banner')).toBeHidden();
  await expect.poll(() => visiblePoster.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
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
  const openEpisodes = page.getByRole('link', { name: 'Start watching', exact: true });
  await expect(openEpisodes).toBeVisible();
  const destination = await openEpisodes.getAttribute('href');
  expect(destination).toMatch(/^\/watch\/[^/?#]+\/[^/?#]+\?language=sub$/);
  failBanner();
  await expect(art).toHaveAttribute('data-banner', 'failed');
  await expect(art.locator('.spotlight-art__banner')).toHaveCount(0);
  await expect(visiblePoster).toBeVisible();
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
  await expect(page.locator('.watch-heading h1')).toHaveText(featuredTitle);
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
  const poster = await art.locator('.spotlight-art__poster img').boundingBox();
  expect(poster!.width).toBeCloseTo(320, 0);
  expect(before[0]!.y).toBeGreaterThan(poster!.y);
  deliverBanner();
  await expect(art).toHaveAttribute('data-banner', 'loaded');
  await expect(art).toHaveAttribute('data-mobile-art', 'poster');
  await expect(art.locator('.spotlight-art__poster img')).toBeVisible();
  await expect(art.locator('.spotlight-art__banner')).toBeHidden();
  const after = await measure();
  for (let index = 0; index < before.length; index++) {
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(Math.abs(after[index]![key] - before[index]![key])).toBeLessThanOrEqual(.001);
    }
  }
  await expect(page.getByRole('link', { name: /Start watching: Episode 1/ })).toBeVisible();
  await noOverflow(page);
});

test('title keeps episode navigation close and full information available on demand', async ({ page }, info) => {
  await page.goto('/title/paper-lantern');
  await expect(page.locator('#title-name')).toBeVisible();
  const hero = await page.locator('.title-hero').boundingBox();
  // The artwork-led phone hero gives the key image room while keeping episodes
  // immediately after the detail and actions.
  if (info.project.name.startsWith('mobile')) {
    expect(hero!.height).toBeGreaterThanOrEqual(600);
    expect(hero!.height).toBeLessThan(1050);
  } else {
    expect(hero!.height).toBeGreaterThanOrEqual(380);
    expect(hero!.height).toBeLessThan(460);
  }
  const episodes = await page.getByRole('heading', { name: 'Episodes', exact: true }).boundingBox();
  expect(episodes!.y - (hero!.y + hero!.height)).toBeLessThan(50);
  await expect(page.locator('.title-about')).not.toHaveAttribute('open');
  await page.locator('.title-about summary').click();
  await expect(page.locator('.title-about')).toHaveAttribute('open');
  await expect(page.locator('.title-about__body')).toBeVisible();
  await page.locator('.title-about summary').click();
  const openEpisode = page.getByRole('link', { name: /Start watching: Episode 1/ });
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
  const visiblePoster = page.locator('.title-hero .spotlight-art__poster');
  await expect(visiblePoster).toBeVisible();
  await expect(visiblePoster.locator('.cover-fallback')).toBeVisible();
  await expect(page.locator('.title-hero .spotlight-art__banner')).toHaveCount(0);
  await expect(page.locator('.episode-grid > li')).toHaveCount(3);
  await expect(page.getByRole('link', { name: /Start watching: Episode 1/ })).toBeVisible();
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
  const boot = page.locator('.sol-brand-readiness');
  await expect(boot.getByText('Title service temporarily unavailable.', { exact: true })).toBeVisible();
  unavailable = false;
  await boot.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('#title-name')).toHaveText('Paper Lantern');
  await expect(page.locator('.episode-grid > li')).toHaveCount(3);
  await expect(page).toHaveURL(/\/title\/paper-lantern$/);
  await noOverflow(page);
});

for (const theme of ['Dark', 'Light']) {
  test(`320px home and title preserve readable controls in ${theme.toLowerCase()} theme`, async ({ page }, info) => {
    await page.setViewportSize({ width: 320, height: 820 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await accountFixture(page);
    await page.goto('/settings?section=appearance');
    await page.locator('#appearance').getByRole('button', { name: theme, exact: true }).click();
    await page.getByRole('link', { name: 'Solanime home', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Start watching', exact: true })).toBeVisible();
    const viewportWidth = await page.evaluate(() => innerWidth);
    const navLinks = page.locator('.native-tab-bar > a:visible');
    await expect(page.locator('.main-nav')).toBeHidden();
    await expect(page.locator('.native-tab-bar').getByRole('link', { name: 'Library' })).toBeVisible();
    await expect(navLinks).toHaveCount(4);
    for (const link of await navLinks.all()) {
      const bounds = await link.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewportWidth);
    }
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath(`home-320-${theme.toLowerCase()}.png`), fullPage: true });
    await page.goto('/title/paper-lantern');
    await expect(page.locator('#title-name')).toBeVisible();
    await expect(page.getByRole('link', { name: /Start watching: Episode 1/ })).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath(`title-320-${theme.toLowerCase()}.png`), fullPage: true });
    expect(errors).toEqual([]);
  });
}
