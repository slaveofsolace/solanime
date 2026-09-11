import { resolve } from 'node:path';
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
const server = createApp(db, {
  staticDirectory: resolve('dist'),
  resolutionCooldownMs: 0,
  resolveProvider: async (mapping) => ({
    mappingId: mapping.mappingId,
    providerId: mapping.providerId,
    playbackType: 'iframe',
    status: 'resolved',
    embedUrl: `https://megaplay.buzz/stream/s-2/fixture-${mapping.mappingId}`,
  }),
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
