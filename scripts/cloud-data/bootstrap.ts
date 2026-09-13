import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { IMPORT_TABLES, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, estimateImportWrites, upsertSql, type ImportBatch, type ImportRow } from '../../server/cloud/data/import-schema.ts';
import type { BatchManifest, BatchManifestEntry } from './prepare.ts';

const option = (name: string, fallback = '') => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
if (!option('full-manifest') || !option('out')) throw new Error('Usage: node --import tsx scripts/cloud-data/bootstrap.ts --full-manifest=<manifest.json> --out=<separate directory> --written-row-budget=40000 --priority-title-ids=3881');
const full = JSON.parse(readFileSync(resolve(option('full-manifest')), 'utf8')) as BatchManifest;
const output = resolve(option('out')); const budget = Number(option('written-row-budget', '40000'));
if (!Number.isInteger(budget) || budget < 1000 || budget > 70_000) throw new Error('Choose an explicit bootstrap written-row budget between 1,000 and 70,000. The server enforces the shared daily allowance separately.');
const database = new DatabaseSync(full.sourceCatalogue, { readOnly: true });
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const quote = (value: unknown) => value == null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
const sourceIds = new Map((database.prepare('SELECT id,source_id FROM titles').all() as Array<{ id: number; source_id: string }>).map(row => [row.id, row.source_id]));
const stats = database.prepare(`SELECT t.id,t.updated_at,(SELECT COUNT(*) FROM episodes e WHERE e.title_id=t.id) AS episodes,(SELECT COUNT(*) FROM episode_versions v JOIN episodes e ON e.id=v.episode_id WHERE e.title_id=t.id) AS versions,(SELECT COUNT(*) FROM episode_provider_mappings m JOIN episode_versions v ON v.id=m.version_id JOIN episodes e ON e.id=v.episode_id WHERE e.title_id=t.id) AS mappings FROM titles t WHERE EXISTS(SELECT 1 FROM episodes e WHERE e.title_id=t.id) ORDER BY t.updated_at DESC,t.id DESC`).all() as Array<{ id: number; episodes: number; versions: number; mappings: number }>;
const priority = option('priority-title-ids', '3881').split(',').map(Number);
const ordered = [...new Set([...priority, ...stats.filter(row => row.mappings > 0).map(row => row.id)])];
const graphTitles: number[] = []; const metadataTitles = new Set<number>(); let allowance = 2500;
try {
  for (const id of ordered) {
    const stat = stats.find(row => row.id === id); if (!stat) continue;
    const related = (database.prepare('SELECT related_title_id FROM related_titles WHERE title_id=? AND related_title_id IS NOT NULL').all(id) as Array<{ related_title_id: number }>).map(row => row.related_title_id);
    const extraTitles = [...new Set([id, ...related])].filter(value => !metadataTitles.has(value));
    // Includes all current relationships, versions, mappings, relevant queue records and overhead.
    const relationCount = Number(database.prepare('SELECT COUNT(*) AS count FROM related_titles WHERE title_id=?').get(id)?.count);
    const aliasCount = Number(database.prepare('SELECT COUNT(*) AS count FROM title_aliases WHERE title_id=?').get(id)?.count);
    const genreCount = Number(database.prepare('SELECT COUNT(*) AS count FROM title_genres WHERE title_id=?').get(id)?.count);
    const cost = extraTitles.length * 16 + stat.episodes * 20 + stat.versions * 8 + stat.mappings * 6 + relationCount * 8 + aliasCount * 6 + genreCount * 4 + 160;
    if (allowance + cost > budget) continue;
    graphTitles.push(id); extraTitles.forEach(value => metadataTitles.add(value)); allowance += cost;
  }
  if (!graphTitles.length) throw new Error('No complete real title graph fit this budget. Increase the explicit budget.');
  mkdirSync(join(output, 'batches'), { recursive: true });
  const entries: BatchManifestEntry[] = []; const counts: Record<string, number> = {}; let sequence = 0; let estimatedWrites = 0;
  const snapshotId = `bootstrap-${full.sourceCatalogueSha256.slice(0, 24)}`;
  const selectedTitles = [...metadataTitles]; const titlePlaceholders = selectedTitles.map(() => '?').join(',');
  const graphPlaceholders = graphTitles.map(() => '?').join(',');
  const graphSources = graphTitles.map(id => sourceIds.get(id)!); const sourcePlaceholders = graphSources.map(() => '?').join(',');
  function emit(table: string, records: ImportRow[]) {
    let rows: ImportRow[] = []; let bytes = 700;
    function flush() {
      if (!rows.length) return;
      const contentHash = hash(JSON.stringify(rows)); const id = `${snapshotId}:${table}:${sequence}:${contentHash.slice(0, 16)}`;
      const batch: ImportBatch = { version: 1, id, snapshotId, target: 'catalogue', table, contentHash, rows };
      const body = JSON.stringify(batch); const prefix = `${String(sequence++).padStart(7, '0')}-catalogue-${table}`;
      const file = `batches/${prefix}.json`; const sqlFile = `batches/${prefix}.sql`;
      writeFileSync(join(output, file), body, { mode: 0o600 });
      writeFileSync(join(output, sqlFile), rows.map(row => { const cols = Object.keys(row); return upsertSql(table, cols, cols.map(column => quote(row[column])).join(',')) + ';'; }).join('\n') + '\n', { mode: 0o600 });
      const cost = estimateImportWrites(IMPORT_TABLES[table], rows.length);
      entries.push({ file, sqlFile, id, target: 'catalogue', table, rows: rows.length, estimatedWrites: cost, sha256: hash(body) });
      estimatedWrites += cost; rows = []; bytes = 700;
    }
    for (const row of records) { const size = Buffer.byteLength(JSON.stringify(row)) + 1; if (size + 700 > MAX_IMPORT_BYTES) throw new Error('Bootstrap row exceeds bounded import limit.'); if (rows.length && (rows.length >= MAX_IMPORT_ROWS || bytes + size > MAX_IMPORT_BYTES - 1000)) flush(); rows.push(row); bytes += size; }
    flush(); counts[table] = records.length;
  }
  function read(table: string, where = '', values: Array<string | number> = []) {
    if (full.catalogueCounts[table] === undefined) return [];
    const present = new Set((database.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map(row => row.name));
    const spec = IMPORT_TABLES[table]; const columns = spec.columns.filter(column => present.has(column));
    return database.prepare(`SELECT ${columns.map(column => `"${column}"`).join(',')} FROM "${table}" ${where} ORDER BY ${spec.primaryKey.map(column => `"${column}"`).join(',')}`).all(...values) as ImportRow[];
  }
  for (const table of ['providers', 'genres', 'provider_aliases', 'provider_connections']) emit(table, read(table));
  emit('titles', read('titles', `WHERE id IN (${titlePlaceholders})`, selectedTitles));
  for (const table of ['title_aliases', 'title_genres']) emit(table, read(table, `WHERE title_id IN (${graphPlaceholders})`, graphTitles));
  emit('related_titles', read('related_titles', `WHERE title_id IN (${graphPlaceholders})`, graphTitles));
  emit('episodes', read('episodes', `WHERE title_id IN (${graphPlaceholders})`, graphTitles));
  emit('episode_versions', read('episode_versions', `WHERE episode_id IN (SELECT id FROM episodes WHERE title_id IN (${graphPlaceholders}))`, graphTitles));
  emit('episode_provider_mappings', read('episode_provider_mappings', `WHERE version_id IN (SELECT v.id FROM episode_versions v JOIN episodes e ON e.id=v.episode_id WHERE e.title_id IN (${graphPlaceholders}))`, graphTitles));
  emit('native_resources', read('native_resources', `WHERE mapping_id IN (SELECT m.id FROM episode_provider_mappings m JOIN episode_versions v ON v.id=m.version_id JOIN episodes e ON e.id=v.episode_id WHERE e.title_id IN (${graphPlaceholders}))`, graphTitles));
  const tasks = read('crawl_tasks', `WHERE json_extract(payload_json,'$.titleSourceId') IN (${sourcePlaceholders}) OR json_extract(payload_json,'$.sourceId') IN (${sourcePlaceholders})`, [...graphSources, ...graphSources]);
  const runs = read('crawl_runs').map(run => ({ ...run, tasks_discovered: tasks.filter(task => task.run_id === run.id).length, tasks_completed: tasks.filter(task => task.run_id === run.id && task.status === 'completed').length, tasks_failed: tasks.filter(task => task.run_id === run.id && ['failed', 'blocked'].includes(String(task.status))).length }));
  emit('crawl_runs', runs); emit('crawl_tasks', tasks);
  emit('verification_observations', read('verification_observations', `WHERE entity_type='provider' OR (entity_type='mapping' AND entity_id IN (SELECT CAST(m.id AS TEXT) FROM episode_provider_mappings m JOIN episode_versions v ON v.id=m.version_id JOIN episodes e ON e.id=v.episode_id WHERE e.title_id IN (${graphPlaceholders})))`, graphTitles));
  emit('cloud_snapshot_sources', [{ id: snapshotId, source: 'anikoto-preview-bootstrap', content_hash: full.sourceCatalogueSha256, counts_json: JSON.stringify({ hostedBootstrapCounts: counts, fullSnapshotCounts: full.catalogueCounts, completeImportedTitleGraphs: graphTitles.length, graphTitleIds: graphTitles }), observation_date: null, imported_at: new Date().toISOString() }]);
  if (estimatedWrites > budget) throw new Error(`Bootstrap generated ${estimatedWrites} conservative writes above budget ${budget}. Its candidate files were preserved but no upload manifest was published.`);
  const manifest: BatchManifest = { ...full, catalogueCounts: counts, researchCounts: {}, totalBatches: entries.length, totalEstimatedWrites: estimatedWrites, batches: entries, note: `Explicit partial bootstrap: ${graphTitles.length} complete imported title graphs plus ${metadataTitles.size - graphTitles.length} referenced-title metadata records. Original catalogue discovery remains incomplete and the full durable manifest must still be resumed. ${counts.native_resources ?? 0} approved native editions; this count is not playback verification.` };
  writeFileSync(join(output, 'manifest.json'), JSON.stringify({ ...manifest, graphTitleIds: graphTitles, writtenRowBudget: budget }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ output, completeImportedTitleGraphs: graphTitles.length, counts, batches: entries.length, conservativeWrites: estimatedWrites, budget, fullManifest: resolve(option('full-manifest')) }, null, 2));
} finally { database.close(); }
