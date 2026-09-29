import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { BatchManifest } from './prepare.ts';
import { validateImportBatch } from '../../server/cloud/data/import.ts';
import { IMPORT_TABLES, upsertSql } from '../../server/cloud/data/import-schema.ts';

const option = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const input = option('manifest'); const destination = option('out');
if (!input || !destination) throw new Error('Use --manifest=<manifest.json> --out=<new private verification directory>. No existing database will be overwritten.');
const manifestPath = resolve(input); const output = resolve(destination); const root = resolve(import.meta.dirname, '../..');
const cataloguePath = join(output, 'catalogue.sqlite'); const researchPath = join(output, 'research.sqlite');
if (existsSync(cataloguePath) || existsSync(researchPath)) throw new Error('Verification databases already exist. Preserve them and choose a fresh output directory.');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BatchManifest;
if (manifest.version !== 1 || manifest.totalBatches !== manifest.batches.length) throw new Error('The manifest is incomplete.');
mkdirSync(output, { recursive: true });
const databases = { catalogue: new DatabaseSync(cataloguePath), research: new DatabaseSync(researchPath) };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
let rows = 0;
try {
  for (const [target, database] of Object.entries(databases)) {
    database.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
    for (const file of readdirSync(join(root, 'migrations/cloud', target)).filter(name => name.endsWith('.sql')).sort()) database.exec(readFileSync(join(root, 'migrations/cloud', target, file), 'utf8'));
  }
  for (const entry of manifest.batches) {
    if (!/^batches\/[a-zA-Z0-9_-]+\.json$/.test(entry.file)) throw new Error('Invalid source batch path.');
    const raw = readFileSync(join(dirname(manifestPath), entry.file), 'utf8'); if (hash(raw) !== entry.sha256) throw new Error(`Batch file checksum mismatch: ${entry.id}`);
    const batch = validateImportBatch(JSON.parse(raw));
    if (batch.id !== entry.id || batch.table !== entry.table || batch.target !== entry.target || batch.rows.length !== entry.rows || hash(JSON.stringify(batch.rows)) !== batch.contentHash) throw new Error(`Batch metadata mismatch: ${entry.id}`);
    const database = databases[batch.target];
    database.exec('BEGIN IMMEDIATE');
    try {
      for (const row of batch.rows) { const columns = Object.keys(row); database.prepare(upsertSql(batch.table, columns, columns.map(() => '?').join(','))).run(...columns.map(column => row[column])); }
      database.prepare('INSERT INTO cloud_import_receipts(id,snapshot_id,table_name,content_hash,row_count,estimated_writes,imported_at) VALUES(?,?,?,?,?,?,?)').run(batch.id, batch.snapshotId, batch.table, batch.contentHash, batch.rows.length, entry.estimatedWrites, new Date().toISOString());
      database.exec('COMMIT'); rows += batch.rows.length;
    } catch (error) { database.exec('ROLLBACK'); throw error; }
  }
  const results: Record<string, unknown> = {};
  for (const [target, database] of Object.entries(databases)) {
    const integrity = database.prepare('PRAGMA integrity_check').all(); const foreignKeys = database.prepare('PRAGMA foreign_key_check').all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok' || foreignKeys.length) throw new Error(`${target} failed structural verification after import.`);
    const counts: Record<string, number> = {};
    for (const [table, spec] of Object.entries(IMPORT_TABLES)) if (spec.target === target || spec.target === 'both') counts[table] = Number(database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get()?.count);
    results[target] = { integrity: 'ok', foreignKeyErrors: 0, counts };
    database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  }
  console.log(JSON.stringify({ output, input: manifestPath, batchesVerified: manifest.batches.length, exportedRowOccurrences: rows, ...results, note: 'Local SQLite structural restore verification, not remote D1 quota or playback verification. Duplicate priority upserts are not unique coverage.' }, null, 2));
} finally { databases.catalogue.close(); databases.research.close(); }
