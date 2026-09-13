import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { buildResearchDatabase } from './research.ts';
import { IMPORT_TABLES, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, estimateImportWrites, upsertSql, type ImportBatch, type ImportRow, type ImportTarget } from '../../server/cloud/data/import-schema.ts';

const root = resolve(import.meta.dirname, '../..');
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const fileHash = async (path: string) => { const digest = createHash('sha256'); for await (const chunk of createReadStream(path)) digest.update(chunk); return digest.digest('hex'); };
const quote = (value: unknown) => value == null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
export interface BatchManifestEntry { file: string; sqlFile: string; id: string; target: ImportTarget; table: string; rows: number; estimatedWrites: number; sha256: string; }
export interface BatchManifest { version: 1; sourceCatalogue: string; sourceCatalogueSha256: string; sourceResearch: string; catalogueCounts: Record<string, number>; researchCounts: Record<string, unknown>; totalBatches: number; totalEstimatedWrites: number; batches: BatchManifestEntry[]; note: string; }

/** Exports generated bounded SQL plus checksummed structured batches. The source SQLite is read-only. */
export async function prepareCloudData(sourcePath: string, dumpPath: string, outputPath: string, priorityTitleIds: number[] = []) {
  mkdirSync(outputPath, { recursive: true }); mkdirSync(join(outputPath, 'batches'), { recursive: true });
  const researchPath = join(outputPath, 'research.sqlite');
  const research = buildResearchDatabase(dumpPath, researchPath, join(root, 'migrations/cloud/research/001_research.sql'));
  const sourceHash = await fileHash(sourcePath);
  const catalogue = new DatabaseSync(sourcePath, { readOnly: true });
  const researchDb = new DatabaseSync(researchPath, { readOnly: true });
  const manifest: BatchManifest = { version: 1, sourceCatalogue: sourcePath, sourceCatalogueSha256: sourceHash, sourceResearch: researchPath, catalogueCounts: {}, researchCounts: research.counts, totalBatches: 0, totalEstimatedWrites: 0, batches: [], note: 'Source totals are not hosted coverage. Execute the protected bounded importer, inspect receipts, and resume across daily quota windows. SQL files are for controlled restore and must not be bulk-executed remotely without the shared quota reservation.' };
  let sequence = 0;
  const snapshotIds = { catalogue: `anikoto-${sourceHash.slice(0, 24)}`, research: `fmhy-${research.contentHash.slice(0, 24)}` };
  function writeBatch(target: ImportTarget, table: string, data: ImportRow[]) {
    const contentHash = sha(JSON.stringify(data));
    const id = `${snapshotIds[target]}:${table}:${sequence.toString().padStart(7, '0')}:${contentHash.slice(0, 16)}`;
    const batch: ImportBatch = { version: 1, id, snapshotId: snapshotIds[target], target, table, contentHash, rows: data };
    const json = JSON.stringify(batch);
    if (Buffer.byteLength(json) > MAX_IMPORT_BYTES) throw new Error(`Batch ${table} is oversized; no incomplete manifest was published.`);
    const prefix = `${String(sequence++).padStart(7, '0')}-${target}-${table}`;
    const file = `batches/${prefix}.json`; const sqlFile = `batches/${prefix}.sql`;
    const sql = data.map(row => { const columns = Object.keys(row); return `${upsertSql(table, columns, columns.map(column => quote(row[column])).join(','))};`; }).join('\n') + '\n';
    writeFileSync(join(outputPath, file), json, { encoding: 'utf8', mode: 0o600 });
    writeFileSync(join(outputPath, sqlFile), sql, { encoding: 'utf8', mode: 0o600 });
    const estimatedWrites = estimateImportWrites(IMPORT_TABLES[table], data.length);
    manifest.batches.push({ file, sqlFile, id, target, table, rows: data.length, estimatedWrites, sha256: sha(json) });
    manifest.totalEstimatedWrites += estimatedWrites;
  }
  function exportRows(target: ImportTarget, table: string, data: Iterable<ImportRow>) {
    let chunk: ImportRow[] = []; let size = 700;
    for (const row of data) {
      const length = Buffer.byteLength(JSON.stringify(row)) + 1;
      if (length + 700 > MAX_IMPORT_BYTES) throw new Error(`Oversized ${table} row requires evidence fragmentation.`);
      if (chunk.length && (chunk.length >= MAX_IMPORT_ROWS || size + length > MAX_IMPORT_BYTES - 1000)) { writeBatch(target, table, chunk); chunk = []; size = 700; }
      chunk.push(row); size += length;
    }
    if (chunk.length) writeBatch(target, table, chunk);
  }
  function allRows(database: DatabaseSync, table: string, where = '', values: number[] = []) {
    const spec = IMPORT_TABLES[table];
    const present = new Set((database.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map(column => column.name));
    const columns = spec.columns.filter(column => present.has(column));
    return database.prepare(`SELECT ${columns.map(column => `"${column}"`).join(',')} FROM "${table}" ${where} ORDER BY ${spec.primaryKey.map(column => `"${column}"`).join(',')}`).iterate(...values) as Iterable<ImportRow>;
  }
  try {
    const integrity = catalogue.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok' || catalogue.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Catalogue snapshot failed integrity verification.');
    for (const [name, spec] of Object.entries(IMPORT_TABLES)) if (spec.target === 'catalogue' && catalogue.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)) manifest.catalogueCounts[name] = Number(catalogue.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get()?.count);
    exportRows('catalogue', 'cloud_snapshot_sources', [{ id: snapshotIds.catalogue, source: 'anikoto', content_hash: sourceHash, counts_json: JSON.stringify(manifest.catalogueCounts), observation_date: null, imported_at: new Date().toISOString() }]);
    for (const name of ['providers', 'genres', 'provider_aliases', 'provider_connections']) exportRows('catalogue', name, allRows(catalogue, name));
    // A caller-selected real-data vertical slice is first, but it never limits the full manifest.
    for (const titleId of [...new Set(priorityTitleIds)]) {
      if (!Number.isSafeInteger(titleId) || titleId < 1) throw new Error('Priority title IDs must be stable positive integers.');
      for (const [name, where] of [
        ['titles', 'WHERE id=?'], ['title_aliases', 'WHERE title_id=?'], ['title_genres', 'WHERE title_id=?'], ['episodes', 'WHERE title_id=?'],
        ['episode_versions', 'WHERE episode_id IN (SELECT id FROM episodes WHERE title_id=?)'],
        ['episode_provider_mappings', 'WHERE version_id IN (SELECT v.id FROM episode_versions v JOIN episodes e ON e.id=v.episode_id WHERE e.title_id=?)'],
        ['native_resources', 'WHERE mapping_id IN (SELECT m.id FROM episode_provider_mappings m JOIN episode_versions v ON v.id=m.version_id JOIN episodes e ON e.id=v.episode_id WHERE e.title_id=?)'],
      ]) if (manifest.catalogueCounts[name] !== undefined) exportRows('catalogue', name, allRows(catalogue, name, where, [titleId]));
    }
    const ordered = ['titles', 'title_aliases', 'title_genres', 'related_titles', 'episodes', 'episode_versions', 'episode_provider_mappings', 'native_resources', 'crawl_runs', 'crawl_tasks', 'coverage_snapshots', 'verification_observations'];
    for (const name of ordered) if (manifest.catalogueCounts[name] !== undefined) exportRows('catalogue', name, allRows(catalogue, name));
    exportRows('research', 'cloud_snapshot_sources', allRows(researchDb, 'cloud_snapshot_sources'));
    for (const [name, spec] of Object.entries(IMPORT_TABLES)) if (spec.target === 'research') exportRows('research', name, allRows(researchDb, name));
    manifest.totalBatches = manifest.batches.length;
    writeFileSync(join(outputPath, 'manifest.json'), JSON.stringify(manifest, null, 2), { encoding: 'utf8', mode: 0o600 });
    return manifest;
  } finally { catalogue.close(); researchDb.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const option = (name: string, fallback: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
  const source = resolve(option('source-db', join(root, 'data/solanime.sqlite')));
  const output = resolve(option('out', join(root, '../solanime-cloud-artifacts/cloud-data')));
  if (!existsSync(source) || resolve(source) === join(output, 'research.sqlite')) throw new Error('Choose an existing catalogue source and a separate output directory.');
  const manifest = await prepareCloudData(source, resolve(option('research-root', join(root, 'data-dump'))), output, option('priority-title-ids', '').split(',').filter(Boolean).map(Number));
  console.log(JSON.stringify({ output, catalogueCounts: manifest.catalogueCounts, researchCounts: manifest.researchCounts, batches: manifest.totalBatches, estimatedWrites: manifest.totalEstimatedWrites, resume: `node --import tsx scripts/cloud-data/upload.ts --manifest=${join(output, 'manifest.json')} --origin=<preview-origin>` }, null, 2));
}
