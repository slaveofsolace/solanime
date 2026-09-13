import { AppError } from '../../errors.ts';
import { isCatalogueScope, sourcesForCatalogueScope } from '../../../shared/catalogue-scope.ts';
import type { BrowseParams } from '../../catalogue.ts';
import type { AvailabilityState } from '../../types.ts';
import {
  BASELINE_MAX_FILE_BYTES, BASELINE_MAX_INDEX_BYTES, baselineHashBucket, baselineNumericBucket,
  baselinePath, validateBaselineManifest,
  type BaselineBrowseRow, type BaselineEpisode, type BaselineEpisodePage, type BaselineFileRef,
  type BaselineManifest, type BaselineMapping, type BaselinePostings, type BaselineTitle,
} from './baseline-schema.ts';

/** Structural subset shared by the Workers asset binding and deterministic Node tests. */
export interface BaselineAssets {
  fetch(input: string, init: { redirect: 'manual' }): Promise<{
    status: number; headers: { get(name: string): string | null };
    body: { getReader(): {
      read(): Promise<{ done?: boolean; value?: Uint8Array }>;
      cancel(): Promise<unknown>; releaseLock(): void;
    } } | null;
  }>;
}
export interface BaselinePin { id: string; manifestSha256: string; }
const changed = () => new AppError(503, 'UNAVAILABLE', 'The catalogue snapshot failed verification. Existing records have not been changed.');
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const own = (value: Record<string, unknown>, key: string) => Object.hasOwn(value, key) ? value[key] : undefined;
const rowList = (value: unknown): Record<string, unknown>[] => {
  if (!Array.isArray(value) || !value.every(record)) throw changed();
  return value;
};
const strings = (value: unknown): string[] => {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) throw changed();
  return value;
};
const nullableString = (value: unknown): string | null => {
  if (value !== null && typeof value !== 'string') throw changed();
  return value;
};
const availability = (value: unknown): AvailabilityState => {
  if (value !== 'observed' && value !== 'available' && value !== 'unavailable' && value !== 'blocked' && value !== 'stale' && value !== 'unknown') throw changed();
  return value;
};
const positiveId = (value: number | string) => {
  if (!/^[1-9][0-9]*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new AppError(400, 'INVALID_QUERY', 'Invalid catalogue identifier.');
  return String(value);
};
const digest = async (bytes: Uint8Array<ArrayBuffer>) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');

/** Request-scoped reader. No arbitrary network URLs, public raw exports, or cross-request promises. */
export function createPrivateBaselineReader(assets: BaselineAssets, pin: BaselinePin, options: { signal?: AbortSignal; maxReads?: number; maxBytes?: number } = {}) {
  if (!/^[a-f0-9]{64}$/.test(pin.id) || !/^[a-f0-9]{64}$/.test(pin.manifestSha256)) throw changed();
  const maxReads = options.maxReads ?? 40;
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  if (!Number.isSafeInteger(maxReads) || maxReads < 1 || maxReads > 40 || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 8 * 1024 * 1024) throw changed();
  let reads = 0, bytesRead = 0;
  const memo = new Map<string, Promise<unknown>>();
  const manifestPath = `/__private-baseline/${pin.id}/manifest.json`;
  const checkAbort = () => options.signal?.throwIfAborted();

  async function read(path: string, hash: string, maximum: number, expectedBytes?: number): Promise<unknown> {
    checkAbort();
    if (!/^[a-f0-9]{64}$/.test(hash)) throw changed();
    if (path !== manifestPath) {
      const prefix = `/__private-baseline/${pin.id}/`;
      if (!path.startsWith(prefix) || baselinePath(pin.id, path.slice(prefix.length)) !== path) throw changed();
    }
    const cacheKey = `${path}:${hash}`;
    const cached = memo.get(cacheKey); if (cached) return cached;
    const pending = (async () => {
      if (++reads > maxReads) throw new AppError(503, 'UNAVAILABLE', 'This catalogue request exceeded its bounded read allowance. Try a smaller page.');
      const response = await assets.fetch(`https://assets.local${path}`, { redirect: 'manual' });
      checkAbort();
      if (response.status !== 200 || !response.body) throw changed();
      const declared = response.headers.get('content-length');
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) throw changed();
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
      try {
        for (;;) {
          checkAbort(); const chunk = await reader.read(); if (chunk.done) break;
          if (!chunk.value) throw changed();
          length += chunk.value.byteLength; bytesRead += chunk.value.byteLength;
          if (length > maximum || bytesRead > maxBytes) throw changed();
          chunks.push(chunk.value);
        }
      } catch (error) { await reader.cancel().catch(() => {}); throw error; }
      finally { reader.releaseLock(); }
      if (expectedBytes !== undefined && length !== expectedBytes) throw changed();
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      if (await digest(bytes) !== hash) throw changed();
      checkAbort();
      try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; }
      catch { throw changed(); }
    })();
    memo.set(cacheKey, pending);
    return pending;
  }
  async function manifest(): Promise<BaselineManifest> {
    const value = await read(manifestPath, pin.manifestSha256, BASELINE_MAX_FILE_BYTES);
    try { const result = validateBaselineManifest(value); if (result.id !== pin.id) throw changed(); return result; }
    catch { throw changed(); }
  }
  function validRef(value: unknown, path: string, maximum: number): BaselineFileRef {
    if (!record(value) || value.path !== path || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256) || !Number.isSafeInteger(value.bytes) || Number(value.bytes) < 1 || Number(value.bytes) > maximum) throw changed();
    return { path, sha256: value.sha256, bytes: Number(value.bytes) };
  }
  async function data(relative: string): Promise<unknown | null> {
    const info = await manifest(); const path = baselinePath(pin.id, relative);
    const fast = info.fastRefs?.[path];
    if (fast) {
      const ref = validRef(fast, path, BASELINE_MAX_FILE_BYTES);
      return read(ref.path, ref.sha256, BASELINE_MAX_FILE_BYTES, ref.bytes);
    }
    const key = baselineHashBucket(path);
    const shardRef = info.referenceShards[key];
    // A checksummed sparse manifest can omit an entirely empty reference bucket.
    // A listed bucket whose payload is missing still fails verification below.
    if (!shardRef) return null;
    const checked = validRef(shardRef, baselinePath(pin.id, `references/${key}.json`), BASELINE_MAX_FILE_BYTES);
    const references = await read(checked.path, checked.sha256, BASELINE_MAX_FILE_BYTES, checked.bytes);
    if (!record(references)) throw changed();
    const value = own(references, path);
    if (value === undefined) return null;
    const ref = validRef(value, path, BASELINE_MAX_FILE_BYTES);
    return read(ref.path, ref.sha256, BASELINE_MAX_FILE_BYTES, ref.bytes);
  }
  async function entry(kind: 'titles' | 'browse' | 'episodes' | 'mappings', value: number | string): Promise<unknown | null> {
    const id = positiveId(value); const info = await manifest();
    const values = await data(`${kind}/${baselineNumericBucket(id, info.bucketSpans[kind])}.json`);
    if (values === null) return null;
    if (!record(values)) throw changed();
    return own(values, id) ?? null;
  }
  async function titleById(value: number | string): Promise<BaselineTitle | null> {
    const id = positiveId(value); const item = await entry('titles', id);
    if (item === null) return null;
    if (!record(item) || !record(item.title) || String(item.title.id) !== id || !['complete', 'partial', 'pending'].includes(String(item.collectionState)) || !Array.isArray(item.aliases) || !Array.isArray(item.genres) || !Array.isArray(item.related) || !Array.isArray(item.episodePages) || item.episodePages.some(path => typeof path !== 'string')) throw changed();
    const state = item.collectionState;
    if (state !== 'complete' && state !== 'partial' && state !== 'pending') throw changed();
    return { collectionState: state, title: item.title, aliases: rowList(item.aliases), genres: rowList(item.genres), related: rowList(item.related), episodePages: strings(item.episodePages) };
  }
  async function titleBySlug(slug: string): Promise<BaselineTitle | null> {
    if (!slug || slug.length > 200 || /[\x00-\x1f\x7f]/.test(slug)) throw new AppError(400, 'INVALID_QUERY', 'Invalid title slug.');
    const values = await data(`slugs/${baselineHashBucket(slug, 256)}.json`);
    if (values === null) return null;
    if (!record(values)) throw changed();
    const id = own(values, slug); if (id === undefined) return null;
    if (typeof id !== 'string' && typeof id !== 'number') throw changed();
    const title = await titleById(id); if (!title || title.title.slug !== slug) throw changed();
    return title;
  }
  async function episodePage(value: number | string, page: number): Promise<BaselineEpisodePage | null> {
    const id = positiveId(value);
    if (!Number.isSafeInteger(page) || page < 0 || page > 100_000) throw new AppError(400, 'INVALID_QUERY', 'Invalid episode page.');
    const item = await data(`episode-pages/${id}/${String(page).padStart(6, '0')}.json`);
    if (item === null) return null;
    if (!record(item) || String(item.titleId) !== id || item.page !== page || item.pageSize !== 100 || !Number.isSafeInteger(item.total) || Number(item.total) < 0 || !Array.isArray(item.episodes) || item.episodes.length > 100 || item.episodes.some(row => !record(row) || !/^[1-9][0-9]*$/.test(String(row.id)))) throw changed();
    return { titleId: id, page, pageSize: 100, total: Number(item.total), episodes: item.episodes };
  }
  async function episode(value: number | string): Promise<BaselineEpisode | null> {
    const id = positiveId(value); const item = await entry('episodes', id);
    if (item === null) return null;
    if (!record(item) || !record(item.episode) || String(item.episode.id) !== id || typeof item.titleId !== 'string' || !Number.isSafeInteger(item.page) || !Array.isArray(item.versions) || item.versions.some(row => !record(row) || !record(row.version) || !Array.isArray(row.providers))) throw changed();
    return { titleId: item.titleId, page: Number(item.page), episode: item.episode, versions: item.versions.map(row => {
      if (!record(row) || !record(row.version)) throw changed();
      return { version: row.version, providers: rowList(row.providers) };
    }) };
  }
  async function mapping(value: number | string): Promise<BaselineMapping | null> {
    const id = positiveId(value); const item = await entry('mappings', id);
    if (item === null) return null;
    if (!record(item) || !record(item.mapping) || String(item.mapping.mappingId) !== id || typeof item.mapping.providerId !== 'string' || typeof item.mapping.language !== 'string' || typeof item.mapping.label !== 'string' || !record(item.provenance)) throw changed();
    const source = item.mapping, origin = item.provenance;
    return { mapping: { mappingId: Number(id), providerId: String(source.providerId), language: String(source.language), label: String(source.label), providerResourceId: nullableString(source.providerResourceId), canonicalEmbedUrl: nullableString(source.canonicalEmbedUrl), availability: availability(source.availability), unavailableReason: nullableString(source.unavailableReason) }, provenance: { sourceMappingId: nullableString(origin.sourceMappingId), mappingOrigin: nullableString(origin.mappingOrigin), firstSeen: nullableString(origin.firstSeen), lastSeen: nullableString(origin.lastSeen), lastSuccessfulImport: nullableString(origin.lastSuccessfulImport), resourceOmittedReason: nullableString(origin.resourceOmittedReason) } };
  }
  async function browseRow(value: number | string): Promise<BaselineBrowseRow | null> {
    const id = positiveId(value); const item = await entry('browse', id);
    if (item === null) return null;
    if (!record(item) || item.id !== id || typeof item.name !== 'string' || typeof item.slug !== 'string') throw changed();
    if (!Number.isSafeInteger(item.episodeCount) || Number(item.episodeCount) < 0 || (item.releaseYear !== null && !Number.isSafeInteger(item.releaseYear)) || !record(item.card)) throw changed();
    const source = typeof item.source === 'string' && item.source
      ? item.source
      : typeof item.card.source === 'string' && item.card.source
        ? item.card.source
        : 'anikoto';
    return { id, source, name: item.name, slug: item.slug, aliases: strings(item.aliases), genres: strings(item.genres), languages: strings(item.languages), type: nullableString(item.type), status: nullableString(item.status), episodeCount: Number(item.episodeCount), releaseYear: item.releaseYear === null ? null : Number(item.releaseYear), updatedAt: nullableString(item.updatedAt), card: item.card };
  }
  async function browseIds(params: BrowseParams, window?: { offset: number; limit: number }) {
    if (!Number.isSafeInteger(params.page) || params.page < 1 || params.page > 100_000 || !Number.isSafeInteger(params.pageSize) || params.pageSize < 1 || params.pageSize > 100 || (params.q?.length ?? 0) > 200) throw new AppError(400, 'INVALID_QUERY', 'Invalid catalogue page.');
    if (window && (!Number.isSafeInteger(window.offset) || window.offset < 0 || !Number.isSafeInteger(window.limit) || window.limit < 1 || window.limit > 10_000_000)) throw new AppError(400, 'INVALID_QUERY', 'Invalid catalogue window.');
    const info = await manifest(); const ref = validRef(info.postings, baselinePath(pin.id, 'indexes/postings.json'), BASELINE_MAX_INDEX_BYTES);
    const postings = await read(ref.path, ref.sha256, BASELINE_MAX_INDEX_BYTES, ref.bytes);
    if (!record(postings) || !record(postings.orders)) throw changed();
    const names: Record<string, keyof BaselinePostings['orders']> = { name: 'name', title: 'name', newest: 'newest', year_desc: 'newest', oldest: 'oldest', year_asc: 'oldest', updated: 'updated', episodes: 'episodes' };
    const order = own(postings.orders, names[params.sort] ?? 'name');
    if (!Array.isArray(order) || order.some(id => typeof id !== 'string')) throw changed();
    let ids: string[] = order;
    if (params.scope) {
      if (!isCatalogueScope(params.scope)) throw new AppError(400, 'INVALID_QUERY', 'Catalogue scope must be all, anime, tv, or movies.');
      const requestedSources = sourcesForCatalogueScope(params.scope);
      const sources = own(postings, 'sources');
      if (sources === undefined) {
        if (params.scope !== 'anime' && params.scope !== 'all') ids = [];
      } else {
        if (!record(sources)) throw changed();
        if (requestedSources.length) {
          const accepted = new Set<string>();
          for (const source of requestedSources) {
            const values = own(sources, source) ?? [];
            if (!Array.isArray(values) || values.some(id => typeof id !== 'string')) throw changed();
            for (const id of values) accepted.add(id);
          }
          ids = ids.filter(id => accepted.has(id));
        }
      }
    }
    const scopedIds = new Set(ids);
    const scopedFacets = params.scope
      ? Object.fromEntries((['genres', 'types', 'statuses', 'languages'] as const).map(kind => {
          const group = own(postings, kind);
          if (!record(group)) throw changed();
          return [kind, info.facets[kind].map(row => {
            const value = String(row.value ?? '');
            const values = own(group, value) ?? [];
            if (!Array.isArray(values) || values.some(id => typeof id !== 'string')) throw changed();
            return { ...row, count: values.reduce((count, id) => count + Number(scopedIds.has(id)), 0) };
          }).filter(row => Number(row.count) > 0)];
        }))
      : info.facets;
    for (const [kind, value] of [['genres', params.genre], ['types', params.type?.toLowerCase()], ['statuses', params.status?.toLowerCase()], ['languages', params.language?.toLowerCase()]] as const) {
      if (!value) continue; const group = own(postings, kind); if (!record(group)) throw changed();
      const values = own(group, value) ?? []; if (!Array.isArray(values) || values.some(id => typeof id !== 'string')) throw changed();
      const accepted = new Set(values); ids = ids.filter(id => accepted.has(id));
    }
    if (params.q) {
      const searchRef = validRef(info.search, baselinePath(pin.id, 'indexes/search.json'), BASELINE_MAX_INDEX_BYTES);
      const index = await read(searchRef.path, searchRef.sha256, BASELINE_MAX_INDEX_BYTES, searchRef.bytes);
      if (!Array.isArray(index) || index.some(row => !Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string' || typeof row[1] !== 'string')) throw changed();
      const query = params.q.toLowerCase(); const accepted = new Set(index.filter(row => row[1].includes(query)).map(row => row[0]));
      ids = ids.filter(id => accepted.has(id));
    }
    const total = ids.length;
    const offset = window?.offset ?? (params.page - 1) * params.pageSize;
    const limit = window?.limit ?? params.pageSize;
    const selected = ids.slice(offset, offset + limit);
    if (!record(postings.episodeCounts)) throw changed();
    const episodeCounts: Record<string, number> = {};
    for (const id of selected) {
      const count = own(postings.episodeCounts, id);
      if (!Number.isSafeInteger(count) || Number(count) < 0) throw changed();
      episodeCounts[id] = Number(count);
    }
    return { ids: selected, episodeCounts, total, page: params.page, pageSize: params.pageSize, pages: Math.ceil(total / params.pageSize), facets: scopedFacets };
  }
  return { manifest, titleById, titleBySlug, episodePage, episode, mapping, browseRow, browseIds, diagnostics: () => ({ reads, bytesRead }) };
}
