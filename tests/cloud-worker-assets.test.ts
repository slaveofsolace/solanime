import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { baselineHashBucket, baselinePath, type BaselineFileRef, type BaselineManifest } from '../server/cloud/data/baseline-schema.ts';
import { stageWorkerAssets, type ReleasePins } from '../scripts/cloud-data/stage-worker-assets.ts';

const parent = resolve('../solanime-cloud-artifacts/tmp'); mkdirSync(parent, { recursive: true });
const root = mkdtempSync(join(parent, 'cloud-worker-assets-'));
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const put = (base: string, relative: string, value: string) => { const path = join(base, relative); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value); return path; };

function fixture() {
  const importRoot = join(root, crypto.randomUUID(), 'import');
  const baselineRoot = join(root, crypto.randomUUID(), 'baseline');
  const importId = 'a'.repeat(64), baselineId = 'b'.repeat(64);
  const bundleRelative = `__private-import/${importId}/bundles/000000.json`;
  const bundleBody = '{"fixture":true}'; put(importRoot, bundleRelative, bundleBody);
  const importManifest = { version: 1, kind: 'solanime-private-import', id: importId, sourceManifestSha256: importId, totalBatches: 1, totalRows: 1, totalEstimatedWrites: 1, catalogueCounts: {}, researchCounts: {}, bundles: [{ path: `/${bundleRelative}`, sha256: sha(bundleBody), bytes: Buffer.byteLength(bundleBody), startBatch: 0, batches: 1, rows: 1 }] };
  const importBody = JSON.stringify(importManifest); put(importRoot, `__private-import/${importId}/manifest.json`, importBody);

  const payloads = new Map<string, string>([
    [baselinePath(baselineId, 'titles/000000.json'), '{}'],
    [baselinePath(baselineId, 'indexes/postings.json'), '{"episodeCounts":{},"genres":{},"languages":{},"types":{},"statuses":{},"orders":{"name":[],"newest":[],"oldest":[],"updated":[],"episodes":[]}}'],
    [baselinePath(baselineId, 'indexes/search.json'), '[]'],
  ]);
  const groups = new Map<string, Record<string, BaselineFileRef>>();
  for (const [path, body] of payloads) {
    put(baselineRoot, path.slice(1), body);
    const key = baselineHashBucket(path), group = groups.get(key) ?? {};
    group[path] = { path, sha256: sha(body), bytes: Buffer.byteLength(body) }; groups.set(key, group);
  }
  const referenceShards: Record<string, BaselineFileRef> = {};
  for (const [key, values] of groups) {
    const path = baselinePath(baselineId, `references/${key}.json`), body = JSON.stringify(values);
    put(baselineRoot, path.slice(1), body); referenceShards[key] = { path, sha256: sha(body), bytes: Buffer.byteLength(body) };
  }
  const postingsPath = baselinePath(baselineId, 'indexes/postings.json'), searchPath = baselinePath(baselineId, 'indexes/search.json');
  const manifest: BaselineManifest = { version: 1, kind: 'solanime-private-catalogue-baseline', id: baselineId, createdAt: '2026-09-13T00:00:00Z', sourceDatabaseSha256: baselineId, sourceSchemaVersion: 10, counts: { titles: 0, episodes: 0, versions: 0, mappings: 0 }, bucketSpans: { titles: 512, browse: 512, episodes: 512, mappings: 512 }, episodePageSize: 100, maxFileBytes: 262_144, files: payloads.size + groups.size + 1, aggregateFiles: payloads.size + groups.size + 3, bytes: [...payloads.values()].reduce((sum, body) => sum + Buffer.byteLength(body), 0), referenceShards, fastRefs: {}, postings: { path: postingsPath, sha256: sha(payloads.get(postingsPath)!), bytes: Buffer.byteLength(payloads.get(postingsPath)!) }, search: { path: searchPath, sha256: sha(payloads.get(searchPath)!), bytes: Buffer.byteLength(payloads.get(searchPath)!) }, facets: { genres: [], types: [], statuses: [], languages: [] }, exclusions: ['test-only'] };
  const baselineBody = JSON.stringify(manifest); put(baselineRoot, `__private-baseline/${baselineId}/manifest.json`, baselineBody);
  const pins: ReleasePins = { importManifestPath: `/__private-import/${importId}/manifest.json`, importManifestSha256: sha(importBody), baselineId, baselineManifestSha256: sha(baselineBody) };
  return { importRoot, baselineRoot, pins, manifest };
}

afterAll(() => { if (!resolve(root).startsWith(`${parent}\\`) && !resolve(root).startsWith(`${parent}/`)) throw new Error('Refuse unsafe fixture cleanup.'); rmSync(root, { recursive: true, force: true }); });

describe('private Worker asset staging', () => {
  it('verifies both pins, hashes, counts and stages only reserved private namespaces', () => {
    const value = fixture(), output = join(root, crypto.randomUUID(), 'assets');
    const result = stageWorkerAssets(value.importRoot, value.baselineRoot, output, value.pins, 1_000);
    expect(result).toMatchObject({ files: value.manifest.aggregateFiles, reservedFiles: 1_000, baseline: { id: value.pins.baselineId, counts: value.manifest.counts }, import: { manifestSha256: value.pins.importManifestSha256 } });
    expect(readFileSync(join(output, value.pins.importManifestPath.slice(1)), 'utf8')).toContain('solanime-private-import');
    expect(readFileSync(join(output, `__private-baseline/${value.pins.baselineId}/manifest.json`), 'utf8')).toContain('solanime-private-catalogue-baseline');
    expect(() => stageWorkerAssets(value.importRoot, value.baselineRoot, output, value.pins)).toThrow('already exists');
  });

  it('refuses a mismatched configured pin before creating output', () => {
    const value = fixture(), output = join(root, crypto.randomUUID(), 'assets');
    expect(() => stageWorkerAssets(value.importRoot, value.baselineRoot, output, { ...value.pins, baselineManifestSha256: 'c'.repeat(64) })).toThrow('configured release pins');
  });
});
