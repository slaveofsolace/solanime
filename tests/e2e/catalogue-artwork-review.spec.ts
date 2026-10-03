import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { noOverflow } from './helpers';

// Opt-in network-independent render of a separately collected public artwork
// snapshot. Synthetic episode routes are never used to claim live catalogue data.
const folder = process.env.SOLANIME_REVIEW_ARTWORK;
type ReviewAsset = { filename: string; source: string; contentType: string; sha256: string };
type ReviewRecord = {
  id: number;
  title: { english: string | null; romaji: string };
  format: string;
  startDate: { year: number };
  description: string;
  genres: string[];
  assets: { poster: ReviewAsset; backdrop?: ReviewAsset };
};

function assetMime(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

async function visibleArtwork(page: Page) {
  return page.locator('img').evaluateAll(images => {
    return images.filter((image): image is HTMLImageElement => {
      if (!(image instanceof HTMLImageElement)) return false;
      if (new URL(image.currentSrc || image.src, location.href).hostname !== 's4.anilist.co') return false;
      const rect = image.getBoundingClientRect();
      let left = Math.max(0, rect.left), top = Math.max(0, rect.top);
      let right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom);
      for (let element: Element | null = image; element; element = element.parentElement) {
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return false;
        if (element !== image) {
          const clip = element.getBoundingClientRect();
          if (/(hidden|clip|scroll|auto)/.test(style.overflowX)) {
            left = Math.max(left, clip.left); right = Math.min(right, clip.right);
          }
          if (/(hidden|clip|scroll|auto)/.test(style.overflowY)) {
            top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom);
          }
        }
      }
      return right > left && bottom > top;
    }).map(image => ({ source: image.currentSrc || image.src, decoded: image.complete && image.naturalWidth > 0 && image.naturalHeight > 0 }));
  });
}

async function expectVisibleArtwork(page: Page) {
  // Offscreen lazy images are not expected to load until reached. Conversely,
  // an empty selection must never be accepted as evidence of rendered artwork.
  await expect.poll(async () => {
    const images = await visibleArtwork(page);
    return { nonempty: images.length > 0, undecoded: images.filter(image => !image.decoded).map(image => image.source) };
  }).toEqual({ nonempty: true, undecoded: [] });
}

for (const surface of ['home', 'discover'] as const) {
  test(`public artwork ${surface} review with public anime identities`, async ({ page, isMobile }, info) => {
    test.skip(!folder, 'Optional public artwork snapshot not requested in this run.');
    const manifest = JSON.parse(readFileSync(join(folder!, 'manifest.json'), 'utf8'));
    expect(manifest.error, 'The explicitly requested artwork snapshot must be available.').toBeUndefined();
    expect(Array.isArray(manifest.items), 'Artwork manifest must contain a records array.').toBe(true);
    expect(manifest.items.length, 'Artwork acceptance requires a nonempty public snapshot.').toBeGreaterThan(0);
    const records = manifest.items as ReviewRecord[];
    const assets = new Map<string, { contentType: string; body: Buffer }>();
    for (const record of records) {
      expect(Number.isSafeInteger(record.id) && record.id > 0).toBe(true);
      expect(record.assets.poster, `Record ${record.id} requires a poster.`).toBeTruthy();
      for (const [kind, asset] of Object.entries(record.assets)) {
        expect(['poster', 'backdrop']).toContain(kind);
        expect(asset.filename).toBe(`${record.id}-${kind}.image`);
        const url = new URL(asset.source);
        expect([url.protocol, url.hostname, url.username, url.password]).toEqual(['https:', 's4.anilist.co', '', '']);
        const body = readFileSync(join(folder!, asset.filename));
        expect(body.byteLength).toBeGreaterThan(0);
        expect(body.byteLength).toBeLessThanOrEqual(8 * 1024 * 1024);
        expect(createHash('sha256').update(body).digest('hex'), asset.filename).toBe(asset.sha256);
        expect(assetMime(body), `${asset.filename} must match its declared image type.`).toBe(asset.contentType);
        expect(assetMime(body)).not.toBeNull();
        assets.set(asset.source, { contentType: asset.contentType, body });
      }
    }

    await page.emulateMedia({ reducedMotion: 'reduce' });
    if (isMobile) await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('solanime-native-ios')));
    for (const [source, asset] of assets) await page.route(source, route => route.fulfill(asset));
    const summary = (record: ReviewRecord) => ({
      id: String(record.id), slug: `visual-review-${record.id}`,
      source: 'anilist-public-review', sourceId: String(record.id),
      canonicalUrl: `https://anilist.co/anime/${record.id}`,
      name: record.title.english || record.title.romaji, type: record.format,
      year: record.startDate.year, releaseYear: record.startDate.year,
      synopsis: record.description?.replace(/<[^>]*>/g, '') ?? '',
      genres: record.genres, languages: [],
      imageUrl: record.assets.poster.source, posterUrl: record.assets.poster.source,
      backdropUrl: record.assets.backdrop?.source ?? null,
    });
    await page.route('**/api/titles?*', route => {
      const items = new URL(route.request().url()).searchParams.get('scope') === 'tv' ? [] : records.map(summary);
      return route.fulfill({ json: { items, total: items.length, pages: 1, page: 1 } });
    });
    // Public metadata has no episode inventory or playback sources. Do not copy
    // synthetic episode counts, provider mappings, or rights assertions into it.
    await page.route('**/api/titles/visual-review-*', route => {
      const id = Number(new URL(route.request().url()).pathname.split('visual-review-')[1]);
      const record = records.find(item => item.id === id);
      if (!record) return route.fulfill({ status: 404, json: { error: 'Review title unavailable' } });
      return route.fulfill({ json: {
        collectionState: 'metadata-only', title: { ...summary(record), collectionState: 'metadata-only' },
        genres: record.genres, aliases: [], related: [], episodes: [],
      } });
    });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const route = surface === 'home' ? '/' : '/catalogue?scope=anime';
    const name = `public-artwork-${surface}`;
    await page.goto(route);
    await expect(page.locator(route === '/' ? '#featured-title' : '.title-card').first()).toBeVisible();
    await expectVisibleArtwork(page);
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath(`${name}.png`), scale: 'css' });
    await info.attach(`${name}-scope`, { body: JSON.stringify({ scope: manifest.scope, observedAt: manifest.observedAt, visibleImages: await visibleArtwork(page) }), contentType: 'application/json' });
    if (route === '/') {
      const next = records[1];
      expect(next, 'Carousel review requires at least two public titles.').toBeTruthy();
      await page.getByRole('button', { name: `Feature ${next.title.english || next.title.romaji}`, exact: true }).click();
      await expect(page.locator('#featured-title')).toHaveText(next.title.english || next.title.romaji);
      await expectVisibleArtwork(page);
      await page.screenshot({ path: info.outputPath('public-artwork-next-feature.png'), scale: 'css' });
      await page.locator('.home-rail').first().scrollIntoViewIfNeeded();
      await expectVisibleArtwork(page);
      await page.screenshot({ path: info.outputPath('public-artwork-home-scroll.png'), scale: 'css' });
      await page.locator('#featured-title a').click();
      await expect(page.locator('#title-name')).toHaveText(next.title.english || next.title.romaji);
      await expectVisibleArtwork(page);
      await noOverflow(page);
      await page.screenshot({ path: info.outputPath('public-artwork-title.png'), scale: 'css' });
    }
    expect(errors, 'Public-artwork browsing must not produce page or console errors.').toEqual([]);
  });
}
