import { afterAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { preparePriorityResearch } from '../scripts/cloud-data/priority-research.ts';
import { IMPORT_TABLES, estimateImportWrites, type ImportBatch, type ImportRow } from '../server/cloud/data/import-schema.ts';
import type { BatchManifest } from '../scripts/cloud-data/prepare.ts';

const directories: string[] = [];
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
afterAll(() => {
  const parent = resolve(tmpdir());
  for (const directory of directories) if (resolve(directory).startsWith(join(parent, 'solanime-priority-test-'))) rmSync(directory, { recursive: true, force: true });
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'solanime-priority-test-')); directories.push(directory); mkdirSync(join(directory, 'batches'));
  const manifest: BatchManifest = { version: 1, sourceCatalogue: 'not-read', sourceCatalogueSha256: '0'.repeat(64), sourceResearch: 'not-read', catalogueCounts: {}, researchCounts: { sites: 2, records: 3 }, totalBatches: 0, totalEstimatedWrites: 0, batches: [], note: 'Test fixture only.' };
  function append(table: string, rows: ImportRow[]) {
    const id = `test-original:${manifest.batches.length}`;
    const batch: ImportBatch = { version: 1, id, snapshotId: 'test-pinned', target: 'research', table, rows, contentHash: hash(JSON.stringify(rows)) };
    const body = JSON.stringify(batch); const file = `batches/${manifest.batches.length}.json`;
    writeFileSync(join(directory, file), body);
    const estimatedWrites = estimateImportWrites(IMPORT_TABLES[table], rows.length);
    manifest.batches.push({ file, sqlFile: file.replace('.json', '.sql'), id, target: 'research', table, rows: rows.length, estimatedWrites, sha256: hash(body) });
    manifest.totalEstimatedWrites += estimatedWrites;
  }
  const record = (id: string, collection = 'sites') => ({ id, collection, source_id: id, name: id, kind: 'site', research_status: 'unverified', evidence_class: 'public_reference', observation_date: '2026-09-12T00:00:00.000Z', provenance_path: 'indexes/sites.json', record_json: '{}', record_hash: hash('{}'), imported_at: '2026-09-12T00:00:00.000Z' });
  append('research_records', [record('site-one'), record('site-two'), record('evidence-three', 'site-evidence')]);
  append('research_categories', [{ record_id: 'site-one', category: 'Anime' }, { record_id: 'site-two', category: 'Video' }]);
  append('research_record_fragments', [{ record_id: 'site-one', fragment_index: 0, content: '{}' }, { record_id: 'evidence-three', fragment_index: 0, content: '{}' }]);
  append('research_relationships', [{ id: 'outside-priority', source_id: 'site-one', target_id: 'site-two', relationship_type: 'reference', evidence_json: '{}' }]);
  manifest.totalBatches = manifest.batches.length;
  const path = join(directory, 'manifest.json'); writeFileSync(path, JSON.stringify(manifest));
  return { directory, path, manifest };
}

describe('immutable research priority manifest', () => {
  it('selects every canonical site and dependent rows, reusing complete original receipts', () => {
    const source = fixture(); const original = readFileSync(source.path, 'utf8'); const output = join(source.directory, 'priority');
    const report = preparePriorityResearch(source.path, { output, writtenRowBudget: 1000 });
    expect(report).toMatchObject({ sites: 2, sourceSites: 2, reusedOriginalReceipts: 1, counts: { research_records: 2, research_categories: 2, research_record_fragments: 1 } });
    const exported = JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8')) as BatchManifest;
    expect(exported.batches.some(batch => batch.table === 'research_relationships')).toBe(false);
    expect(exported.batches.some(batch => batch.table === 'research_capabilities')).toBe(false);
    expect(exported.batches.find(batch => batch.table === 'research_categories')?.id).toBe('test-original:1');
    const records = exported.batches.filter(batch => batch.table === 'research_records').flatMap(entry => (JSON.parse(readFileSync(join(output, entry.file), 'utf8')) as ImportBatch).rows);
    expect(records.map(row => row.id)).toEqual(['site-one', 'site-two']);
    expect(readFileSync(source.path, 'utf8')).toBe(original);
    expect(() => preparePriorityResearch(source.path, { output })).toThrow('existing artifacts');
  });
  it('fails before output for exhausted allowance or changed immutable evidence', () => {
    const source = fixture(); const output = join(source.directory, 'must-not-exist');
    expect(() => preparePriorityResearch(source.path, { output, writtenRowBudget: 1 })).toThrow('exceeding explicit budget');
    expect(existsSync(output)).toBe(false);
    const entry = source.manifest.batches[0]; writeFileSync(join(source.directory, entry.file), '{}');
    expect(() => preparePriorityResearch(source.path, { output })).toThrow('checksum mismatch');
    expect(existsSync(output)).toBe(false);
  });
});
