import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, migrate, type SqliteDatabase } from '../server/db.ts';
import { isNonAnimeTvShow, syncTvMaze, tvMazeTitle, type TvMazeEpisode, type TvMazeShow } from '../server/ingestion/tvmaze.ts';
import { importSnapshot } from '../server/ingestion/snapshot.ts';
import { getTitle } from '../server/catalogue.ts';

const show: TvMazeShow = {
  id: 42,
  url: 'https://www.tvmaze.com/shows/42/example-show',
  name: 'Example Show',
  type: 'Scripted',
  language: 'English',
  genres: ['Drama'],
  status: 'Ended',
  premiered: '2014-01-02',
  summary: '<p>A <b>real</b> summary.</p>',
  image: { original: 'https://static.tvmaze.com/uploads/images/original_untouched/1/2.jpg' },
};

const episodes: TvMazeEpisode[] = [
  {
    id: 4201,
    url: 'https://www.tvmaze.com/episodes/4201/example-show-1x01-pilot',
    name: 'Pilot',
    season: 1,
    number: 1,
    airdate: '2014-01-02',
    runtime: 42,
    image: { original: 'https://static.tvmaze.com/uploads/images/original_untouched/3/4.jpg' },
  },
];

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('TVmaze catalogue ingestion', () => {
  let db: SqliteDatabase | undefined;
  afterEach(() => db?.close());

  it('maps non-animation shows and their real episode inventory without inventing providers', () => {
    expect(isNonAnimeTvShow(show)).toBe(true);
    expect(isNonAnimeTvShow({ ...show, genres: ['Drama', 'Animation'] })).toBe(false);
    const title = tvMazeTitle(show, episodes);
    expect(title).toMatchObject({
      sourceId: '42',
      slug: 'example-show-tvmaze-42',
      description: 'A real summary.',
      format: 'TV',
      releaseYear: 2014,
      artworkUrl: episodes[0].image?.original,
    });
    expect(title.episodes[0]).toMatchObject({
      sourceId: '4201',
      number: 'S1 E1',
      label: 'Pilot',
      thumbnailUrl: episodes[0].image?.original,
      durationSeconds: 2520,
      seasonNumber: 1,
      versions: [{ language: 'original', label: 'English', providers: [] }],
    });
  });

  it('persists episode metadata for the UI and preserves it across incomplete refreshes', () => {
    db = openDatabase(':memory:'); migrate(db);
    const title = tvMazeTitle(show, episodes);
    const snapshot = { schemaVersion: 1, source: 'tvmaze', observedAt: new Date().toISOString(), titles: [title] };
    importSnapshot(db, snapshot);
    const metadata = { thumbnailUrl: episodes[0].image?.original, durationSeconds: 2520, seasonNumber: 1 };
    expect(getTitle(db, title.slug).episodes[0]).toMatchObject(metadata);
    const sparse = tvMazeTitle(show, [{ ...episodes[0], image: null, runtime: null, season: null }]);
    importSnapshot(db, { ...snapshot, titles: [sparse] });
    expect(getTitle(db, title.slug).episodes[0]).toMatchObject(metadata);
    title.episodes[0].durationSeconds = -1;
    expect(() => importSnapshot(db!, snapshot)).toThrow(/durationSeconds/);
    expect(getTitle(db, title.slug).episodes[0]).toMatchObject(metadata);
  });

  it('imports a resumable page, skips animation, and preserves source isolation', async () => {
    db = openDatabase(':memory:');
    migrate(db);
    const animated = { ...show, id: 43, name: 'Animated', genres: ['Animation'] };
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/shows?page=0')) return json([show, animated]);
      if (url.endsWith('/shows/42/episodes?specials=1')) return json(episodes);
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    const first = await syncTvMaze(db, {
      startPage: 0,
      pageLimit: 1,
      requestIntervalMs: 50,
      retries: 0,
      fetchImpl,
    });
    expect(first).toMatchObject({
      status: 'paused',
      nextPage: 1,
      titlesImported: 1,
      episodesImported: 1,
      skippedAnimationTitles: 1,
    });
    expect(db.prepare('SELECT source,source_id AS sourceId,name FROM titles').all()).toEqual([
      { source: 'tvmaze', sourceId: '42', name: 'Example Show' },
    ]);
    expect(db.prepare('SELECT COUNT(*) AS count FROM episode_provider_mappings').get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT next_page AS nextPage,status FROM external_catalogue_sync WHERE source='tvmaze'").get()).toEqual({ nextPage: 1, status: 'paused' });
  });

  it('does not erase a successful page when a later refresh fails', async () => {
    db = openDatabase(':memory:');
    migrate(db);
    const goodFetch = (async (input: string | URL | Request) =>
      String(input).includes('/episodes') ? json(episodes) : json([show])) as typeof fetch;
    await syncTvMaze(db, { startPage: 0, pageLimit: 1, requestIntervalMs: 50, retries: 0, fetchImpl: goodFetch });

    const failedFetch = (async () => json({ error: 'changed' }, 500)) as typeof fetch;
    await expect(
      syncTvMaze(db, { startPage: 0, pageLimit: 1, requestIntervalMs: 50, retries: 0, fetchImpl: failedFetch }),
    ).rejects.toThrow(/HTTP 500/);
    expect(db.prepare('SELECT name FROM titles WHERE source=? AND source_id=?').get('tvmaze', '42')).toEqual({ name: 'Example Show' });
    expect(db.prepare("SELECT status,last_error_code AS code FROM external_catalogue_sync WHERE source='tvmaze'").get()).toEqual({ status: 'failed', code: 'UPSTREAM_CHANGED' });
  });
});
