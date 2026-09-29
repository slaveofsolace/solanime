import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { IMPORT_TABLES, upsertJsonRowsSql, type ImportRow } from '../server/cloud/data/import-schema.ts';
import { applyImportBatch, importHash } from '../server/cloud/data/import.ts';

function sqliteTable(name: string) {
  const database = new DatabaseSync(':memory:');
  const spec = IMPORT_TABLES[name];
  database.exec(`CREATE TABLE "${name}" (${spec.columns.map(column => `"${column}" ${['id','title_id','match_id'].includes(column) ? 'INTEGER' : 'TEXT'}`).join(',')}, PRIMARY KEY (${spec.primaryKey.join(',')}))`);
  return {
    write(row: ImportRow) { return Number(database.prepare(upsertJsonRowsSql(name, Object.keys(row))).run(JSON.stringify([row])).changes); },
    read() { return database.prepare(`SELECT * FROM "${name}"`).get(); },
    close() { database.close(); },
  };
}

describe('unchanged normalized imports avoid repeat row/index writes', () => {
  it('does not UPDATE equal fields or fields whose null/empty input preserves existing values', () => {
    const table = sqliteTable('titles');
    try {
      const row = { id: 1, source: 'test', source_id: 'one', name: 'Name', description: 'Known', release_year: 2020, updated_at: '2026-09-13T00:00:00Z' };
      expect(table.write(row)).toBe(1);
      expect(table.write(row)).toBe(0);
      expect(table.write({ ...row, description: null })).toBe(0);
      expect(table.write({ ...row, name: '', description: '' })).toBe(0);
      expect(table.write({ ...row, description: 'Changed' })).toBe(1);
      expect(table.read()?.description).toBe('Changed');
    } finally { table.close(); }
  });

  it('still persists a newer observation even when its description is unchanged', () => {
    const table = sqliteTable('titles');
    try {
      const row = { id: 1, source: 'test', source_id: 'one', name: 'Name', updated_at: '2026-09-13T00:00:00Z' };
      table.write(row);
      expect(table.write({ ...row, updated_at: '2026-09-14T00:00:00Z' })).toBe(1);
      expect(table.write({ ...row, name: 'Stale' })).toBe(0);
      expect(table.write({ ...row, source_id: 'another', updated_at: '2026-09-15T00:00:00Z' })).toBe(0);
      expect(table.read()?.name).toBe('Name');
    } finally { table.close(); }
  });

  it('clears an artwork error on successful verification and then skips identical success', () => {
    const table = sqliteTable('title_artwork');
    try {
      const row = { match_id: 1, role: 'poster', url: 'https://example.invalid/test.webp', last_checked_at: '2026-09-13T00:00:00Z', last_successful_verification_at: '2026-09-12T00:00:00Z', last_error_code: 'UNAVAILABLE' };
      table.write(row);
      const success = { ...row, last_checked_at: '2026-09-14T00:00:00Z', last_successful_verification_at: '2026-09-14T00:00:00Z', last_error_code: null };
      expect(table.write(success)).toBe(1);
      expect(table.read()?.last_error_code).toBeNull();
      expect(table.write(success)).toBe(0);
      expect(table.write(row)).toBe(0);
    } finally { table.close(); }
  });
});

describe('measured local D1 import costs', () => {
  let runtime: Miniflare;
  let db: Awaited<ReturnType<Miniflare['getD1Database']>>;
  beforeAll(async () => {
    runtime = new Miniflare(convertV4MiniflareOptions({ name: 'import-noop-contract', modules: true, script: 'export default { fetch() { return new Response("test-only") } }', compatibilityDate: '2026-09-12', d1Databases: { CATALOGUE: 'import-noop-test' } }));
    db = await runtime.getD1Database('CATALOGUE');
    await db.prepare('CREATE TABLE crawl_tasks(id INTEGER PRIMARY KEY,status TEXT,available_at TEXT)').run();
    for (const statement of readFileSync(new URL('../migrations/cloud/catalogue/007_cloud_sync.sql', import.meta.url), 'utf8').replace(/^--.*$/gm, '').split(';').filter(value => value.trim())) await db.prepare(statement).run();
    await db.prepare('CREATE TABLE genres(id INTEGER PRIMARY KEY,slug TEXT NOT NULL UNIQUE,name TEXT NOT NULL)').run();
  }, 60_000);
  afterAll(async () => { await runtime?.dispose(); });

  it('charges only a receipt for equal rows in a new snapshot but still charges actual changed data', async () => {
    const rows = [{ id: 1, slug: 'test-genre', name: 'Test genre' }];
    const make = async (id: string, data = rows) => ({ version: 1, id, snapshotId: id, target: 'catalogue', table: 'genres', rows: data, contentHash: await importHash(data) });
    const inserted = await applyImportBatch(db, db, await make('initial'));
    const unchanged = await applyImportBatch(db, db, await make('different-snapshot'));
    const changed = await applyImportBatch(db, db, await make('updated-snapshot', [{ ...rows[0], name: 'Updated genre' }]));
    if (inserted.status !== 'imported' || unchanged.status !== 'imported' || changed.status !== 'imported') throw new Error('Expected three distinct import receipts.');
    expect(unchanged.measuredWrites).toBeLessThan(inserted.measuredWrites!);
    expect(unchanged.measuredWrites).toBeLessThan(changed.measuredWrites!);
    expect((await db.prepare('SELECT COUNT(*) AS count FROM cloud_import_receipts').first())?.count).toBe(3);
    expect((await db.prepare('SELECT name FROM genres WHERE id=1').first())?.name).toBe('Updated genre');
  });
});
