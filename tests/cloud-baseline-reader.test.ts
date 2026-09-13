import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createPrivateBaselineReader, type BaselineAssets } from '../server/cloud/data/baseline.ts';
import { baselineHashBucket, baselinePath, type BaselineFileRef, type BaselineManifest } from '../server/cloud/data/baseline-schema.ts';

const id = 'a'.repeat(64);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function fixture() {
  const files = new Map<string, string>(), calls: string[] = [];
  const refs: Record<string, BaselineFileRef> = {};
  const put = (relative: string, value: unknown) => {
    const path = baselinePath(id, relative), body = JSON.stringify(value); files.set(path, body);
    const ref = { path, bytes: Buffer.byteLength(body), sha256: hash(body) }; refs[path] = ref; return ref;
  };
  const title = { id: '1', slug: 'test-title', name: 'Test title', episodeCount: 1 };
  put('titles/000000.json', { 1: { collectionState: 'complete', title, aliases: [], genres: [], related: [], episodePages: [baselinePath(id, 'episode-pages/1/000000.json')] } });
  put(`slugs/${baselineHashBucket('test-title', 256)}.json`, { 'test-title': '1' });
  put('episode-pages/1/000000.json', { titleId: '1', page: 0, pageSize: 100, total: 1, episodes: [{ id: '2', number: '1', versions: [{ id: '3', language: 'sub', providerCount: 1 }] }] });
  put('episodes/000000.json', { 2: { titleId: '1', page: 0, episode: { id: '2', titleSlug: 'test-title' }, versions: [{ version: { id: '3', language: 'sub' }, providers: [{ mappingId: '4', providerId: 'external' }] }] } });
  put('mappings/000000.json', { 4: { mapping: { mappingId: 4, providerId: 'external', label: 'Observed provider', language: 'sub', providerResourceId: 'stable-test-ref', canonicalEmbedUrl: null, availability: 'observed', unavailableReason: null }, provenance: { sourceMappingId: 'reference-4', mappingOrigin: null, firstSeen: null, lastSeen: null, lastSuccessfulImport: null, resourceOmittedReason: null } } });
  const browse = put('browse/000000.json', { 1: { ...title, aliases: ['Alias'], genres: ['drama'], languages: ['sub'], type: 'TV', status: null, releaseYear: 2020, updatedAt: null, card: { artworkUrl: null, synopsis: 'Test-only title' } } });
  const postings = put('indexes/postings.json', { episodeCounts: { '1': 1 }, genres: { drama: ['1'] }, types: { tv: ['1'] }, statuses: {}, languages: { sub: ['1'] }, orders: Object.fromEntries(['name', 'newest', 'oldest', 'updated', 'episodes'].map(key => [key, ['1']])) });
  const search = put('indexes/search.json', [['1', 'test title alias']]);
  const referenceShards: Record<string, BaselineFileRef> = {};
  for (let bucket = 0; bucket < 64; bucket++) {
    const key = bucket.toString(16).padStart(2, '0');
    const content = Object.fromEntries(Object.entries(refs).filter(([path]) => baselineHashBucket(path) === key));
    const path = baselinePath(id, `references/${key}.json`), body = JSON.stringify(content);
    files.set(path, body); referenceShards[key] = { path, bytes: Buffer.byteLength(body), sha256: hash(body) };
  }
  const manifest: BaselineManifest = { version: 1, kind: 'solanime-private-catalogue-baseline', id, createdAt: '2026-09-13T00:00:00Z', sourceDatabaseSha256: id, sourceSchemaVersion: 8, counts: { titles: 1, episodes: 1, versions: 1, mappings: 1 }, bucketSpans: { titles: 64, browse: 256, episodes: 64, mappings: 64 }, episodePageSize: 100, maxFileBytes: 262144, files: files.size + 1, aggregateFiles: files.size + 1, bytes: 10000, referenceShards, fastRefs: { [browse.path]: browse }, postings, search, facets: { genres: [{ value: 'drama', count: 1 }], types: [], languages: [], statuses: [] }, exclusions: ['accounts', 'temporary playback resolutions'] };
  const body = JSON.stringify(manifest); files.set(`/__private-baseline/${id}/manifest.json`, body);
  const pin = { id, manifestSha256: hash(body) };
  const assets: BaselineAssets = { async fetch(url, init) {
    calls.push(url); expect(init.redirect).toBe('manual');
    const parsed = new URL(url); expect(parsed.origin).toBe('https://assets.local');
    const value = files.get(parsed.pathname); return new Response(value ?? null, { status: value === undefined ? 404 : 200 });
  } };
  return { files, calls, refs, pin, assets, manifest };
}

describe('private catalogue baseline reader', () => {
  it('loads exact title, episode, version and mapping identities without enabling playback', async () => {
    const test = fixture(), reader = createPrivateBaselineReader(test.assets, test.pin);
    expect((await reader.titleBySlug('test-title'))?.title.id).toBe('1');
    expect((await reader.episodePage(1, 0))?.episodes[0].id).toBe('2');
    expect((await reader.episode(2))?.versions[0].providers[0].mappingId).toBe('4');
    const mapping = await reader.mapping(4);
    expect(mapping?.mapping.providerResourceId).toBe('stable-test-ref');
    expect(mapping).not.toHaveProperty('supported');
    expect(mapping).not.toHaveProperty('url');
    expect(await reader.mapping(5)).toBeNull();
  });
  it('combines shareable filters and alias search before paginating IDs', async () => {
    const test = fixture(), reader = createPrivateBaselineReader(test.assets, test.pin);
    const params = { page: 1, pageSize: 24, sort: 'name', genre: 'drama', type: 'TV', language: 'SUB', q: 'ALIAS' };
    expect((await reader.browseIds(params)).ids).toEqual(['1']);
    expect((await reader.browseIds({ ...params, language: 'dub' })).total).toBe(0);
    expect((await reader.browseIds({ ...params, page: 2 })).ids).toEqual([]);
  });
  it('uses inline browse references and deduplicates concurrent request reads', async () => {
    const test = fixture(), reader = createPrivateBaselineReader(test.assets, test.pin);
    const rows = await Promise.all([reader.browseRow(1), reader.browseRow(1)]);
    expect(rows[0]?.card.synopsis).toBe('Test-only title');
    expect(test.calls).toHaveLength(2);
    expect(reader.diagnostics().reads).toBe(2);
  });
  it('rejects an arbitrary URL pin before any asset request', () => {
    const test = fixture();
    expect(() => createPrivateBaselineReader(test.assets, { id: 'https://example.invalid', manifestSha256: test.pin.manifestSha256 })).toThrow();
    expect(test.calls).toHaveLength(0);
  });
  it('rejects modified payload bytes instead of turning corrupt data into an empty list', async () => {
    const test = fixture(); test.files.set(baselinePath(id, 'episodes/000000.json'), '{}');
    await expect(createPrivateBaselineReader(test.assets, test.pin).episode(2)).rejects.toMatchObject({ status: 503 });
  });
  it('rejects a modified manifest, missing reference shard and missing known asset', async () => {
    const corrupt = fixture(); corrupt.files.set(`/__private-baseline/${id}/manifest.json`, '{}');
    await expect(createPrivateBaselineReader(corrupt.assets, corrupt.pin).manifest()).rejects.toThrow();
    const missing = fixture(); missing.files.delete(baselinePath(id, 'mappings/000000.json'));
    await expect(createPrivateBaselineReader(missing.assets, missing.pin).mapping(4)).rejects.toThrow();
    const shard = fixture(); const key = baselineHashBucket(baselinePath(id, 'mappings/000000.json'));
    shard.files.delete(baselinePath(id, `references/${key}.json`));
    await expect(createPrivateBaselineReader(shard.assets, shard.pin).mapping(4)).rejects.toThrow();
  });
  it('bounds actual streamed bytes without trusting Content-Length', async () => {
    const test = fixture(); test.files.set(`/__private-baseline/${id}/manifest.json`, 'x'.repeat(262145));
    await expect(createPrivateBaselineReader(test.assets, test.pin).manifest()).rejects.toThrow();
  });
  it('respects cancellation and request read budgets', async () => {
    const test = fixture(), controller = new AbortController(); controller.abort();
    await expect(createPrivateBaselineReader(test.assets, test.pin, { signal: controller.signal }).manifest()).rejects.toThrow();
    expect(test.calls).toHaveLength(0);
    await expect(createPrivateBaselineReader(test.assets, test.pin, { maxReads: 1 }).episode(2)).rejects.toMatchObject({ status: 503 });
  });
  it('rejects invalid IDs and oversized pages', async () => {
    const test = fixture(), reader = createPrivateBaselineReader(test.assets, test.pin);
    await expect(reader.mapping('../private')).rejects.toMatchObject({ status: 400 });
    await expect(reader.episodePage(1, -1)).rejects.toMatchObject({ status: 400 });
    await expect(reader.browseIds({ page: 1, pageSize: 101, sort: 'name' })).rejects.toMatchObject({ status: 400 });
    expect(test.calls).toHaveLength(0);
  });
});
