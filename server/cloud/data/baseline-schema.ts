import type { StoredProviderMapping } from '../../providers/contract.ts';

/** Private immutable read model. Coverage is not D1 hydration or playback verification. */
export const BASELINE_VERSION = 1;
export const BASELINE_BUCKET_SIZE = 64;
export const BASELINE_MAX_BUCKET_SIZE = 512;
export const BASELINE_EPISODE_PAGE_SIZE = 100;
export const BASELINE_MAX_FILE_BYTES = 256 * 1024;
export const BASELINE_MAX_INDEX_BYTES = 2 * 1024 * 1024;
export const BASELINE_MAX_FILES = 20_000;
export const BASELINE_REFERENCE_SHARDS = 64;
export type BaselineRow = Record<string, unknown>;
export interface BaselineFileRef { path: string; sha256: string; bytes: number; }
export interface BaselineManifest {
  version: 1; kind: 'solanime-private-catalogue-baseline'; id: string; createdAt: string;
  sourceDatabaseSha256: string; sourceSchemaVersion: number; counts: Record<string, number>;
  bucketSpans: Record<'titles' | 'browse' | 'episodes' | 'mappings', number>; episodePageSize: 100; maxFileBytes: number;
  files: number; aggregateFiles: number; bytes: number;
  referenceShards: Record<string, BaselineFileRef>;
  fastRefs: Record<string, BaselineFileRef>;
  postings: BaselineFileRef; search: BaselineFileRef;
  facets: { genres: BaselineRow[]; types: BaselineRow[]; statuses: BaselineRow[]; languages: BaselineRow[] };
  exclusions: string[];
}
export interface BaselineTitle {
  collectionState: 'complete' | 'partial' | 'pending'; title: BaselineRow;
  aliases: BaselineRow[]; genres: BaselineRow[]; related: BaselineRow[];
  episodePages: string[];
}
export interface BaselineEpisodePage { titleId: string; page: number; pageSize: 100; total: number; episodes: BaselineRow[]; }
export interface BaselineEpisode {
  titleId: string; page: number; episode: BaselineRow;
  versions: Array<{ version: BaselineRow; providers: BaselineRow[] }>;
}
export interface BaselineMapping {
  mapping: StoredProviderMapping;
  provenance: { sourceMappingId: string | null; mappingOrigin: string | null; firstSeen: string | null; lastSeen: string | null; lastSuccessfulImport: string | null; resourceOmittedReason: string | null };
}
export interface BaselineBrowseRow {
  id: string; slug: string; name: string; aliases: string[]; genres: string[];
  type: string | null; status: string | null; languages: string[]; episodeCount: number;
  releaseYear: number | null; updatedAt: string | null;
  card: BaselineRow;
}
export interface BaselinePostings {
  genres: Record<string, string[]>; languages: Record<string, string[]>; types: Record<string, string[]>; statuses: Record<string, string[]>;
  orders: Record<'name' | 'newest' | 'oldest' | 'updated' | 'episodes', string[]>;
  /** Complete immutable baseline counts; never derive these from partially hydrated D1. */
  episodeCounts: Record<string, number>;
}
export type BaselineSearchIndex = Array<[id: string, normalizedNames: string]>;
export function baselineHashBucket(value: string, buckets = BASELINE_REFERENCE_SHARDS): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return ((hash >>> 0) % buckets).toString(16).padStart(2, '0');
}
export function baselineNumericBucket(id: number | string, span = BASELINE_BUCKET_SIZE): string {
  const number = Number(id);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('Baseline identifiers must be positive safe integers.');
  if (!Number.isSafeInteger(span) || span < 1 || span > 512) throw new Error('Invalid baseline bucket span.');
  return Math.floor(number / span).toString().padStart(6, '0');
}
export function baselinePath(id: string, relative: string): string {
  if (!/^[a-f0-9]{64}$/.test(id) || !/^(titles|browse|episodes|mappings)\/[0-9]{6,}\.json$|^slugs\/[a-f0-9]{2}\.json$|^episode-pages\/[1-9][0-9]*\/[0-9]{6}\.json$|^references\/[a-f0-9]{2}\.json$|^indexes\/(postings|search)\.json$/.test(relative)) throw new Error('Invalid private baseline path.');
  return `/__private-baseline/${id}/${relative}`;
}
export function validateBaselineManifest(value: unknown): BaselineManifest {
  const item = value as BaselineManifest;
  if (!item || item.version !== 1 || item.kind !== 'solanime-private-catalogue-baseline' || !/^[a-f0-9]{64}$/.test(item.id) || item.id !== item.sourceDatabaseSha256 || !item.bucketSpans || Object.values(item.bucketSpans).some(span => !Number.isSafeInteger(span) || span < 1 || span > BASELINE_MAX_BUCKET_SIZE) || item.episodePageSize !== 100 || !Number.isSafeInteger(item.files) || item.files < 1 || !Number.isSafeInteger(item.aggregateFiles) || item.aggregateFiles < item.files || item.aggregateFiles > BASELINE_MAX_FILES || !Number.isSafeInteger(item.maxFileBytes) || item.maxFileBytes > BASELINE_MAX_FILE_BYTES || !item.referenceShards || !item.counts || !item.facets) throw new Error('Invalid private baseline manifest.');
  for (const [key, ref] of Object.entries(item.referenceShards)) if (!/^[a-f0-9]{2}$/.test(key) || ref.path !== baselinePath(item.id, `references/${key}.json`) || !/^[a-f0-9]{64}$/.test(ref.sha256) || !Number.isSafeInteger(ref.bytes) || ref.bytes < 1 || ref.bytes > BASELINE_MAX_FILE_BYTES) throw new Error('Invalid baseline reference shard.');
  if (!Object.keys(item.referenceShards).length || Object.keys(item.referenceShards).length > 64 || !item.fastRefs || !Number.isSafeInteger(item.sourceSchemaVersion) || item.sourceSchemaVersion < 1 || Object.values(item.counts).some(count => !Number.isSafeInteger(count) || count < 0)) throw new Error('Invalid baseline counts or references.');
  for (const [kind, ref] of [['postings',item.postings],['search',item.search]] as const) if (!ref || ref.path !== baselinePath(item.id,`indexes/${kind}.json`) || !/^[a-f0-9]{64}$/.test(ref.sha256) || !Number.isSafeInteger(ref.bytes) || ref.bytes < 1 || ref.bytes > BASELINE_MAX_INDEX_BYTES) throw new Error('Invalid baseline search or postings index.');
  for (const [path,ref] of Object.entries(item.fastRefs)) if (!path.startsWith(`/__private-baseline/${item.id}/browse/`) || path !== ref.path || !/^[a-f0-9]{64}$/.test(ref.sha256) || !Number.isSafeInteger(ref.bytes) || ref.bytes < 1 || ref.bytes > BASELINE_MAX_FILE_BYTES || baselinePath(item.id,path.split(`/${item.id}/`)[1]) !== path) throw new Error('Invalid baseline fast reference.');
  return item;
}
