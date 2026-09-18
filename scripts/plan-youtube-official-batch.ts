import {
  constants as fsConstants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { planOfficialYouTubeBatchApprovals } from '../server/ingestion/youtubeOfficialBatchApproval.ts';
import { applyOfficialYouTubeApproval, OFFICIAL_YOUTUBE_EPISODE_APPROVALS } from '../server/ingestion/youtubeOfficial.ts';
import type {
  OfficialYouTubeDiscoveryConfig,
  OfficialYouTubeReviewCandidate,
  ProbeShardCheckpoint,
  SourceInventoryCheckpoint,
} from '../server/ingestion/youtubeOfficialDiscovery.ts';
import { isFullEpisodeCandidate, validateOfficialYouTubeDiscoveryConfig } from '../server/ingestion/youtubeOfficialDiscovery.ts';

interface Coverage {
  sourceCount: number;
  inventory: { completedSources: number; pages: number; listedOccurrences: number; uniqueVideos: number };
  probes: { completed: number; playable: number; regionBlocked: number; embedDisabled: number; unavailable: number; manualReview: number; held: number };
  autoEnabled: number;
  mediaDownloaded: number;
}

const root = resolve(import.meta.dirname, '..');
const canonical = resolve(root, 'data', 'solanime.sqlite').toLowerCase();

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function requiredPath(name: string): string {
  const raw = option(name);
  if (!raw) throw new Error(`${name.toUpperCase().replaceAll('-', '_')}_REQUIRED`);
  return resolve(raw);
}

function readJson<T>(path: string): T { return JSON.parse(readFileSync(path, 'utf8')) as T; }

function atomicJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temp, path);
}

function sha256(path: string): string {
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

function filesRecursively(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = resolve(path, entry.name);
    return entry.isDirectory() ? filesRecursively(child) : [child];
  });
}

function validateCrawlerArtifacts(runDir: string, config: OfficialYouTubeDiscoveryConfig): { coverage: Coverage; candidates: OfficialYouTubeReviewCandidate[]; manifest: Array<{ path: string; bytes: number; sha256: string }> } {
  const coverage = readJson<Coverage>(resolve(runDir, 'coverage.json'));
  const candidates = readJson<OfficialYouTubeReviewCandidate[]>(resolve(runDir, 'review-candidates.json'));
  const files = filesRecursively(runDir);
  const forbidden = files.filter((path) => /\.(?:html?|mp4|m4v|webm|m3u8|mpd|ts|part|tmp|lock)$/i.test(path));
  if (forbidden.length) throw new Error(`FORBIDDEN_CRAWL_ARTIFACT:${forbidden.map((path) => relative(runDir, path)).join(',')}`);
  const inventories = config.sources.map((source) => readJson<SourceInventoryCheckpoint>(resolve(runDir, 'inventory', `${source.id}.json`)));
  const eligibleVideoIdsBySource = new Map(config.sources.map((source, index) => [
    source.id,
    new Set(Object.values(inventories[index].videos).filter((video) => isFullEpisodeCandidate(video)).map((video) => video.videoId)),
  ]));
  if (inventories.some((state) => !state.completed)) throw new Error('INVENTORY_CHECKPOINT_INCOMPLETE');
  const listedOccurrences = inventories.reduce((sum, state) => sum + Object.keys(state.videos).length, 0);
  const uniqueVideos = new Set(inventories.flatMap((state) => Object.keys(state.videos))).size;
  const pages = inventories.reduce((sum, state) => sum + state.pages, 0);
  const probeFiles = files.filter((path) => /[\\/]probes[\\/].+\.json$/i.test(path));
  const probes = probeFiles.map((path) => ({
    sourceId: relative(runDir, path).split(/[\\/]/)[1],
    state: readJson<ProbeShardCheckpoint>(path),
  }));
  if (probes.some(({ state }) => !state.completed)) throw new Error('PROBE_CHECKPOINT_INCOMPLETE');
  const probeRecords = probes.flatMap(({ state }) => Object.values(state.probes));
  const checkpointCandidates = probes.flatMap(({ sourceId, state }) => Object.values(state.candidates)
    .filter((candidate) => eligibleVideoIdsBySource.get(sourceId)?.has(candidate.video.videoId)));
  const counts = {
    sourceCount: config.sources.length,
    completedSources: inventories.filter((state) => state.completed).length,
    pages,
    listedOccurrences,
    uniqueVideos,
    probes: probeRecords.length,
    playable: probeRecords.filter((probe) => probe.availability === 'playable').length,
    regionBlocked: probeRecords.filter((probe) => probe.availability === 'region-blocked').length,
    embedDisabled: probeRecords.filter((probe) => probe.availability === 'embed-disabled').length,
    unavailable: probeRecords.filter((probe) => !['playable', 'region-blocked', 'embed-disabled'].includes(probe.availability)).length,
    manualReview: checkpointCandidates.filter((candidate) => candidate.decision === 'manual-review').length,
    held: checkpointCandidates.filter((candidate) => candidate.decision === 'hold').length,
  };
  if (
    coverage.sourceCount !== counts.sourceCount || coverage.inventory.completedSources !== counts.completedSources
    || coverage.inventory.pages !== counts.pages || coverage.inventory.listedOccurrences !== counts.listedOccurrences
    || coverage.inventory.uniqueVideos !== counts.uniqueVideos || coverage.probes.completed !== counts.probes
    || coverage.probes.playable !== counts.playable || coverage.probes.regionBlocked !== counts.regionBlocked
    || coverage.probes.embedDisabled !== counts.embedDisabled || coverage.probes.unavailable !== counts.unavailable
    || coverage.probes.manualReview !== counts.manualReview || coverage.probes.held !== counts.held
    || candidates.length !== checkpointCandidates.length || coverage.autoEnabled !== 0 || coverage.mediaDownloaded !== 0
  ) throw new Error(`COVERAGE_CHECKPOINT_MISMATCH:${JSON.stringify(counts)}`);
  const checkpointFingerprints = checkpointCandidates.map((candidate) => `${candidate.sourceId}:${candidate.video.videoId}:${candidate.decision}`).sort();
  const aggregateFingerprints = candidates.map((candidate) => `${candidate.sourceId}:${candidate.video.videoId}:${candidate.decision}`).sort();
  if (JSON.stringify(checkpointFingerprints) !== JSON.stringify(aggregateFingerprints)) throw new Error('CANDIDATE_AGGREGATE_MISMATCH');
  return {
    coverage,
    candidates,
    manifest: files.filter((path) => !path.endsWith('process.json')).map((path) => ({ path: relative(runDir, path).replaceAll('\\', '/'), bytes: statSync(path).size, sha256: sha256(path) })).sort((left, right) => left.path.localeCompare(right.path)),
  };
}

function databaseAudit(db: DatabaseSync): Record<string, number | string> {
  const count = (table: string) => Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
  const integrity = (db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
  const foreignKeys = (db.prepare('PRAGMA foreign_key_check').all() as unknown[]).length;
  return {
    integrity,
    foreignKeyViolations: foreignKeys,
    titles: count('titles'),
    episodes: count('episodes'),
    versions: count('episode_versions'),
    providerMappings: count('episode_provider_mappings'),
    nativeResources: count('native_resources'),
  };
}

function main(): void {
  const runDir = requiredPath('run-dir');
  const configPath = requiredPath('config');
  const sourceDb = requiredPath('source-db');
  const output = requiredPath('out');
  const expectedHash = option('expected-source-sha256');
  if (!expectedHash || !/^[a-f0-9]{64}$/i.test(expectedHash)) throw new Error('EXPECTED_SOURCE_SHA256_REQUIRED');
  if (sourceDb.toLowerCase() === canonical) throw new Error('CANONICAL_DATABASE_REFUSED');
  if (!existsSync(runDir) || !existsSync(configPath) || !existsSync(sourceDb)) throw new Error('INPUT_NOT_FOUND');
  const repoRelative = relative(root, output);
  if (!repoRelative.startsWith('..') && !isAbsolute(repoRelative)) throw new Error('OUTPUT_MUST_BE_OUTSIDE_REPOSITORY');
  if (existsSync(output)) throw new Error('FRESH_OUTPUT_DIRECTORY_REQUIRED');
  const sourceHash = sha256(sourceDb);
  if (sourceHash !== expectedHash.toLowerCase()) throw new Error(`SOURCE_HASH_MISMATCH:${sourceHash}`);
  const config = readJson<OfficialYouTubeDiscoveryConfig>(configPath);
  validateOfficialYouTubeDiscoveryConfig(config);
  const validation = validateCrawlerArtifacts(runDir, config);
  mkdirSync(output, { recursive: false });
  const evaluatedAt = new Date().toISOString();
  const source = new DatabaseSync(sourceDb, { readOnly: true });
  const sourceAudit = databaseAudit(source);
  const enabledChannels = new Set(config.playbackPolicies.filter((policy) => policy.state === 'implemented').map((policy) => policy.channelId));
  const plan = planOfficialYouTubeBatchApprovals(source, validation.candidates, config.sources, evaluatedAt, enabledChannels);
  source.close();
  atomicJson(resolve(output, 'crawler-validation.json'), { validatedAt: evaluatedAt, coverage: validation.coverage, fileManifest: validation.manifest });
  atomicJson(resolve(output, 'approval-ledger.json'), plan);
  const eligible = plan.entries.filter((entry) => entry.decision === 'eligible');
  const held = plan.entries.filter((entry) => entry.decision === 'hold');
  atomicJson(resolve(output, 'eligible.json'), eligible);
  atomicJson(resolve(output, 'held.json'), held);
  const sanitySample = plan.entries.filter((entry, index) => index % Math.max(1, Math.floor(plan.entries.length / 25)) === 0).slice(0, 25);
  atomicJson(resolve(output, 'sanity-sample.json'), sanitySample);

  const destinationDb = resolve(output, basename(sourceDb));
  copyFileSync(sourceDb, destinationDb, fsConstants.COPYFILE_EXCL);
  const beforeApplyHash = sha256(destinationDb);
  if (beforeApplyHash !== sourceHash) throw new Error('COPIED_DATABASE_HASH_MISMATCH');
  const database = new DatabaseSync(destinationDb);
  database.exec('PRAGMA foreign_keys=ON');
  const applied = [] as Array<{ videoId: string; mappingId: number }>;
  for (const entry of eligible) {
    const approval = OFFICIAL_YOUTUBE_EPISODE_APPROVALS.find((item) => item.video.id === entry.videoId);
    if (!approval) throw new Error(`ELIGIBLE_APPROVAL_RECORD_MISSING:${entry.videoId}`);
    const result = applyOfficialYouTubeApproval(database, approval, evaluatedAt);
    applied.push({ videoId: entry.videoId, mappingId: result.mappingId });
  }
  const postAudit = databaseAudit(database);
  database.close();
  if (postAudit.integrity !== 'ok' || postAudit.foreignKeyViolations !== 0) throw new Error('POST_APPLY_DATABASE_INTEGRITY_FAILED');
  const destinationHash = sha256(destinationDb);
  atomicJson(resolve(output, 'application-report.json'), {
    appliedAt: evaluatedAt,
    sourceDatabase: sourceDb,
    sourceSha256: sourceHash,
    sourceAudit,
    destinationDatabase: destinationDb,
    copiedSha256: beforeApplyHash,
    appliedCount: applied.length,
    applied,
    postAudit,
    destinationSha256: destinationHash,
    idempotentNoop: applied.length === 0 && destinationHash === sourceHash,
  });
  const outputManifest = filesRecursively(output).filter((path) => path !== resolve(output, 'package-manifest.json')).map((path) => ({ path: relative(output, path).replaceAll('\\', '/'), bytes: statSync(path).size, sha256: sha256(path) })).sort((left, right) => left.path.localeCompare(right.path));
  atomicJson(resolve(output, 'package-manifest.json'), { version: 1, generatedAt: evaluatedAt, files: outputManifest });
  process.stdout.write(`${JSON.stringify({ output, inputCandidates: validation.candidates.length, manualReview: plan.inputManualReviewCandidates, eligible: plan.eligibleCount, held: plan.heldCount, applied: applied.length, sourceHash, destinationHash, sourceAudit, postAudit, reasonCounts: plan.reasonCounts })}\n`);
}

try { main(); } catch (error) {
  process.stderr.write(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
}
