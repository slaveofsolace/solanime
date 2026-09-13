import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { migrate } from '../server/db.ts';
import { prepareBaseline } from '../scripts/cloud-data/prepare-baseline.ts';
import { prepareBaselinePreview } from '../scripts/cloud-data/prepare-baseline-preview.ts';

const parent = resolve(process.env.SOLANIME_TEST_TMP || '../solanime-cloud-artifacts/tmp'); mkdirSync(parent, { recursive: true });
const root = mkdtempSync(join(parent, 'baseline-preview-'));
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const put = (base: string, relative: string, value: string) => { const path = join(base, relative); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value); };

function source() {
  const path = join(root, `${crypto.randomUUID()}.sqlite`), db = new DatabaseSync(path); migrate(db);
  const at = '2026-09-13T00:00:00Z';
  db.prepare('INSERT INTO titles(id,source_id,slug,canonical_url,name,format,first_seen_at,last_seen_at,created_at,updated_at) VALUES(1,?,?,?,?,?,?,?,?,?)').run('source-one', 'one', 'https://example.invalid/one', 'One', 'TV', at, at, at, at);
  db.close(); return path;
}

function imports() {
  const output = join(root, crypto.randomUUID(), 'imports'), id = 'a'.repeat(64), bundlePath = `/__private-import/${id}/bundles/000000.json`, bundle = '{"fixture":true}';
  put(output, bundlePath.slice(1), bundle);
  const manifest = { version: 1, kind: 'solanime-private-import', id, sourceManifestSha256: id, totalBatches: 1, totalRows: 1, totalEstimatedWrites: 1, catalogueCounts: {}, researchCounts: {}, bundles: [{ path: bundlePath, sha256: sha(bundle), bytes: Buffer.byteLength(bundle), startBatch: 0, batches: 1, rows: 1 }] };
  const manifestPath = `/__private-import/${id}/manifest.json`, body = JSON.stringify(manifest); put(output, manifestPath.slice(1), body);
  return { output, manifestPath, manifestSha256: sha(body) };
}

function config(path: string, imported: ReturnType<typeof imports>, name = 'solanime-api-preview') {
  const body = { name, main: '../../solanime-cloud/server/cloud/worker.ts', workers_dev: false, preview_urls: false, assets: { directory: './old-assets', binding: 'IMPORT_ASSETS', run_worker_first: true, html_handling: 'none', not_found_handling: 'none' }, vars: { IMPORT_MANIFEST_PATH: imported.manifestPath, IMPORT_MANIFEST_SHA256: imported.manifestSha256, CATALOGUE_BASELINE_ID: 'old', CATALOGUE_BASELINE_MANIFEST_SHA256: 'old', RELEASE_CHANNEL: 'preview', SYNC_ENABLED: 'true', SOURCE_REFRESH_ENABLED: 'true' }, d1_databases: [{ binding: 'CATALOGUE', database_name: 'preview', database_id: 'a'.repeat(36), migrations_dir: '../../solanime-cloud/migrations/cloud/catalogue' }] };
  writeFileSync(path, JSON.stringify(body)); return body;
}

afterAll(() => { const exact = resolve(root); if (!exact.startsWith(`${parent}\\`) && !exact.startsWith(`${parent}/`)) throw new Error('Refuse unsafe fixture cleanup.'); rmSync(exact, { recursive: true, force: true }); });

describe('completed baseline preview planning', () => {
  it('pins the source-matched baseline in a fresh preview-only package without changing SQLite or the base config', async () => {
    const database = source(), imported = imports(), baseline = join(root, crypto.randomUUID(), 'baseline');
    const before = sha(readFileSync(database)); const prepared = await prepareBaseline(database, baseline, { existingAssetFiles: 2 });
    const configPath = join(root, crypto.randomUUID(), 'wrangler.jsonc'); mkdirSync(dirname(configPath), { recursive: true }); const original = config(configPath, imported);
    const output = join(root, crypto.randomUUID(), 'plan');
    const result = await prepareBaselinePreview({ sourceDatabase: database, baselineAssets: baseline, importAssets: imported.output, output, config: configPath, expectedSourceSha256: before, expectedMappings: 0, previewAlias: 'complete-crawl' });
    expect(result.source).toMatchObject({ sha256: before });
    expect(result.baseline).toMatchObject({ manifestSha256: prepared.manifestSha256, counts: { titles: 1, mappings: 0 } });
    expect(result.d1WritesByPreparation).toBe(0); expect(result.commands.verifyOnly).toContain('--dry-run'); expect(result.commands.uploadPreviewVersionAfterReview).not.toContain('--dry-run');
    const generated = JSON.parse(readFileSync(result.preview.config, 'utf8'));
    expect(generated).toMatchObject({ name: 'solanime-api-preview', preview_urls: true, vars: { CATALOGUE_BASELINE_ID: before, CATALOGUE_BASELINE_MANIFEST_SHA256: prepared.manifestSha256, RELEASE_CHANNEL: 'preview', SOLANIME_REGISTRATION: 'closed', SYNC_ENABLED: 'false', SOURCE_REFRESH_ENABLED: 'false' } });
    expect(generated.assets.directory).toBe(resolve(output, 'worker-assets').replaceAll('\\', '/'));
    expect(sha(readFileSync(database))).toBe(before); expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual(original);
  });

  it('fails before publishing output for a wrong source identity, mapping denominator, or production Worker', async () => {
    const database = source(), imported = imports(), baseline = join(root, crypto.randomUUID(), 'baseline'); await prepareBaseline(database, baseline, { existingAssetFiles: 2 });
    const configPath = join(root, crypto.randomUUID(), 'wrangler.jsonc'); mkdirSync(dirname(configPath), { recursive: true }); config(configPath, imported);
    await expect(prepareBaselinePreview({ sourceDatabase: database, baselineAssets: baseline, importAssets: imported.output, output: join(root, crypto.randomUUID(), 'bad-hash'), config: configPath, expectedSourceSha256: 'f'.repeat(64) })).rejects.toThrow('SHA-256');
    await expect(prepareBaselinePreview({ sourceDatabase: database, baselineAssets: baseline, importAssets: imported.output, output: join(root, crypto.randomUUID(), 'bad-count'), config: configPath, expectedMappings: 423_236 })).rejects.toThrow('mapping count');
    const productionConfig = join(root, crypto.randomUUID(), 'wrangler.jsonc'); mkdirSync(dirname(productionConfig), { recursive: true }); config(productionConfig, imported, 'solanime-api');
    await expect(prepareBaselinePreview({ sourceDatabase: database, baselineAssets: baseline, importAssets: imported.output, output: join(root, crypto.randomUUID(), 'production'), config: productionConfig })).rejects.toThrow('preview-named');
  });
});
