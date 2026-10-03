import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { sqliteAccountAdapter } from '../server/integrations/sqliteAdapter';
import { indexFeatures, type ExploreCatalogue } from '../server/explore/catalogue';
import { genreKey, type ExploreCardData, type ExploreTitleFeature } from '../shared/explore';

/** Synthetic catalogue: fixtures prove mechanics only, never live catalogue behaviour. */
export const GENRES = ['Action', 'Comedy', 'Mystery', 'Psychological', 'Romance', 'Slice of Life', 'Sci-Fi', 'Fantasy', 'Horror', 'Sports', 'Drama', 'Adventure'];

export function syntheticFeatures(count = 120): ExploreTitleFeature[] {
  const items: ExploreTitleFeature[] = [];
  for (let i = 1; i <= count; i++) {
    const a = GENRES[i % GENRES.length], b = GENRES[(i * 7 + 3) % GENRES.length];
    items.push({
      id: String(i), name: `Series ${String(i).padStart(3, '0')}`, genres: [...new Set([genreKey(a), genreKey(b)])],
      type: i % 9 === 0 ? 'movie' : 'tv', status: 'finished airing', episodeCount: i % 9 === 0 ? 1 : i % 3 === 0 ? 50 : i % 2 ? 12 : 24,
      languages: i % 2 ? ['sub'] : ['sub', 'dub'], malId: 1000 + i,
    });
  }
  // One franchise with sequels and side stories, plus a title with no episodes.
  items.push(
    { id: '901', name: 'Night Detective', genres: ['mystery', 'psychological'], type: 'tv', status: 'finished airing', episodeCount: 12, languages: ['sub'], malId: 9901 },
    { id: '902', name: 'Night Detective Season 2', genres: ['mystery', 'psychological'], type: 'tv', status: 'finished airing', episodeCount: 12, languages: ['sub'], malId: 9902 },
    { id: '903', name: 'Night Detective: The Movie', genres: ['mystery'], type: 'movie', status: 'finished airing', episodeCount: 1, languages: ['sub'], malId: 9903 },
    { id: '904', name: 'Night Detective Specials', genres: ['mystery'], type: 'special', status: 'finished airing', episodeCount: 3, languages: ['sub'], malId: 9904 },
    { id: '905', name: 'Paper Lantern', genres: ['drama'], type: 'tv', status: 'finished airing', episodeCount: 0, languages: [], malId: null },
  );
  return items;
}

export function syntheticCatalogue(features = syntheticFeatures()): ExploreCatalogue & { cardCalls: number } {
  const labels = new Map(GENRES.map(name => [genreKey(name), name]));
  const index = indexFeatures('synthetic', features.map(item => ({ ...item, malId: null })), features.filter(item => item.malId).map(item => ({ titleId: item.id, malId: item.malId! })), labels);
  const catalogue = {
    cardCalls: 0,
    async features() { return index; },
    async cards(ids: readonly string[]) {
      catalogue.cardCalls++;
      const result = new Map<string, ExploreCardData>();
      for (const id of ids) {
        const item = index.byId.get(id);
        if (!item) continue;
        result.set(id, { titleId: id, slug: `series-${id}`, name: item.name, artworkUrl: `https://img.example.test/${id}.jpg`, posterUrl: null, backdropUrl: null,
          synopsis: 'A spoiler-free premise.', type: item.type, status: item.status, releaseYear: 2010, episodeCount: item.episodeCount,
          genres: item.genres.map(genre => labels.get(genre) ?? genre), languages: item.languages, publicMean: null });
      }
      return result;
    },
  };
  return catalogue;
}

/** Minimal private accounts schema: profiles, profile data and the real MAL migration. */
export function accountsFixture() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(`PRAGMA foreign_keys=ON; CREATE TABLE accounts(id TEXT PRIMARY KEY); CREATE TABLE profiles(id TEXT PRIMARY KEY);
    CREATE TABLE profile_data(profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, key TEXT NOT NULL, value TEXT NOT NULL,
      revision INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(profile_id,key));`);
  raw.exec("INSERT INTO accounts VALUES('a'); INSERT INTO profiles VALUES('p'),('q');");
  raw.exec(readFileSync(new URL('../migrations/cloud/accounts/0003_myanimelist.sql', import.meta.url), 'utf8'));
  const db = sqliteAccountAdapter(raw);
  function connectMal(profile: string, entries: Array<{ id: number; score: number; status: string; title?: string }>, options: { partial?: boolean; importedAt?: number } = {}) {
    raw.prepare('INSERT OR REPLACE INTO mal_connections(profile_id,username,credential_cipher,committed_generation,imported_at,sync_generation) VALUES(?,?,?,?,?,?)')
      .run(profile, 'member', 'sealed', 'gen1', options.importedAt ?? 1_900_000_000_000 - 86_400_000, options.partial ? 'gen2' : null);
    for (const entry of entries)
      raw.prepare('INSERT INTO mal_list_items(profile_id,generation,mal_id,value) VALUES(?,?,?,?)').run(profile, 'gen1', entry.id,
        JSON.stringify({ id: entry.id, title: entry.title ?? `MAL ${entry.id}`, status: entry.status, watchedEpisodes: 0, totalEpisodes: 12, score: entry.score, updatedAt: null }));
  }
  function putData(profile: string, key: string, value: unknown) {
    raw.prepare('INSERT OR REPLACE INTO profile_data(profile_id,key,value,revision,updated_at) VALUES(?,?,?,1,0)').run(profile, key, JSON.stringify(value));
  }
  function keys(profile: string) {
    return (raw.prepare('SELECT key,value FROM profile_data WHERE profile_id=? ORDER BY key').all(profile) as Array<{ key: string; value: string }>);
  }
  return { raw, db, connectMal, putData, keys };
}
