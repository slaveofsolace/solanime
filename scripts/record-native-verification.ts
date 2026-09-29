import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../server/db.ts';
import { getMapping } from '../server/catalogue.ts';
import { hasEnabledNativeResource } from '../server/providers/native-registry.ts';
import type { ApprovedNativeResource } from '../server/providers/native.ts';

const metrics = ['progressFrom', 'progressTo', 'duration', 'seekFrom', 'seekTo', 'restoredTime'] as const;
export type NativeObservation = Record<typeof metrics[number], number> & {
  mappingId: number;
  language: string;
  evidenceRef: string;
};

/** Validate operator observations, not HTTP-success or fixture-based claims. */
export function validateNativeObservation(value: unknown): NativeObservation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Expected one browser observation object.');
  const row = value as Record<string, unknown>;
  if (!Number.isSafeInteger(row.mappingId) || Number(row.mappingId) <= 0 || typeof row.language !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(row.language) || typeof row.evidenceRef !== 'string' || !/^docs\/[a-zA-Z0-9_./#-]{1,180}$/.test(row.evidenceRef) || row.evidenceRef.includes('..') || metrics.some(key => typeof row[key] !== 'number' || !Number.isFinite(row[key]) || Number(row[key]) < 0)) throw Error('Invalid mapping, language, evidence reference, or media metrics.');
  const result = Object.fromEntries(['mappingId', 'language', 'evidenceRef', ...metrics].map(key => [key, row[key]])) as NativeObservation;
  if (result.duration <= 0 || result.duration > 86_400 || result.progressTo < result.progressFrom + 1 || result.progressTo > result.duration || result.seekFrom > result.duration || result.seekTo > result.duration || Math.abs(result.seekTo - result.seekFrom) < 1 || result.restoredTime > result.duration) throw Error('Metrics must demonstrate real progression, seeking, and a bounded restored position.');
  return result;
}

async function main() {
  const option = (key: string) => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3);
  const input = option('input');
  const origin = option('origin');
  const localPath = option('local-db');
  if (!input || !process.argv.includes('--confirm-observed') || (!origin && !localPath)) throw Error('Supply --input, --confirm-observed, and a reviewed --origin and/or --local-db. Only use this after actual browser playback checks.');
  if (origin && !['https://cloud-release.solanime.pages.dev', 'https://solanime.pages.dev'].includes(origin)) throw Error('The cloud origin is not in the reviewed release allowlist.');
  const observation = validateNativeObservation(JSON.parse(readFileSync(input, 'utf8')));
  const db = localPath ? openDatabase(resolve(localPath)) : null;
  try {
    if (db) {
      const mapping = getMapping(db, observation.mappingId);
      const approved = db.prepare('SELECT * FROM native_resources WHERE mapping_id=?').get(observation.mappingId) as ApprovedNativeResource | undefined;
      if (mapping.language !== observation.language || !hasEnabledNativeResource(mapping, approved)) throw Error('The local observation does not match an enabled, approved native resource.');
    }
    let observedAt = new Date().toISOString();
    if (origin) {
      const operatorToken = process.env.SOLANIME_ADMIN_TOKEN;
      if (!operatorToken || operatorToken.length < 16 || operatorToken.length > 256) throw Error('A protected operator credential is required in SOLANIME_ADMIN_TOKEN.');
      const { mappingId, ...body } = observation;
      const response = await fetch(`${origin}/api/admin/providers/${mappingId}/verification`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'x-admin-token': operatorToken },
        body: JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw Error(`Cloud evidence recording returned HTTP ${response.status}; local evidence was not changed. Check protected diagnostics before retrying.`);
      const result = await response.json() as { mappingId?: unknown; stage?: unknown; observedAt?: unknown };
      if (Number(result.mappingId) !== mappingId || result.stage !== 'playback_verified' || typeof result.observedAt !== 'string' || !Number.isFinite(Date.parse(result.observedAt))) throw Error('Cloud returned an unexpected evidence response; check the mapping before retrying.');
      observedAt = result.observedAt;
    }
    if (db) {
      const details = JSON.stringify({ ...observation, origin: origin ?? 'local-browser', scope: 'This mapping only; operator-observed native browser playback. No temporary media URL is retained.' });
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare("INSERT INTO verification_observations(entity_type,entity_id,stage,result,evidence_class,details_json,observed_at) VALUES('mapping',?,'playback_verified','native_progression_seek_restore','operator_browser_observation',?,?)").run(String(observation.mappingId), details, observedAt);
        db.prepare("UPDATE episode_provider_mappings SET last_playback_verification_at=?,resolution_evidence_state='playback_verified' WHERE id=?").run(observedAt, observation.mappingId);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    console.log(JSON.stringify({ mappingId: observation.mappingId, stage: 'playback_verified', observedAt, cloudRecorded: Boolean(origin), localRecorded: Boolean(db), scope: 'Only the exact operator-observed mapping.' }, null, 2));
  } finally { db?.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof Error ? error.message : 'Evidence recording failed.'); process.exitCode = 1; });
}
