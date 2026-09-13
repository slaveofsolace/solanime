import { afterEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type SqliteDatabase } from '../server/db.ts';
import {
  buildWikipediaUrl,
  parseWikipediaResponse,
  syncWikipedia,
  type WikipediaPage,
} from '../server/ingestion/wikipedia.ts';

function article(id: number, qid: string | undefined, title: string, extra: Partial<WikipediaPage> = {}): WikipediaPage {
  return {
    pageid: id,
    ns: 0,
    title,
    extract: `${title} is a catalogue fixture.`,
    pageprops: qid ? { wikibase_item: qid, 'wikibase-shortdesc': '2026 drama film' } : {},
    categories: [{ ns: 14, title: 'Category:2026 drama films' }],
    ...extra,
  };
}

function api(pages: WikipediaPage[], continuation: string | null = null, status = 200) {
  return new Response(
    JSON.stringify({
      batchcomplete: !continuation,
      ...(continuation ? { continue: { gcmcontinue: continuation, continue: 'gcmcontinue||' } } : {}),
      query: { pages },
    }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

describe('Wikipedia Movie and TV metadata ingestion', () => {
  let db: SqliteDatabase | undefined;
  afterEach(() => db?.close());

  it('builds bounded no-key movie and TV category requests with official continuation', () => {
    const movie = new URL(buildWikipediaUrl('movie', 2026, 5, {
      gcmcontinue: 'opaque cursor',
      continue: 'gcmcontinue||',
    }));
    expect(movie.origin).toBe('https://en.wikipedia.org');
    expect(movie.searchParams.get('gcmtitle')).toBe('Category:2026 films');
    expect(movie.searchParams.get('gcmlimit')).toBe('5');
    expect(movie.searchParams.get('gcmcontinue')).toBe('opaque cursor');
    expect(movie.searchParams.get('continue')).toBe('gcmcontinue||');
    expect(new URL(buildWikipediaUrl('tv', 2026, 25)).searchParams.get('gcmtitle')).toBe(
      'Category:2026 television series debuts',
    );
  });

  it('parses stable Q-IDs, metadata, genres and aspect-ratio artwork provenance', () => {
    const parsed = parseWikipediaResponse(
      {
        continue: { gcmcontinue: 'next-token', continue: 'gcmcontinue||' },
        query: {
          pages: [
            article(1, 'Q42', 'Example Film', {
              extract: 'A public article introduction.\nWith whitespace.',
              pageprops: { wikibase_item: 'Q42', 'wikibase-shortdesc': '2026 fantasy comedy film' },
              categories: [
                { ns: 14, title: 'Category:2026 action thriller films' },
                { ns: 14, title: 'Category:Upcoming films' },
              ],
              original: {
                source: 'https://upload.wikimedia.org/wikipedia/en/a/a1/Example.jpg',
                width: 300,
                height: 450,
              },
            }),
            article(2, undefined, 'No stable ID'),
            article(3, 'Q84', 'Anime entry', {
              categories: [{ ns: 14, title: 'Category:2026 anime films' }],
            }),
          ],
        },
      },
      { media: 'movie', year: 2026 },
    );
    expect(parsed).toMatchObject({
      nextContinue: { gcmcontinue: 'next-token', continue: 'gcmcontinue||' },
      returnedPages: 3,
      skippedMissingStableId: 1,
      skippedAnime: 1,
    });
    expect(parsed.titles).toHaveLength(1);
    expect(parsed.titles[0]).toMatchObject({
      sourceId: 'Q42',
      slug: 'example-film-wikipedia-q42',
      canonicalUrl: 'https://en.wikipedia.org/wiki/Example_Film',
      description: 'A public article introduction. With whitespace.',
      format: 'Movie',
      releaseYear: 2026,
      status: 'Upcoming',
      genres: ['Action', 'Comedy', 'Fantasy', 'Thriller'],
      artworkUrl: 'https://upload.wikimedia.org/wikipedia/en/a/a1/Example.jpg',
      artworkOrigin:
        'English Wikipedia page image (portrait poster candidate); file-specific reuse not established',
      artworkReuseStatus: 'unknown',
      episodes: [],
    });
  });

  it('resumes by opaque continuation and keeps repeated records idempotent', async () => {
    db = openDatabase(':memory:');
    migrate(db);
    const responses = [
      api([article(1, 'Q42', 'Example Film')], 'resume-token'),
      api([article(2, 'Q84', 'Later Film')]),
    ];
    const urls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      urls.push(String(input));
      const response = responses.shift();
      if (!response) throw new Error('Unexpected request');
      return response;
    }) as typeof fetch;

    const first = await syncWikipedia(db, {
      media: 'movie', year: 2026, batchLimit: 1, pageSize: 1,
      requestIntervalMs: 100, retries: 0, fetchImpl,
    });
    expect(first).toMatchObject({ status: 'paused', titlesImported: 1, hasMore: true });
    const resumed = await syncWikipedia(db, {
      media: 'movie', year: 2026, batchLimit: 1, pageSize: 1,
      requestIntervalMs: 100, retries: 0, fetchImpl,
    });
    expect(resumed).toMatchObject({ status: 'complete', titlesImported: 2, hasMore: false });
    expect(new URL(urls[1]).searchParams.get('gcmcontinue')).toBe('resume-token');
    expect(db.prepare("SELECT COUNT(*) AS count FROM titles WHERE source='wikipedia-movie'").get()).toEqual({ count: 2 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM episodes e JOIN titles t ON t.id=e.title_id WHERE t.source='wikipedia-movie'").get()).toEqual({ count: 0 });

    db.prepare("UPDATE external_catalogue_sync SET checkpoint_json='{}',status='paused' WHERE source='wikipedia:movie:2026'").run();
    const repeatFetch = (async () => api([article(1, 'Q42', 'Example Film')])) as typeof fetch;
    const repeated = await syncWikipedia(db, {
      media: 'movie', year: 2026, batchLimit: 1, pageSize: 1,
      requestIntervalMs: 100, retries: 0, fetchImpl: repeatFetch,
    });
    expect(repeated.titlesImported).toBe(3);
    expect(db.prepare("SELECT COUNT(*) AS count FROM titles WHERE source='wikipedia-movie'").get()).toEqual({ count: 2 });
  });

  it('preserves a committed batch and continuation when the next request fails', async () => {
    db = openDatabase(':memory:');
    migrate(db);
    let request = 0;
    const fetchImpl = (async () => {
      request++;
      return request === 1 ? api([article(1, 'Q42', 'Example Film')], 'saved-token') : api([], null, 503);
    }) as typeof fetch;
    await expect(syncWikipedia(db, {
      media: 'movie', year: 2026, batchLimit: 2, pageSize: 1,
      requestIntervalMs: 100, retries: 0, fetchImpl,
    })).rejects.toThrow(/HTTP 503/);
    expect(db.prepare("SELECT name FROM titles WHERE source='wikipedia-movie' AND source_id='Q42'").get()).toEqual({ name: 'Example Film' });
    const state = db.prepare("SELECT status,last_error_code AS code,checkpoint_json AS checkpoint FROM external_catalogue_sync WHERE source='wikipedia:movie:2026'").get() as Record<string, unknown>;
    expect(state).toMatchObject({ status: 'failed', code: 'UPSTREAM_CHANGED' });
    expect(JSON.parse(String(state.checkpoint))).toEqual({
      gcmcontinue: 'saved-token',
      continue: 'gcmcontinue||',
    });
  });

  it('migrates a JSON-validated continuation checkpoint column', () => {
    db = openDatabase(':memory:');
    migrate(db);
    const columns = db.prepare('PRAGMA table_info(external_catalogue_sync)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain('checkpoint_json');
    expect(() =>
      db!.prepare(
        "INSERT INTO external_catalogue_sync(source,next_page,status,pages_imported,titles_imported,episodes_imported,checkpoint_json,updated_at) VALUES('invalid-json-test',0,'idle',0,0,0,'not-json','2026-01-01T00:00:00.000Z')",
      ).run(),
    ).toThrow();
  });
});
