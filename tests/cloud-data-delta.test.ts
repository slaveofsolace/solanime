import { afterAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { auditDeltaAgainstSnapshot } from '../scripts/cloud-data/audit-delta.ts';
import type { ImportBatch, ImportRow } from '../server/cloud/data/import-schema.ts';
import type { BatchManifest } from '../scripts/cloud-data/prepare.ts';

const directories: string[] = []; const hash = (value: string) => createHash('sha256').update(value).digest('hex');
afterAll(() => { const parent = resolve(tmpdir()); for (const directory of directories) if (resolve(directory).startsWith(join(parent, 'solanime-delta-test-'))) rmSync(directory, { recursive: true, force: true }); });
function batch(table: string, rows: ImportRow[]): ImportBatch { return { version: 1, id: `test:${table}:${hash(JSON.stringify(rows))}`, snapshotId: 'test-pinned', target: 'catalogue', table, rows, contentHash: hash(JSON.stringify(rows)) }; }
const observation = { id: 746, entity_type: 'mapping', entity_id: '31', stage: 'adapter_implemented', result: 'approved', reason_code: 'TEST_APPROVAL', evidence_class: 'test-only', details_json: '{}', observed_at: '2026-09-12T00:00:00.000Z' };
const version = { id: 20, episode_id: 10, source_id: 'edition-silent', language: 'silent' };
const mapping = { id: 31, version_id: 20, provider_id: 'test-approved', source_mapping_id: 'stable-resource' };
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'solanime-delta-test-')); directories.push(directory); mkdirSync(join(directory, 'batches'));
  const batches = [batch('episodes', [{ id: 10 }]), batch('episode_versions', [version]), batch('episode_provider_mappings', [mapping]), batch('verification_observations', [observation])];
  const manifest: BatchManifest = { version: 1, sourceCatalogue: 'not-read', sourceCatalogueSha256: '0'.repeat(64), sourceResearch: 'not-read', catalogueCounts: {}, researchCounts: {}, totalBatches: batches.length, totalEstimatedWrites: 1000, batches: batches.map((value, index) => { const raw = JSON.stringify(value); const file = `batches/${index}.json`; writeFileSync(join(directory, file), raw); return { file, sqlFile: file.replace('.json', '.sql'), id: value.id, target: value.target, table: value.table, rows: value.rows.length, estimatedWrites: 100, sha256: hash(raw) }; }), note: 'Deterministic test fixture only.' };
  const path = join(directory, 'manifest.json'); writeFileSync(path, JSON.stringify(manifest)); return path;
}
describe('native delta numeric identity audit', () => {
  it('checks unhosted pinned IDs and preserves matching existing identities without remapping', () => {
    const delta = [batch('episode_versions', [version]), batch('episode_provider_mappings', [mapping]), batch('verification_observations', [observation, { ...observation, id: 747, result: 'new-observation' }])];
    const before = JSON.stringify(delta); const result = auditDeltaAgainstSnapshot(fixture(), delta);
    expect(result).toMatchObject({ collisions: 0, requiredEpisodeParents: [10], tables: { verification_observations: { pinnedMaximumId: 746, matchedPinnedIdentities: 1, newRows: 1 } } });
    expect(JSON.stringify(delta)).toBe(before);
  });
  it('rejects reused mapping and observation IDs, missing parents, and reserved cloud IDs', () => {
    const source = fixture();
    expect(() => auditDeltaAgainstSnapshot(source, [batch('episode_provider_mappings', [{ ...mapping, version_id: 99 }])])).toThrow('identity collision');
    expect(() => auditDeltaAgainstSnapshot(source, [batch('verification_observations', [{ ...observation, entity_id: 'other' }])])).toThrow('identity collision');
    expect(() => auditDeltaAgainstSnapshot(source, [batch('episode_versions', [{ ...version, id: 21, episode_id: 99 }])])).toThrow('episode absent');
    expect(() => auditDeltaAgainstSnapshot(source, [batch('verification_observations', [{ ...observation, id: 1_000_000_001 }])])).toThrow('reserved cloud-generated range');
  });
});
