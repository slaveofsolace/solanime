import { createHash } from 'node:crypto';
import { constants as fsConstants, copyFileSync, createReadStream, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { applyOfficialYouTubeApproval, OFFICIAL_YOUTUBE_EPISODE_APPROVALS } from '../../server/ingestion/youtubeOfficial.ts';

const root = resolve(import.meta.dirname, '../..');
const canonical = resolve(root, 'data', 'solanime.sqlite').toLowerCase();
const option = (name: string): string | undefined => process.argv.slice(2)
  .find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);

function requiredPath(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`${name.toUpperCase().replaceAll('-', '_')}_REQUIRED`);
  return resolve(value);
}

function sha256(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    createReadStream(path).on('data', (chunk) => hash.update(chunk)).on('error', reject)
      .on('end', () => resolveHash(hash.digest('hex')));
  });
}

function writeJson(path: string, value: unknown): void {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  renameSync(temporary, path);
}

function count(db: DatabaseSync, table: string, where = ''): number {
  return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`).get() as { count: number }).count);
}

async function main(): Promise<void> {
  const source = requiredPath('source-db');
  const output = requiredPath('out-db');
  const report = requiredPath('report');
  const expectedSourceHash = option('expected-source-sha256');
  const appliedAt = option('applied-at');
  const expectedApprovals = Number(option('expected-approvals'));
  if (!expectedSourceHash || !/^[a-f0-9]{64}$/i.test(expectedSourceHash)) throw new Error('EXPECTED_SOURCE_SHA256_REQUIRED');
  if (!appliedAt || !Number.isFinite(Date.parse(appliedAt))) throw new Error('VALID_APPLIED_AT_REQUIRED');
  if (!Number.isSafeInteger(expectedApprovals) || expectedApprovals < 1) throw new Error('EXPECTED_APPROVALS_REQUIRED');
  if (OFFICIAL_YOUTUBE_EPISODE_APPROVALS.length !== expectedApprovals)
    throw new Error(`APPROVAL_COUNT_MISMATCH:${OFFICIAL_YOUTUBE_EPISODE_APPROVALS.length}`);
  if (!existsSync(source)) throw new Error('SOURCE_DATABASE_NOT_FOUND');
  if (source.toLowerCase() === canonical || output.toLowerCase() === canonical) throw new Error('CANONICAL_DATABASE_REFUSED');
  for (const path of [output, report]) if (existsSync(path)) throw new Error(`FRESH_OUTPUT_REQUIRED:${path}`);
  const outputRelative = relative(root, output);
  if (!outputRelative.startsWith('..') && !isAbsolute(outputRelative)) throw new Error('OUTPUT_MUST_BE_OUTSIDE_REPOSITORY');
  if (dirname(output) !== dirname(report)) throw new Error('REPORT_MUST_SHARE_OUTPUT_DIRECTORY');

  const sourceHash = await sha256(source);
  if (sourceHash !== expectedSourceHash.toLowerCase()) throw new Error(`SOURCE_HASH_MISMATCH:${sourceHash}`);
  const approvalIds = new Set<string>();
  const videoIds = new Set<string>();
  const resourceTargets = new Set<string>();
  for (const approval of OFFICIAL_YOUTUBE_EPISODE_APPROVALS) {
    if (approvalIds.has(approval.id)) throw new Error(`DUPLICATE_APPROVAL_ID:${approval.id}`);
    if (videoIds.has(approval.video.id)) throw new Error(`DUPLICATE_VIDEO_ID:${approval.video.id}`);
    const target = `${approval.catalogue.versionSourceId}:${approval.video.id}`;
    if (resourceTargets.has(target)) throw new Error(`DUPLICATE_RESOURCE_TARGET:${target}`);
    approvalIds.add(approval.id);
    videoIds.add(approval.video.id);
    resourceTargets.add(target);
  }

  copyFileSync(source, output, fsConstants.COPYFILE_EXCL);
  if (await sha256(output) !== sourceHash) throw new Error('COPIED_DATABASE_HASH_MISMATCH');
  const database = new DatabaseSync(output);
  database.exec('PRAGMA foreign_keys=ON');
  try {
    const schemaVersion = Number((database.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get() as { version: number }).version);
    const before = {
      schemaVersion,
      titles: count(database, 'titles'),
      episodes: count(database, 'episodes'),
      versions: count(database, 'episode_versions'),
      mappings: count(database, 'episode_provider_mappings'),
      officialMappings: count(database, 'episode_provider_mappings', "WHERE provider_id='youtube-official'"),
      nativeResources: count(database, 'native_resources'),
    };
    if (before.officialMappings !== 0) throw new Error(`SOURCE_ALREADY_HAS_OFFICIAL_MAPPINGS:${before.officialMappings}`);
    const applied = OFFICIAL_YOUTUBE_EPISODE_APPROVALS.map((approval) => ({
      approvalId: approval.id,
      videoId: approval.video.id,
      edition: approval.editionLabel ?? null,
      ...applyOfficialYouTubeApproval(database, approval, appliedAt),
    }));
    database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    database.exec('PRAGMA journal_mode=DELETE');
    const after = {
      schemaVersion: Number((database.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get() as { version: number }).version),
      titles: count(database, 'titles'),
      episodes: count(database, 'episodes'),
      versions: count(database, 'episode_versions'),
      mappings: count(database, 'episode_provider_mappings'),
      officialMappings: count(database, 'episode_provider_mappings', "WHERE provider_id='youtube-official'"),
      officialDistinctResources: Number((database.prepare("SELECT COUNT(DISTINCT resource_id) AS count FROM native_resources WHERE provider_id='youtube-official' AND enabled=1").get() as { count: number }).count),
      officialEnabledResources: count(database, 'native_resources', "WHERE provider_id='youtube-official' AND enabled=1"),
      nativeResources: count(database, 'native_resources'),
      integrity: (database.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check,
      foreignKeyViolations: (database.prepare('PRAGMA foreign_key_check').all() as unknown[]).length,
    };
    if (after.titles !== before.titles || after.episodes !== before.episodes || after.versions !== before.versions)
      throw new Error('CATALOGUE_PARENT_COUNTS_CHANGED');
    if (after.mappings !== before.mappings + expectedApprovals || after.officialMappings !== expectedApprovals
      || after.officialDistinctResources !== expectedApprovals || after.officialEnabledResources !== expectedApprovals)
      throw new Error('OFFICIAL_MAPPING_COUNTS_MISMATCH');
    if (after.integrity !== 'ok' || after.foreignKeyViolations !== 0) throw new Error('DATABASE_INTEGRITY_FAILED');
    writeJson(report, { version: 1, builtAt: new Date().toISOString(), appliedAt, source: { path: source, sha256: sourceHash }, output: { path: output, sha256: await sha256(output) }, approvalCount: expectedApprovals, before, after, applied });
    process.stdout.write(`${JSON.stringify({ output, report, approvalCount: expectedApprovals, before, after, outputSha256: await sha256(output) })}\n`);
  } finally {
    database.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
