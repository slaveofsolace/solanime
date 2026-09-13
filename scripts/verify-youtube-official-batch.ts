import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { OfficialYouTubeApprovalLedgerEntry, OfficialYouTubeBatchApprovalPlan } from '../server/ingestion/youtubeOfficialBatchApproval.ts';
import type { OfficialPublisherSource, OfficialYouTubeReviewCandidate } from '../server/ingestion/youtubeOfficialDiscovery.ts';

interface Config { sources: OfficialPublisherSource[] }
const root = resolve(import.meta.dirname, '..');

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}
function required(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`${name.toUpperCase().replaceAll('-', '_')}_REQUIRED`);
  return resolve(value);
}
function json<T>(path: string): T { return JSON.parse(readFileSync(path, 'utf8')) as T; }
function sha256(path: string): string { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function writeJson(path: string, value: unknown): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temp, path);
}

function selectReasonStratifiedSample(entries: OfficialYouTubeApprovalLedgerEntry[], size = 25): OfficialYouTubeApprovalLedgerEntry[] {
  const selected = new Map<string, OfficialYouTubeApprovalLedgerEntry>();
  const reasons = [...new Set(entries.flatMap((entry) => entry.reasonCodes))].sort();
  for (const reason of reasons) {
    const entry = entries.find((candidate) => candidate.reasonCodes.includes(reason));
    if (entry) selected.set(`${entry.sourceId}:${entry.videoId}`, entry);
  }
  const ranked = [...entries].sort((left, right) => {
    const leftHash = createHash('sha256').update(`${left.sourceId}:${left.videoId}`).digest('hex');
    const rightHash = createHash('sha256').update(`${right.sourceId}:${right.videoId}`).digest('hex');
    return leftHash.localeCompare(rightHash);
  });
  for (const entry of ranked) {
    if (selected.size >= size) break;
    selected.set(`${entry.sourceId}:${entry.videoId}`, entry);
  }
  return [...selected.values()].slice(0, size);
}

function main(): void {
  const batch = required('batch-dir');
  const candidatesPath = required('candidates');
  const configPath = required('config');
  const databasePath = required('database');
  const repoRelative = relative(root, batch);
  if (!repoRelative.startsWith('..') && !isAbsolute(repoRelative)) throw new Error('BATCH_MUST_BE_OUTSIDE_REPOSITORY');
  const plan = json<OfficialYouTubeBatchApprovalPlan>(resolve(batch, 'approval-ledger.json'));
  const candidates = json<OfficialYouTubeReviewCandidate[]>(candidatesPath);
  const config = json<Config>(configPath);
  const sourceById = new Map(config.sources.map((source) => [source.id, source]));
  const rawById = new Map(candidates.map((candidate) => [`${candidate.sourceId}:${candidate.video.videoId}`, candidate]));
  const sample = selectReasonStratifiedSample(plan.entries);
  const db = new DatabaseSync(databasePath, { readOnly: true });
  const results = sample.map((entry) => {
    const raw = rawById.get(`${entry.sourceId}:${entry.videoId}`);
    const source = sourceById.get(entry.sourceId);
    if (!raw || !source) throw new Error(`SANITY_INPUT_MISSING:${entry.sourceId}:${entry.videoId}`);
    const crosswalk = raw.match?.versionId ? db.prepare(`SELECT COUNT(*) AS count FROM titles t
      JOIN episodes e ON e.title_id=t.id JOIN episode_versions v ON v.episode_id=e.id
      WHERE t.id=? AND e.id=? AND v.id=? AND t.source_id=? AND e.source_id=? AND v.source_id=? AND v.language=?`).get(
        raw.match.titleId, raw.match.episodeId, raw.match.versionId, raw.match.titleSourceId,
        raw.match.episodeSourceId, raw.match.versionSourceId, raw.match.language,
      ) as { count: number } : { count: 0 };
    const existing = db.prepare(`SELECT COUNT(*) AS count FROM episode_provider_mappings
      WHERE provider_id='youtube-official' AND (provider_resource_id=? OR source_mapping_id=?)`).get(entry.videoId, `youtube:${entry.videoId}`) as { count: number };
    const checks = {
      ledgerEvidenceHashMatches: entry.evidenceHash === createHash('sha256').update(JSON.stringify(raw)).digest('hex'),
      stableVideoId: /^[A-Za-z0-9_-]{11}$/.test(entry.videoId),
      stableChannelId: /^UC[A-Za-z0-9_-]{22}$/.test(entry.channelId),
      configuredPublisherIdentity: raw.channelId === source.channelId && raw.video.channelId === source.channelId && raw.probe?.channelId === source.channelId,
      fullEpisodeDuration: (raw.probe?.durationSeconds ?? raw.video.durationSeconds ?? 0) >= 900,
      playableEmbed: raw.probe?.availability === 'playable' && raw.probe.playableInEmbed === true,
      usAvailable: raw.probe?.availableCountries.includes('US') === true,
      exactCatalogueRowCount: crosswalk.count,
      existingOfficialMappingCount: existing.count,
      heldHasReason: entry.decision !== 'hold' || entry.reasonCodes.length > 0,
      nonAuthoritativeHeld: raw.match?.method === 'authoritative' || entry.decision === 'hold',
    };
    if (Object.entries(checks).some(([key, value]) => key !== 'existingOfficialMappingCount' && key !== 'exactCatalogueRowCount' && value === false))
      throw new Error(`SANITY_CHECK_FAILED:${entry.sourceId}:${entry.videoId}`);
    if (checks.exactCatalogueRowCount !== 1) throw new Error(`SANITY_CROSSWALK_FAILED:${entry.sourceId}:${entry.videoId}`);
    if (entry.reasonCodes.includes('existing-official-youtube-duplicate') !== (checks.existingOfficialMappingCount > 0))
      throw new Error(`SANITY_DUPLICATE_REASON_MISMATCH:${entry.sourceId}:${entry.videoId}`);
    return { entry, rawMatchMethod: raw.match?.method ?? null, checks };
  });
  db.close();
  writeJson(resolve(batch, 'sanity-verification.json'), {
    version: 1,
    verifiedAt: new Date().toISOString(),
    sampling: 'reason-stratified then deterministic SHA-256 rank',
    population: plan.entries.length,
    sampleSize: results.length,
    representedReasons: [...new Set(results.flatMap((result) => result.entry.reasonCodes))].sort(),
    passed: results.length,
    failed: 0,
    results,
  });
  const files = readdirSync(batch).filter((name) => name !== 'package-manifest.json').map((name) => {
    const path = resolve(batch, name);
    return { path: name, bytes: statSync(path).size, sha256: sha256(path) };
  }).sort((left, right) => left.path.localeCompare(right.path));
  writeJson(resolve(batch, 'package-manifest.json'), { version: 1, regeneratedAt: new Date().toISOString(), files });
  process.stdout.write(`${JSON.stringify({ population: plan.entries.length, sampleSize: results.length, representedReasons: [...new Set(results.flatMap((result) => result.entry.reasonCodes))].sort(), passed: results.length, failed: 0, ledgerSha256: sha256(resolve(batch, 'approval-ledger.json')), databaseSha256: sha256(databasePath) })}\n`);
}

try { main(); } catch (error) {
  process.stderr.write(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
}
