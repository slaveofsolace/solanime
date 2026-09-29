import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  AdaptiveRequestScheduler,
  DEFAULT_YOUTUBE_SHARD_COUNT,
  OFFICIAL_YOUTUBE_MATCHER_REVISION,
  OfficialYouTubeCatalogueMatcher,
  PublicYouTubeMetadataClient,
  inventoryOfficialPublisherSource,
  isFullEpisodeCandidate,
  loadOfficialYouTubeCatalogue,
  probeOfficialYouTubeShard,
  stableShard,
  validateOfficialYouTubeDiscoveryConfig,
  type OfficialYouTubeDiscoveryConfig,
  type OfficialPublisherSource,
  type ProbeShardCheckpoint,
  type SourceInventoryCheckpoint,
} from '../server/ingestion/youtubeOfficialDiscovery.ts';

interface Args {
  config: string;
  catalogue: string;
  out: string;
  phase: 'inventory' | 'probe' | 'all';
  shardCount: number;
  workerStart: number;
  workerEnd: number;
  source: string | null;
  globalConcurrency: number;
  perHostConcurrency: number;
  requestsPerSecond: number;
  burst: number;
  requestBudget: number;
  probeBudget: number;
  maxPages: number;
  observationRegion: string;
}

const root = resolve(import.meta.dirname, '..');
const canonicalCatalogue = resolve(root, 'data', 'solanime.sqlite').toLowerCase();

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function positiveInteger(name: string, fallback: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const raw = option(name);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`INVALID_${name.toUpperCase().replaceAll('-', '_')}`);
  return value;
}

function positiveNumber(name: string, fallback: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const raw = option(name);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > maximum) throw new Error(`INVALID_${name.toUpperCase().replaceAll('-', '_')}`);
  return value;
}

function parseArgs(): Args {
  const config = resolve(option('config') ?? resolve(root, 'config', 'official-youtube-discovery.json'));
  const catalogueRaw = option('catalogue');
  const outRaw = option('out');
  if (!catalogueRaw) throw new Error('CATALOGUE_PATH_REQUIRED');
  if (!outRaw) throw new Error('OUTPUT_PATH_REQUIRED');
  const catalogue = resolve(catalogueRaw);
  const out = resolve(outRaw);
  if (catalogue.toLowerCase() === canonicalCatalogue) throw new Error('CANONICAL_CATALOGUE_REFUSED');
  const repoRelative = relative(root, out);
  if (!repoRelative.startsWith('..') && !isAbsolute(repoRelative)) throw new Error('OUTPUT_MUST_BE_OUTSIDE_REPOSITORY');
  if (!existsSync(catalogue)) throw new Error('CATALOGUE_NOT_FOUND');
  const phase = option('phase') ?? 'all';
  if (!['inventory', 'probe', 'all'].includes(phase)) throw new Error('INVALID_PHASE');
  const shardCount = positiveInteger('shard-count', DEFAULT_YOUTUBE_SHARD_COUNT, 10_000);
  const range = option('worker-range');
  const workerIndex = option('worker-index');
  let workerStart = 0;
  let workerEnd = shardCount - 1;
  if (workerIndex !== undefined) workerStart = workerEnd = Number(workerIndex);
  if (range) {
    const match = range.match(/^(\d+)-(\d+)$/);
    if (!match) throw new Error('INVALID_WORKER_RANGE');
    workerStart = Number(match[1]);
    workerEnd = Number(match[2]);
  }
  if (!Number.isSafeInteger(workerStart) || !Number.isSafeInteger(workerEnd) || workerStart < 0 || workerEnd < workerStart || workerEnd >= shardCount)
    throw new Error('INVALID_WORKER_RANGE');
  return {
    config, catalogue, out, phase: phase as Args['phase'], shardCount, workerStart, workerEnd,
    source: option('source') ?? null,
    globalConcurrency: positiveInteger('global-concurrency', 2, 32),
    perHostConcurrency: positiveInteger('per-host-concurrency', 1, 8),
    requestsPerSecond: positiveNumber('requests-per-second', .75, 10),
    burst: positiveInteger('burst', 1, 16),
    requestBudget: positiveInteger('request-budget', 20_000, 1_000_000),
    probeBudget: positiveInteger('probe-budget', 5_000, 1_000_000),
    maxPages: positiveInteger('max-pages', 500, 10_000),
    observationRegion: option('observation-region') ?? 'runtime-network',
  };
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function atomicJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'w' });
  renameSync(temp, path);
}

async function withLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  mkdirSync(dirname(path), { recursive: true });
  let descriptor: number;
  try { descriptor = openSync(path, 'wx'); } catch { throw new Error(`SHARD_ALREADY_OWNED:${path}`); }
  writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
  closeSync(descriptor);
  try { return await operation(); } finally { rmSync(path, { force: true }); }
}

function isOwned(shard: number, args: Args): boolean {
  return shard >= args.workerStart && shard <= args.workerEnd;
}

function inventoryPath(args: Args, source: OfficialPublisherSource): string {
  return resolve(args.out, 'inventory', `${source.id}.json`);
}

function probePath(args: Args, source: OfficialPublisherSource, shard: number): string {
  return resolve(args.out, 'probes', source.id, `shard-${String(shard).padStart(3, '0')}.json`);
}

function aggregate(args: Args, sources: OfficialPublisherSource[]): Record<string, unknown> {
  const inventoryBySource = new Map(sources.map((source) => [
    source.id,
    existsSync(inventoryPath(args, source)) ? readJson<SourceInventoryCheckpoint>(inventoryPath(args, source)) : null,
  ]));
  const inventories = sources.map((source) => inventoryBySource.get(source.id) ?? null);
  const eligibleVideoIdsBySource = new Map(sources.map((source) => [
    source.id,
    new Set(Object.values(inventoryBySource.get(source.id)?.videos ?? {})
      .filter((video) => isFullEpisodeCandidate(video))
      .map((video) => video.videoId)),
  ]));
  const probeStates: Array<{ sourceId: string; state: ProbeShardCheckpoint }> = [];
  for (const source of sources) for (let shard = 0; shard < args.shardCount; shard += 1) {
    const path = probePath(args, source, shard);
    if (existsSync(path)) probeStates.push({ sourceId: source.id, state: readJson<ProbeShardCheckpoint>(path) });
  }
  const unique = new Set(inventories.flatMap((state) => state ? Object.keys(state.videos) : []));
  const probes = probeStates.flatMap(({ state }) => Object.values(state.probes));
  // Checkpoints intentionally retain prior observations, but the aggregate
  // must not resurrect candidates that newer rules no longer classify as one
  // complete episode (for example, an EP1-3 pack). Filter against the current
  // inventory-derived eligibility set on every aggregate rebuild.
  const candidates = probeStates.flatMap(({ sourceId, state }) => Object.values(state.candidates)
    .filter((candidate) => eligibleVideoIdsBySource.get(sourceId)?.has(candidate.video.videoId)));
  const started = [...inventories.filter(Boolean).map((state) => state!.startedAt), ...probeStates.map(({ state }) => state.startedAt)].sort()[0] ?? new Date().toISOString();
  const elapsedMinutes = Math.max((Date.now() - Date.parse(started)) / 60_000, 1 / 60);
  const estimated = inventories.reduce((sum, state) => sum + (state?.estimatedTotalVideos ?? Object.keys(state?.videos ?? {}).length), 0);
  const listingRate = unique.size / elapsedMinutes;
  const result = {
    version: 1,
    updatedAt: new Date().toISOString(),
    pid: process.pid,
    shardCount: args.shardCount,
    ownedRange: [args.workerStart, args.workerEnd],
    sourceCount: sources.length,
    inventory: {
      completedSources: inventories.filter((state) => state?.completed).length,
      pages: inventories.reduce((sum, state) => sum + (state?.pages ?? 0), 0),
      listedOccurrences: inventories.reduce((sum, state) => sum + Object.keys(state?.videos ?? {}).length, 0),
      uniqueVideos: unique.size,
      duplicates: inventories.reduce((sum, state) => sum + (state?.duplicateOccurrences ?? 0), 0),
      advertisedOccurrencesUnreconciled: estimated || null,
      advertisedCountScope: 'public-page-label; may include unavailable, private, deleted, member-only, or otherwise non-enumerable uploads',
      enumerationScope: 'items reachable through ordinary public playlist continuations from the observation region',
      visibilityCaveat: estimated > unique.size ? `${estimated - unique.size} advertised occurrences were not enumerable; this is not a pending-work count.` : null,
      measuredUniqueItemsPerMinute: Number(listingRate.toFixed(2)),
      enumerationCompletedSources: inventories.filter((state) => state?.completed).length,
    },
    probes: {
      completed: probes.length,
      playable: probes.filter((probe) => probe.availability === 'playable').length,
      regionBlocked: probes.filter((probe) => probe.availability === 'region-blocked').length,
      embedDisabled: probes.filter((probe) => probe.availability === 'embed-disabled').length,
      unavailable: probes.filter((probe) => !['playable', 'region-blocked', 'embed-disabled'].includes(probe.availability)).length,
      manualReview: candidates.filter((candidate) => candidate.decision === 'manual-review').length,
      held: candidates.filter((candidate) => candidate.decision === 'hold').length,
    },
    rightsDisposition: 'reference-only',
    autoEnabled: 0,
    mediaDownloaded: 0,
  };
  atomicJson(resolve(args.out, 'coverage.json'), result);
  atomicJson(resolve(args.out, 'review-candidates.json'), candidates.sort((a, b) => b.confidence - a.confidence || a.candidateId.localeCompare(b.candidateId)));
  return result;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const config = readJson<OfficialYouTubeDiscoveryConfig>(args.config);
  validateOfficialYouTubeDiscoveryConfig(config);
  const allSources = config.sources;
  const sources = allSources.filter((source) => !args.source || source.id === args.source);
  if (!sources.length) throw new Error('NO_CONFIGURED_SOURCES');
  mkdirSync(args.out, { recursive: true });
  atomicJson(resolve(args.out, 'run-config.json'), { ...args, configVersion: config.version, sources: sources.map((source) => source.id), startedAt: new Date().toISOString(), rightsDisposition: 'reference-only', autoEnable: false, mediaDownloads: false });

  let retryEvents = 0;
  const scheduler = new AdaptiveRequestScheduler({
    globalConcurrency: args.globalConcurrency,
    perHostConcurrency: args.perHostConcurrency,
    requestsPerSecond: args.requestsPerSecond,
    burst: args.burst,
    circuitFailures: 4,
    circuitCooldownMs: 60_000,
  });
  const client = new PublicYouTubeMetadataClient({
    scheduler, maxAttempts: 3, timeoutMs: 20_000, maxResponseBytes: 12 * 1024 * 1024,
    observationRegion: args.observationRegion, retryCapMs: 30_000,
    onRequest: ({ retry }) => { if (retry) retryEvents += 1; },
  });

  if (args.phase !== 'probe') for (const source of sources) {
    const shard = stableShard(`source:${source.id}`, args.shardCount);
    if (!isOwned(shard, args)) continue;
    const path = inventoryPath(args, source);
    const existing = existsSync(path) ? readJson<SourceInventoryCheckpoint>(path) : null;
    if (existing?.completed) continue;
    await withLock(`${path}.lock`, async () => {
      const state = await inventoryOfficialPublisherSource(source, client, existing, {
        shardCount: args.shardCount, maxPages: args.maxPages, requestBudget: args.requestBudget,
        checkpoint: (value) => { value.retryCount = retryEvents; atomicJson(path, value); aggregate(args, allSources); },
      });
      process.stdout.write(`${JSON.stringify({ event: 'inventory', source: source.id, pages: state.pages, videos: Object.keys(state.videos).length, completed: state.completed })}\n`);
    });
  }

  if (args.phase !== 'inventory') {
    const database = new DatabaseSync(args.catalogue, { readOnly: true });
    const matcher = new OfficialYouTubeCatalogueMatcher(loadOfficialYouTubeCatalogue(database));
    database.close();
    let remainingProbes = args.probeBudget;
    probeSources: for (const source of sources) {
      if (source.discoveryMode === 'inventory-only') continue;
      const path = inventoryPath(args, source);
      if (!existsSync(path)) continue;
      const inventory = readJson<SourceInventoryCheckpoint>(path);
      const videos = Object.values(inventory.videos).filter((video) => isFullEpisodeCandidate(video));
      for (let shard = args.workerStart; shard <= args.workerEnd; shard += 1) {
        if (remainingProbes <= 0) break probeSources;
        const owned = videos.filter((video) => stableShard(`video:${video.videoId}`, args.shardCount) === shard);
        if (!owned.length) continue;
        const output = probePath(args, source, shard);
        const existing = existsSync(output) ? readJson<ProbeShardCheckpoint>(output) : null;
        if (existing?.completed && existing.matcherRevision === OFFICIAL_YOUTUBE_MATCHER_REVISION) continue;
        await withLock(`${output}.lock`, async () => {
          const before = existing?.requests ?? 0;
          const state = await probeOfficialYouTubeShard(shard, owned, client, existing, {
            concurrency: args.globalConcurrency, requestBudget: before + Math.min(remainingProbes, Math.max(0, owned.length - before)), source, matcher,
            matcherRevision: OFFICIAL_YOUTUBE_MATCHER_REVISION,
            // The shard is the durable source of truth. Rebuilding the global
            // aggregate after every video made a large run quadratic in its
            // candidate count; aggregate once when this process completes.
            checkpoint: (value) => { value.retryCount = retryEvents; atomicJson(output, value); },
          });
          remainingProbes -= Math.max(0, state.requests - before);
          process.stdout.write(`${JSON.stringify({ event: 'probe', source: source.id, shard, probed: state.requests, candidates: Object.keys(state.candidates).length, completed: state.completed })}\n`);
        });
      }
    }
  }
  process.stdout.write(`${JSON.stringify({ event: 'complete', coverage: aggregate(args, allSources) })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ event: 'fatal', code: error instanceof Error ? error.message : String(error), at: new Date().toISOString() })}\n`);
  process.exitCode = 1;
});
