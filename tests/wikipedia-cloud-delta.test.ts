import { afterAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { openDatabase, migrate } from '../server/db.ts';
import { validateImportBatch } from '../server/cloud/data/import.ts';
import type { ImportBatch, ImportRow } from '../server/cloud/data/import-schema.ts';
import type { BatchManifest } from '../scripts/cloud-data/prepare.ts';
import { prepareWikipediaDelta } from '../scripts/cloud-data/wikipedia-delta.ts';

const roots: string[] = [];
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const timestamp = '2026-09-13T12:00:00.000Z';

afterAll(() => {
  const temporaryRoot = resolve(tmpdir());
  for (const root of roots) {
    const resolved = resolve(root);
    if (resolved.startsWith(join(temporaryRoot, 'solanime-wikipedia-cloud-delta-')))
      rmSync(resolved, { recursive: true, force: true });
  }
});

function batch(table: string, rows: ImportRow[], sequence: number): ImportBatch {
  return {
    version: 1,
    id: `fixture:${table}:${sequence}`,
    snapshotId: 'complete-pinned-fixture',
    target: 'catalogue',
    table,
    contentHash: hash(JSON.stringify(rows)),
    rows,
  };
}

function pinnedFixture(root: string) {
  const directory = join(root, 'pinned');
  mkdirSync(join(directory, 'batches'), { recursive: true });
  const batches = [
    batch('titles', [
      { id: 1, source: 'anikoto', source_id: 'anime-1', slug: 'anime-one', name: 'Anime One' },
      { id: 7, source: 'wikipedia-movie', source_id: 'Q100', slug: 'known-wikipedia-q100', name: 'Known Film' },
    ], 0),
    batch('genres', [
      { id: 3, slug: 'action', name: 'Action' },
    ], 1),
    batch('title_aliases', [
      { id: 10, title_id: 7, alias: 'Already known', language: 'en', alias_type: 'alternate' },
    ], 2),
  ];
  const entries = batches.map((item, index) => {
    const body = JSON.stringify(item);
    const file = `batches/${String(index).padStart(7, '0')}-${item.table}.json`;
    writeFileSync(join(directory, file), body);
    return {
      file,
      sqlFile: file.replace('.json', '.sql'),
      id: item.id,
      target: item.target,
      table: item.table,
      rows: item.rows.length,
      estimatedWrites: 100,
      sha256: hash(body),
    };
  });
  const manifest: BatchManifest = {
    version: 1,
    sourceCatalogue: 'fixture.sqlite',
    sourceCatalogueSha256: 'a'.repeat(64),
    sourceResearch: '',
    catalogueCounts: {},
    researchCounts: {},
    totalBatches: entries.length,
    totalEstimatedWrites: 300,
    batches: entries,
    note: 'Complete deterministic unit-test fixture.',
  };
  const path = join(directory, 'manifest.json');
  writeFileSync(path, JSON.stringify(manifest));
  return { path, entries };
}

function sourceFixture(options: { wikipediaEpisode?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'solanime-wikipedia-cloud-delta-'));
  roots.push(root);
  const path = join(root, 'reviewed.sqlite');
  const db = openDatabase(path);
  migrate(db);
  const title = db.prepare(`INSERT INTO titles(id,source,source_id,slug,canonical_url,name,description,format,release_year,status,artwork_url,artwork_origin,artwork_reuse_status,availability_state,first_seen_at,last_seen_at,last_successful_import_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  title.run(1, 'anikoto', 'anime-1', 'anime-one', 'https://anikototv.to/watch/anime-one', 'Anime One', null, 'TV', 2026, null, null, null, 'unknown', 'observed', timestamp, timestamp, timestamp, timestamp, timestamp);
  title.run(2, 'wikipedia-movie', 'Q100', 'known-wikipedia-q100', 'https://en.wikipedia.org/wiki/Known_Film', 'Known Film', 'Existing identity with fresher metadata.', 'Movie', 2026, null, null, null, 'unknown', 'observed', timestamp, timestamp, timestamp, timestamp, timestamp);
  title.run(3, 'wikipedia-movie', 'Q200', 'new-film-wikipedia-q200', 'https://en.wikipedia.org/wiki/New_Film', 'New Film', 'A new film.', 'Movie', 2026, null, 'https://upload.wikimedia.org/new-film.jpg', 'English Wikipedia page image (poster); file-specific reuse not established', 'unknown', 'observed', timestamp, timestamp, timestamp, timestamp, timestamp);
  title.run(4, 'wikipedia-tv', 'Q300', 'new-series-wikipedia-q300', 'https://en.wikipedia.org/wiki/New_Series', 'New Series', 'A new series.', 'TV', 2026, null, null, null, 'unknown', 'observed', timestamp, timestamp, timestamp, timestamp, timestamp);
  title.run(5, 'tvmaze', 'maze-5', 'other-show', 'https://www.tvmaze.com/shows/5', 'Other Show', null, 'TV', 2026, null, null, null, 'unknown', 'observed', timestamp, timestamp, timestamp, timestamp, timestamp);
  db.prepare('INSERT INTO genres(id,slug,name) VALUES(1,\'action\',\'Action\'),(2,\'documentary\',\'Documentary\')').run();
  db.prepare('INSERT INTO title_genres(title_id,genre_id) VALUES(2,1),(3,2),(4,1),(5,2)').run();
  db.prepare("INSERT INTO title_aliases(id,title_id,alias,language,alias_type) VALUES(1,2,'Already known','en','alternate'),(2,3,'The New Film','en','alternate'),(3,5,'Other','en','alternate')").run();
  db.prepare(`INSERT INTO episodes(id,title_id,source_id,number_text,slug,canonical_url,first_seen_at,last_seen_at,created_at,updated_at)
    VALUES(20,5,'maze-episode','1','one','https://www.tvmaze.com/episodes/20',?,?,?,?)`).run(timestamp, timestamp, timestamp, timestamp);
  if (options.wikipediaEpisode)
    db.prepare(`INSERT INTO episodes(id,title_id,source_id,number_text,slug,canonical_url,first_seen_at,last_seen_at,created_at,updated_at)
      VALUES(21,3,'unexpected','1','unexpected','https://en.wikipedia.org/wiki/New_Film',?,?,?,?)`).run(timestamp, timestamp, timestamp, timestamp);
  db.close();
  return { root, path, pinned: pinnedFixture(root) };
}

function options(fixture: ReturnType<typeof sourceFixture>, output = join(fixture.root, 'delta')) {
  return {
    sourceDatabase: fixture.path,
    fullManifest: fixture.pinned.path,
    output,
    writtenRowBudget: 2_000,
    titleIdStart: 500,
    genreIdStart: 600,
    aliasIdStart: 700,
  };
}

function outputBatches(path: string) {
  const manifest = JSON.parse(readFileSync(join(path, 'manifest.json'), 'utf8')) as {
    batches: Array<{ file: string; sqlFile: string; table: string; rows: number; sha256: string }>;
  };
  return {
    manifest,
    rows: manifest.batches.flatMap(entry => {
      const body = readFileSync(join(path, entry.file), 'utf8');
      expect(hash(body)).toBe(entry.sha256);
      expect(existsSync(join(path, entry.sqlFile))).toBe(true);
      const checked = validateImportBatch(JSON.parse(body));
      expect(checked.rows).toHaveLength(entry.rows);
      expect(hash(JSON.stringify(checked.rows))).toBe(checked.contentHash);
      return checked.rows.map(row => ({ table: entry.table, row }));
    }),
  };
}

describe('Wikipedia metadata-only Cloudflare delta', () => {
  it('remaps new IDs, reuses pinned parents, and emits only checksummed metadata tables', async () => {
    const fixture = sourceFixture();
    const before = hash(readFileSync(fixture.path));
    const result = await prepareWikipediaDelta(options(fixture));
    expect(hash(readFileSync(fixture.path))).toBe(before);
    expect(result.manifest).toMatchObject({
      allowedSources: ['wikipedia-movie', 'wikipedia-tv'],
      sourceCounts: {
        'wikipedia-movie': { titles: 2, aliases: 2, titleGenres: 2 },
        'wikipedia-tv': { titles: 1, aliases: 0, titleGenres: 1 },
      },
      identityAudit: {
        collisions: 0,
        allocatedRanges: {
          titles: { start: 500, count: 2, end: 501 },
          genres: { start: 600, count: 1, end: 600 },
          title_aliases: { start: 700, count: 1, end: 700 },
        },
        reusedPinnedIdentities: { titles: 1, genres: 1, title_aliases: 1 },
      },
    });
    expect(result.manifest.totalEstimatedWrites).toBeLessThanOrEqual(result.manifest.writtenRowBudget);
    const output = outputBatches(result.output);
    expect(new Set(output.manifest.batches.map(entry => entry.table))).toEqual(new Set([
      'cloud_snapshot_sources', 'genres', 'titles', 'title_aliases', 'title_genres',
    ]));
    expect(output.rows.some(item => ['episodes', 'episode_versions', 'providers', 'episode_provider_mappings', 'native_resources'].includes(item.table))).toBe(false);
    const titles = output.rows.filter(item => item.table === 'titles').map(item => item.row);
    expect(titles.map(row => [row.source, row.source_id, row.id])).toEqual([
      ['wikipedia-movie', 'Q100', 7],
      ['wikipedia-movie', 'Q200', 500],
      ['wikipedia-tv', 'Q300', 501],
    ]);
    expect(titles.some(row => row.source === 'anikoto' || row.source === 'tvmaze')).toBe(false);
    expect(output.rows.filter(item => item.table === 'genres').map(item => item.row.id)).toEqual([3, 600]);
    expect(output.rows.filter(item => item.table === 'title_aliases').map(item => item.row.id)).toEqual([10, 700]);
    expect(output.rows.filter(item => item.table === 'title_genres').map(item => [item.row.title_id, item.row.genre_id])).toEqual([[7, 3], [500, 600], [501, 3]]);
  });

  it('fails before creating output when the explicit budget or declared vacant range is unsafe', async () => {
    const fixture = sourceFixture();
    const budgetOutput = join(fixture.root, 'budget-rejected');
    await expect(prepareWikipediaDelta({ ...options(fixture, budgetOutput), writtenRowBudget: 1 }))
      .rejects.toThrow('above explicit budget');
    expect(existsSync(budgetOutput)).toBe(false);
    const collisionOutput = join(fixture.root, 'collision-rejected');
    await expect(prepareWikipediaDelta({ ...options(fixture, collisionOutput), titleIdStart: 1 }))
      .rejects.toThrow('collides with pinned numeric ID 1');
    expect(existsSync(collisionOutput)).toBe(false);
  });

  it('rejects a changed pinned batch and metadata rows with unexpected episode children', async () => {
    const tampered = sourceFixture();
    writeFileSync(join(dirname(tampered.pinned.path), tampered.pinned.entries[0].file), '{}');
    await expect(prepareWikipediaDelta(options(tampered))).rejects.toThrow('checksum mismatch');
    const withEpisode = sourceFixture({ wikipediaEpisode: true });
    await expect(prepareWikipediaDelta(options(withEpisode))).rejects.toThrow('unexpectedly have episode or relationship children');
  });
});
