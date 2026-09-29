import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { IMPORT_TABLES, estimateImportWrites, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, upsertSql, type ImportBatch, type ImportRow } from '../../server/cloud/data/import-schema.ts';
import { auditDeltaAgainstSnapshot } from './audit-delta.ts';

// Small approved-native additions can be imported without restarting a full
// snapshot. The original complete snapshot and durable job remain authoritative.
const option = (name: string, fallback: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const sourcePath = resolve(option('source-db', 'data/solanime.sqlite'));
const output = resolve(option('out', '../solanime-cloud-artifacts/native-delta'));
const fullManifest = option('full-manifest', '');
if (!fullManifest) throw new Error('Supply --full-manifest=<pinned full manifest.json> to verify IDs against all not-yet-hosted records.');
if (existsSync(output)) throw new Error('Choose a new private output directory; existing native delta artifacts will not be overwritten.');
const budget = Number(option('written-row-budget', '10000'));
if (!Number.isSafeInteger(budget) || budget < 1 || budget > 70000) throw new Error('Choose an explicit delta budget between 1 and 70,000 writes.');
const database = new DatabaseSync(sourcePath, { readOnly: true });
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const quote = (value: unknown) => value == null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
try {
  const native = 'SELECT mapping_id FROM native_resources WHERE enabled=1';
  const versions = `SELECT version_id FROM episode_provider_mappings WHERE id IN (${native})`;
  const providers = `SELECT provider_id FROM native_resources WHERE enabled=1`;
  const filters: Record<string, string> = {
    providers: `id IN (${providers})`, provider_aliases: `provider_id IN (${providers})`,
    provider_connections: `provider_id IN (${providers})`, episode_versions: `id IN (${versions})`,
    episode_provider_mappings: `id IN (${native})`, native_resources: 'enabled=1',
    verification_observations: `entity_type='mapping' AND CAST(entity_id AS INTEGER) IN (${native})`,
  };
  const batches: Array<{file: string; sqlFile: string; id: string; target: string; table: string; rows: number; estimatedWrites: number; sha256: string}> = [];
  const prepared: ImportBatch[] = [];
  let sequence = 0;
  const counts: Record<string, number> = {};
  for (const [table, where] of Object.entries(filters)) {
    const spec = IMPORT_TABLES[table];
    const rows = database.prepare(`SELECT ${spec.columns.map(column => `"${column}"`).join(',')} FROM "${table}" WHERE ${where} ORDER BY ${spec.primaryKey.join(',')}`).all() as ImportRow[];
    counts[table] = rows.length;
    for (let index = 0; index < rows.length; index += MAX_IMPORT_ROWS) {
      const selected = rows.slice(index, index + MAX_IMPORT_ROWS);
      const contentHash = hash(JSON.stringify(selected));
      const id = `approved-native:${table}:${contentHash}`;
      const batch: ImportBatch = { version: 1, id, snapshotId: 'approved-native-2026-09-12', target: 'catalogue', table, contentHash, rows: selected };
      const content = JSON.stringify(batch);
      if (Buffer.byteLength(content) > MAX_IMPORT_BYTES) throw new Error('Native evidence exceeds a bounded batch; do not publish a partial manifest.');
      const prefix = `${String(sequence++).padStart(7, '0')}-${table}`;
      const file = `batches/${prefix}.json`, sqlFile = `batches/${prefix}.sql`;
      prepared.push(batch);
      batches.push({ file, sqlFile, id, target: 'catalogue', table, rows: selected.length, estimatedWrites: estimateImportWrites(spec, selected.length), sha256: hash(content) });
    }
  }
  const audit = auditDeltaAgainstSnapshot(fullManifest, prepared);
  const estimatedWrites = batches.reduce((sum, batch) => sum + batch.estimatedWrites, 0);
  if (estimatedWrites > budget) throw new Error(`Delta requires ${estimatedWrites} conservative writes above explicit budget ${budget}; no files were written.`);
  const manifest = { version: 1, sourceCatalogue: sourcePath, totalBatches: batches.length, totalEstimatedWrites: estimatedWrites, catalogueCounts: counts, batches, identityAudit: audit, note: 'Reviewed native-resource delta only. The audited episode parents must already exist in D1. This is not a complete catalogue; retain the original full snapshot and its unfinished tasks.' };
  mkdirSync(join(output, 'batches'), { recursive: true });
  prepared.forEach((batch, index) => {
    writeFileSync(join(output, batches[index].file), JSON.stringify(batch), { mode: 0o600 });
    writeFileSync(join(output, batches[index].sqlFile), batch.rows.map(row => { const columns = Object.keys(row); return upsertSql(batch.table, columns, columns.map(column => quote(row[column])).join(',')) + ';'; }).join('\n'), { mode: 0o600 });
  });
  writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ output, counts, batches: batches.length, estimatedWrites: manifest.totalEstimatedWrites, identityAudit: audit }));
} finally { database.close(); }
