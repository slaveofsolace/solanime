import { resolve, extname } from 'node:path';
import { readdirSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { createApp } from '../../server/app';
import { openDatabase, migrate } from '../../server/db';
import { importSnapshot } from '../../server/ingestion/snapshot';
import type { SnapshotTitle } from '../../server/types';
// This process cannot open or modify the user's catalogue file.
const db = openDatabase(':memory:');
migrate(db);
const titles: SnapshotTitle[] = Array.from({ length: 32 }, (_, index) => {
  const slug =
    index === 0 ? 'paper-lantern' : index === 1 ? 'long-journey' : `fixture-title-${index}`;
  const sourceId = `qa-title-${index}`;
  return {
    sourceId,
    slug,
    canonicalUrl: `https://anikototv.to/watch/${slug}`,
    name:
      index === 0
        ? 'Paper Lantern'
        : index === 1
          ? 'Long Journey'
          : `Fixture Title ${String(index).padStart(2, '0')}`,
    description:
      'A fictional title used only to test catalogue navigation, episode selection, and saved preferences.',
    format: index % 4 === 0 ? 'Movie' : 'TV',
    releaseYear: 2020 + (index % 7),
    status: 'Finished Airing',
    artworkUrl: `https://images.example.test/${index}.svg`,
    artworkOrigin: 'test-fixture',
    artworkReuseStatus: 'original',
    genres: index % 2 ? ['Drama'] : ['Adventure', 'Drama'],
    aliases: [{ name: `Test alias ${index}` }],
    episodes: Array.from({ length: index === 1 ? 120 : 3 }, (_, episodeIndex) => {
      const id = `${sourceId}-ep-${episodeIndex + 1}`;
      return {
        sourceId: id,
        number: String(episodeIndex + 1),
        numberSort: episodeIndex + 1,
        label: `Episode ${episodeIndex + 1}`,
        slug: `ep-${episodeIndex + 1}`,
        canonicalUrl: `https://anikototv.to/watch/${slug}/ep-${episodeIndex + 1}`,
        versions: ['sub', 'dub'].map((language) => ({
          sourceId: `${id}:${language}`,
          language,
          availability: 'available',
          providers: ['hd-1', 'hd-2', 'kiwi'].map((providerId) => ({
            sourceMappingId: `${id}:${language}:${providerId}`,
            providerId,
            providerResourceId: `fixture-${id}-${language}`,
            availability: providerId === 'kiwi' ? 'unavailable' : 'available',
            unavailableReason:
              providerId === 'kiwi' ? 'Fixture: download-only provider.' : undefined,
          })),
        })),
      };
    }),
  };
});
importSnapshot(db, {
  schemaVersion: 1,
  source: 'anikoto',
  observedAt: '2026-09-11T00:00:00.000Z',
  titles,
});
// Test-only external records prove that the public Movies/TV routes render
// their persisted source namespaces. They are never part of a release import.
importSnapshot(db, {
  schemaVersion: 1,
  source: 'wikipedia-movie',
  observedAt: '2026-09-13T00:00:00.000Z',
  titles: [{
    sourceId: 'Q900001',
    slug: 'fixture-screen-film',
    canonicalUrl: 'https://en.wikipedia.org/wiki/Fixture_Screen_Film',
    name: 'Fixture Screen Film',
    description: 'A test-only non-animation movie catalogue record.',
    format: 'Movie',
    releaseYear: 2026,
    artworkUrl: 'https://images.example.test/movie.svg',
    artworkOrigin: 'test-fixture',
    artworkReuseStatus: 'original',
    genres: ['Drama'],
    episodes: [],
  }],
});
importSnapshot(db, {
  schemaVersion: 1,
  source: 'wikipedia-tv',
  observedAt: '2026-09-13T00:00:00.000Z',
  titles: [{
    sourceId: 'Q900002',
    slug: 'fixture-screen-series',
    canonicalUrl: 'https://en.wikipedia.org/wiki/Fixture_Screen_Series',
    name: 'Fixture Screen Series',
    description: 'A test-only non-animation television catalogue record.',
    format: 'TV',
    releaseYear: 2026,
    artworkUrl: 'https://images.example.test/tv.svg',
    artworkOrigin: 'test-fixture',
    artworkReuseStatus: 'original',
    genres: ['Drama'],
    episodes: [],
  }],
});
const resolveTestSource = (
  mapping: import('../../server/providers/contract').StoredProviderMapping,
): import('../../server/providers/contract').ProviderResolution | null => {
  if (mapping.providerId === 'kiwi' || mapping.providerResourceId?.includes('qa-title-2-'))
    return null;
  return {
    mappingId: mapping.mappingId,
    providerId: mapping.providerId,
    delivery: 'native',
    playbackType: 'direct',
    status: 'resolved',
    url: '/__fixture/motion.mp4',
    captions: [{ url: '/__fixture/captions.vtt', label: 'English', language: 'en' }],
  };
};
const server = createApp(db, {
  staticDirectory: resolve('dist'),
  resolutionCooldownMs: 0,
  nativeSources: resolveTestSource,
});
// Deliver the original test clip over actual HTTP so range and seek behavior
// exercise real media transport rather than browser-intercepted responses.
const clip = readFileSync(resolve('tests/fixtures/motion.mp4'));
const segments = new Map<string, Buffer>();
for (const format of ['hls', 'dash'])
  for (const name of readdirSync(resolve('tests/fixtures', format)))
    segments.set(
      `/__fixture/${format}/${name}`,
      readFileSync(resolve('tests/fixtures', format, name)),
    );
const applicationHandlers = server.listeners('request');
server.removeAllListeners('request');
server.on('request', (request, response) => {
  const resource = segments.get(request.url ?? '');
  if (resource) {
    response.writeHead(200, {
      'Content-Type':
        (
          {
            '.m3u8': 'application/vnd.apple.mpegurl',
            '.ts': 'video/mp2t',
            '.mpd': 'application/dash+xml',
            '.m4s': 'video/mp4',
          } as Record<string, string>
        )[extname(request.url ?? '')] ?? 'video/mp4',
      'Cache-Control': 'no-store',
    });
    response.end(resource);
    return;
  }

  if (request.url === '/__fixture/captions.vtt') {
    response.writeHead(200, { 'Content-Type': 'text/vtt', 'Cache-Control': 'no-store' });
    response.end('WEBVTT\n\n00:00:00.000 --> 00:00:04.000\nOriginal test footage.\n');
    return;
  }
  if (request.url !== '/__fixture/motion.mp4') {
    for (const handler of applicationHandlers) handler.call(server, request, response);
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405);
    response.end();
    return;
  }
  const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '');
  const start = match ? Number(match[1]) : 0;
  const end = match && match[2] ? Math.min(Number(match[2]), clip.length - 1) : clip.length - 1;
  if (!Number.isSafeInteger(start) || start > end || start >= clip.length) {
    response.writeHead(416, { 'Content-Range': `bytes */${clip.length}` });
    response.end();
    return;
  }
  response.writeHead(match ? 206 : 200, {
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1,
    'Cache-Control': 'no-store',
    ...(match ? { 'Content-Range': `bytes ${start}-${end}/${clip.length}` } : {}),
  });
  response.end(request.method === 'HEAD' ? undefined : clip.subarray(start, end + 1));
});
server.listen(18787, '127.0.0.1', () =>
  console.log('Isolated browser fixture API on 127.0.0.1:18787'),
);
function stop() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  server.closeAllConnections();
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
