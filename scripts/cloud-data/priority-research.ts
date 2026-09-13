import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateImportBatch } from '../../server/cloud/data/import.ts';
import { IMPORT_TABLES, estimateImportWrites, upsertSql, type ImportBatch, type ImportRow } from '../../server/cloud/data/import-schema.ts';
import type { BatchManifest, BatchManifestEntry } from './prepare.ts';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const quote = (value: unknown) => value == null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;

/** Reorders immutable research rows only; it neither acquires new evidence nor enables capabilities. */
export function preparePriorityResearch(manifestPath: string, options: { output?: string; writtenRowBudget?: number } = {}) {
  const sourcePath = resolve(manifestPath); const sourceRaw = readFileSync(sourcePath, 'utf8');
  const full = JSON.parse(sourceRaw) as BatchManifest;
  if (full.version !== 1 || !Array.isArray(full.batches) || full.totalBatches !== full.batches.length) throw new Error('The source manifest is incomplete.');
  const sourceManifestHash = hash(sourceRaw); const snapshotId = `priority-sites-${sourceManifestHash.slice(0, 24)}`;
  const budget = options.writtenRowBudget ?? 70_000;
  if (!Number.isInteger(budget) || budget < 1 || budget > 70_000) throw new Error('Choose a priority allowance from 1 to 70,000 writes; the shared cloud allowance is enforced separately.');
  const ids = new Set<string>(); const provenance = new Set<string>();
  const batches: ImportBatch[] = []; const rowsByTable: Record<string, number> = {};
  function read(entry: BatchManifestEntry) {
    if (!/^batches\/[a-zA-Z0-9_-]+\.json$/.test(entry.file)) throw new Error('Invalid immutable batch path.');
    const raw = readFileSync(join(dirname(sourcePath), entry.file), 'utf8');
    if (hash(raw) !== entry.sha256) throw new Error(`Immutable source checksum mismatch: ${entry.file}`);
    const batch = validateImportBatch(JSON.parse(raw));
    if (batch.target !== 'research' || batch.table !== entry.table || batch.id !== entry.id || batch.rows.length !== entry.rows || batch.contentHash !== hash(JSON.stringify(batch.rows))) throw new Error(`Immutable source metadata mismatch: ${entry.file}`);
    return batch;
  }
  function select(entry: BatchManifestEntry, predicate: (row: ImportRow) => boolean) {
    const original = read(entry); const rows = original.rows.filter(predicate);
    if (!rows.length) return;
    // Reusing a complete original batch also reuses its receipt when the full job arrives.
    const batch = rows.length === original.rows.length ? original : { ...original, snapshotId, rows, contentHash: hash(JSON.stringify(rows)), id: `${snapshotId}:${original.table}:${hash(JSON.stringify(rows)).slice(0, 24)}` };
    batches.push(batch); rowsByTable[batch.table] = (rowsByTable[batch.table] ?? 0) + rows.length;
  }
  for (const entry of full.batches.filter(entry => entry.target === 'research' && entry.table === 'research_records')) select(entry, row => {
    if (row.collection !== 'sites') return false;
    if (typeof row.id !== 'string' || ids.has(row.id) || typeof row.provenance_path !== 'string') throw new Error('A site has a missing or duplicate stable identity.');
    ids.add(row.id); provenance.add(row.provenance_path); return true;
  });
  const denominator = Number(full.researchCounts.sites);
  if (!ids.size || !Number.isSafeInteger(denominator) || ids.size !== denominator) throw new Error(`Site inventory differs from the source manifest: found ${ids.size}, expected ${denominator}.`);
  const has = (value: unknown) => typeof value === 'string' && ids.has(value);
  const filters: Record<string, (row: ImportRow) => boolean> = {
    research_record_fragments: row => has(row.record_id),
    research_categories: row => has(row.record_id),
    research_aliases: row => has(row.alias_id) || has(row.canonical_id),
    research_documents: row => typeof row.path === 'string' && provenance.has(row.path),
  };
  for (const [table, predicate] of Object.entries(filters)) for (const entry of full.batches.filter(entry => entry.target === 'research' && entry.table === table)) select(entry, predicate);
  const observationDates = new Set(batches.filter(batch => batch.table === 'research_records').flatMap(batch => batch.rows.map(row => String(row.observation_date))));
  const stamp = observationDates.size === 1 ? [...observationDates][0] : null;
  const coverageRow: ImportRow = { id: snapshotId, source: 'FMHY priority site inventory from pinned full snapshot', content_hash: sourceManifestHash, counts_json: JSON.stringify({ priorityCounts: rowsByTable, sites: ids.size, sourceSites: denominator, fullSnapshotResearchCounts: full.researchCounts, scope: 'All canonical site collection rows and their fragments/categories/aliases/provenance only. Listing occurrences, detailed site-evidence, relationships and other research remain in the unchanged full import. Capabilities remain disabled.' }), observation_date: stamp, imported_at: stamp ?? new Date().toISOString() };
  const coverage: ImportBatch = { version: 1, target: 'research', table: 'cloud_snapshot_sources', snapshotId, rows: [coverageRow], contentHash: hash(JSON.stringify([coverageRow])), id: `${snapshotId}:coverage` };
  batches.push(coverage); rowsByTable.cloud_snapshot_sources = 1;
  const estimatedWrites = batches.reduce((sum, batch) => sum + estimateImportWrites(IMPORT_TABLES[batch.table], batch.rows.length), 0);
  const reusedReceipts = batches.filter(batch => batch.snapshotId !== snapshotId).length;
  const report = { sourceManifest: sourcePath, sourceManifestHash, sites: ids.size, sourceSites: denominator, counts: rowsByTable, batches: batches.length, estimatedWrites, writtenRowBudget: budget, fitsBudget: estimatedWrites <= budget, reusedOriginalReceipts: reusedReceipts, structuredBytes: batches.reduce((sum, batch) => sum + Buffer.byteLength(JSON.stringify(batch)), 0), scope: 'Complete canonical sites collection, not complete FMHY evidence or enabled providers.' };
  if (!options.output) return report;
  if (estimatedWrites > budget) throw new Error(`Priority inventory requires ${estimatedWrites} conservative writes, exceeding explicit budget ${budget}. No output was created.`);
  const output = resolve(options.output);
  if (existsSync(output)) throw new Error('Choose a new private output directory; existing artifacts will not be overwritten.');
  mkdirSync(join(output, 'batches'), { recursive: true });
  const entries: BatchManifestEntry[] = [];
  for (const [index, batch] of batches.entries()) {
    validateImportBatch(batch);
    const prefix = `${String(index).padStart(7, '0')}-research-${batch.table}`;
    const file = `batches/${prefix}.json`; const sqlFile = `batches/${prefix}.sql`; const body = JSON.stringify(batch);
    writeFileSync(join(output, file), body, { mode: 0o600 });
    writeFileSync(join(output, sqlFile), batch.rows.map(row => { const columns = Object.keys(row); return upsertSql(batch.table, columns, columns.map(column => quote(row[column])).join(',')) + ';'; }).join('\n') + '\n', { mode: 0o600 });
    entries.push({ file, sqlFile, id: batch.id, target: 'research', table: batch.table, rows: batch.rows.length, estimatedWrites: estimateImportWrites(IMPORT_TABLES[batch.table], batch.rows.length), sha256: hash(body) });
  }
  const manifest: BatchManifest = { ...full, catalogueCounts: {}, researchCounts: { sites: ids.size, tables: rowsByTable, sourceResearchCounts: full.researchCounts }, totalBatches: entries.length, totalEstimatedWrites: estimatedWrites, batches: entries, note: `${report.scope} ${coverageRow.counts_json}` };
  writeFileSync(join(output, 'manifest.json'), JSON.stringify({ ...manifest, sourceManifestHash, priorityReport: report }, null, 2), { mode: 0o600 });
  return { ...report, output };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!option('full-manifest')) throw new Error('Use --full-manifest=<pinned manifest.json> to inspect; add --out=<new private directory> and --written-row-budget=<explicit allowance> to generate.');
  console.log(JSON.stringify(preparePriorityResearch(option('full-manifest')!, { output: option('out'), writtenRowBudget: option('written-row-budget') ? Number(option('written-row-budget')) : undefined }), null, 2));
}
