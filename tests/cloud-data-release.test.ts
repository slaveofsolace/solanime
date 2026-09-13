import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bundledSchemaVersions, migrate, openDatabase, type SqliteDatabase } from '../server/db.ts';
import { captureCoverage } from '../server/ingestion/anikoto.ts';
import { createRun, enqueueTask } from '../server/ingestion/queue.ts';
import { publicExportManifest } from '../scripts/cloud-data/export-manifest.ts';
import { captureReleaseCoverage } from '../scripts/cloud-data/release-snapshot.ts';

let db: SqliteDatabase;
beforeEach(() => { db = openDatabase(':memory:'); migrate(db); });
afterEach(() => db.close());

describe('release coverage and publication manifest', () => {
  it('uses an allowlist instead of publishing private run metadata or raw errors', () => {
    const run = createRun(db, 'full');
    db.prepare('UPDATE crawl_runs SET worker_id=?,checkpoint_json=? WHERE id=?').run('PRIVATE_WORKER_ID', '{"privatePath":"PRIVATE_CHECKPOINT"}', run);
    enqueueTask(db, run, 'test:private', 'episode_servers', { reference: 'PRIVATE_REFERENCE' });
    db.prepare('UPDATE crawl_tasks SET last_error_message=? WHERE run_id=?').run('PRIVATE_ERROR_TEXT', run);
    captureCoverage(db, run);
    const manifest = publicExportManifest(db, '2026-09-12T00:00:00.000Z');
    expect(manifest.schemaVersion).toBe(Math.max(...bundledSchemaVersions()));
    expect(manifest.status.mappingCoverage).toEqual({ sourceMappings: 0, externalMappings: 0, playbackVerifiedMappings: 0 });
    expect(JSON.stringify(manifest)).not.toMatch(/PRIVATE_|worker_id|checkpoint_json|last_error_message|payload_json/);
    expect(manifest.status.counts).toMatchObject({ titles: 0, pendingTasks: 1 });
    expect(manifest.scope).toContain('individually recorded mappings');
  });

  it('appends a fresh snapshot while preserving all history and expired task claims', () => {
    const run = createRun(db, 'full');
    enqueueTask(db, run, 'episode:expired', 'episode_servers', {});
    db.prepare("UPDATE crawl_tasks SET status='running',claimed_by='old-worker',lease_expires_at='2020-01-01T00:00:00.000Z' WHERE run_id=?").run(run);
    db.prepare("UPDATE crawl_runs SET worker_id='old-worker',worker_heartbeat_at='2020-01-01T00:00:00.000Z' WHERE id=?").run(run);
    captureCoverage(db, run);
    const old = db.prepare('SELECT * FROM coverage_snapshots ORDER BY id').all();
    const task = db.prepare('SELECT * FROM crawl_tasks').get();
    const result = captureReleaseCoverage(db, run);
    expect(result.previousSnapshots).toBe(1);
    expect(db.prepare('SELECT * FROM coverage_snapshots WHERE id=1').get()).toEqual(old[0]);
    expect(db.prepare('SELECT * FROM crawl_tasks').get()).toEqual(task);
    expect(result.coverage).toMatchObject({ pending: 1, imported_mappings: 0 });
    expect(result.coverage?.denominator_scope).toContain('0 original source mappings plus 0 approved external native mappings');
  });

  it('refuses an active ingestion lease without appending coverage', () => {
    const run = createRun(db, 'full');
    db.prepare('UPDATE crawl_runs SET worker_id=?,worker_heartbeat_at=? WHERE id=?').run('active-test-worker', new Date().toISOString(), run);
    expect(() => captureReleaseCoverage(db, run)).toThrow('lease is active');
    expect(db.prepare('SELECT COUNT(*) AS count FROM coverage_snapshots').get()?.count).toBe(0);
  });

  it('refuses a missing or invalid run without fabricating its denominator', () => {
    expect(() => captureReleaseCoverage(db, 999)).toThrow('does not exist');
    expect(() => captureReleaseCoverage(db, NaN)).toThrow('valid existing run');
    expect(db.prepare('SELECT COUNT(*) AS count FROM coverage_snapshots').get()?.count).toBe(0);
  });
});
