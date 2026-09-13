import { expect, test } from '@playwright/test';
import { fixtureArt, noOverflow } from './helpers';

test.beforeEach(async ({ page }) => {
  await fixtureArt(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('home feature prefers a measured wide backdrop over an unverified image URL', async ({ page }) => {
  const lowBackdrop = 'https://images.example.test/unverified-backdrop.svg';
  const verifiedBackdrop = 'https://images.example.test/verified-backdrop.svg';
  await page.route('**/api/titles?*', async route => {
    const url = new URL(route.request().url());
    const response = await route.fetch();
    const body = await response.json();
    if (url.searchParams.get('scope') === 'anime' && !url.searchParams.has('type') && body.items?.length >= 2) {
      body.items[0] = {
        ...body.items[0],
        name: 'Unverified Feature Fixture',
        synopsis: 'Unverified source image fixture.',
        backdropUrl: lowBackdrop,
        artwork: undefined,
      };
      body.items[1] = {
        ...body.items[1],
        name: 'Measured Feature Fixture',
        synopsis: 'Measured source image fixture.',
        backdropUrl: verifiedBackdrop,
        artwork: {
          backdrop: {
            url: verifiedBackdrop,
            width: 1900,
            height: 400,
            role: 'backdrop',
            source: 'anilist',
            sourceMediaId: 42,
            sourcePageUrl: 'https://anilist.co/anime/42',
            verifiedAt: '2026-09-13T00:00:00.000Z',
            contentSha256: 'a'.repeat(64),
            reuseStatus: 'reference-only',
            identityReview: 'source-id-verified',
            freshness: 'verified',
            lastCheckedAt: '2026-09-13T00:00:00.000Z',
          },
        },
      };
    }
    await route.fulfill({ response, json: body });
  });
  for (const [url, fill] of [[lowBackdrop, '#423d3d'], [verifiedBackdrop, '#746748']] as const) {
    await page.route(url, route => route.fulfill({
      contentType: 'image/svg+xml',
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="1900" height="400"><rect width="1900" height="400" fill="${fill}"/></svg>`,
    }));
  }
  await page.goto('/');
  await expect(page.locator('#featured-title')).toHaveText('Measured Feature Fixture');
  await expect(page.locator('.home-feature .spotlight-art__banner')).toHaveAttribute('src', verifiedBackdrop);
  await expect(page.locator('.home-feature .spotlight-art')).toHaveAttribute('data-banner', 'loaded');
});

test('catalogue keeps source thumbnails dense on wide screens and remains usable at 320px', async ({ page }, info) => {
  const mobile = info.project.name.startsWith('mobile');
  await page.setViewportSize(mobile ? { width: 320, height: 820 } : { width: 1800, height: 1000 });
  await page.goto('/catalogue?scope=anime');
  await expect(page.locator('.title-card').first()).toBeVisible();
  const layout = await page.locator('.title-grid').evaluate(element => {
    const columns = getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean);
    const firstCard = element.querySelector('.title-card')!.getBoundingClientRect();
    return { columns: columns.length, cardWidth: firstCard.width };
  });
  if (mobile) {
    expect(layout.columns).toBe(2);
    expect(layout.cardWidth).toBeGreaterThan(120);
  } else {
    expect(layout.columns).toBe(8);
    expect(layout.cardWidth).toBeLessThanOrEqual(225);
  }
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath(`catalogue-artwork-${mobile ? '320' : 'wide'}.png`), fullPage: true });
});
