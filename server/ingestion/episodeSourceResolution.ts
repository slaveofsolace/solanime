import { resolve as resolvePath } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { validateMegaPlayEmbedUrl } from '../providers/embed.ts';

const PROVIDERS = ['vidstream-2', 'hd-1', 'hd-2'] as const;
const MAX_RESPONSE_BYTES = 64 * 1024;

type ProviderId = (typeof PROVIDERS)[number];

type ResolutionJob = {
  mappingId: number;
  versionId: number;
  providerId: ProviderId;
  resourceId: string;
  language: string;
  attemptCount: number;
  maxAttempts: number;
};

type ResolveOutcome =
  | { kind: 'resolved'; url: string }
  | { kind: 'retry'; code: string; message: string; retryAt: number }
  | { kind: 'failed'; code: string; message: string }
  | { kind: 'paused'; code: string; message: string };

export type ResolutionOptions = {
  cataloguePath: string;
  statePath: string;
  concurrency?: number;
  startSpacingMs?: number;
  maxJobs?: number;
  fetcher?: typeof fetch;
  now?: () => number;
  progress?: (value: ResolutionProgress) => void;
};

export type ResolutionProgress = {
  processedThisRun: number;
  resolvedThisRun: number;
  retriedThisRun: number;
  failedThisRun: number;
  counts: Record<string, number>;
  coveredVersions: number;
  totalVersions: number;
  paused: boolean;
  pauseReason: string | null;
};

function asProviderId(value: string): ProviderId {
  if (!PROVIDERS.includes(value as ProviderId)) throw new Error('UNSUPPORTED_PROVIDER');
  return value as ProviderId;
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function open(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout=10000; PRAGMA foreign_keys=ON;');
  return db;
}

export function initializeResolutionState(statePath: string, cataloguePath: string): number {
  const sourcePath = resolvePath(cataloguePath);
  const state = open(resolvePath(statePath));
  try {
    state.exec(`
      CREATE TABLE IF NOT EXISTS resolution_control (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        catalogue_path TEXT NOT NULL,
        paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0,1)),
        pause_reason TEXT,
        next_allowed_at INTEGER NOT NULL DEFAULT 0,
        seeded_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS resolution_jobs (
        mapping_id INTEGER PRIMARY KEY,
        version_id INTEGER NOT NULL,
        provider_id TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        language TEXT NOT NULL,
        priority INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','succeeded','failed')),
        attempt_count INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5,
        available_at INTEGER NOT NULL DEFAULT 0,
        resolved_url TEXT,
        error_code TEXT,
        error_message TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS resolution_jobs_work_idx
        ON resolution_jobs(status,available_at,priority,mapping_id);
      CREATE INDEX IF NOT EXISTS resolution_jobs_version_idx
        ON resolution_jobs(version_id,status);
    `);
    const now = new Date().toISOString();
    const existing = state.prepare('SELECT catalogue_path AS cataloguePath FROM resolution_control WHERE id=1').get() as
      | { cataloguePath: string }
      | undefined;
    if (existing && resolvePath(existing.cataloguePath) !== sourcePath)
      throw new Error(`State database belongs to a different catalogue: ${existing.cataloguePath}`);
    state.prepare(`INSERT INTO resolution_control(id,catalogue_path,paused,pause_reason,next_allowed_at,seeded_at,updated_at)
      VALUES(1,?,0,NULL,0,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at`).run(sourcePath, now, now);
    state.exec(`ATTACH DATABASE ${sqlString(sourcePath)} AS catalogue`);
    try {
      state.exec('BEGIN IMMEDIATE');
      const result = state.prepare(`
        INSERT OR IGNORE INTO resolution_jobs(
          mapping_id,version_id,provider_id,resource_id,language,priority,status,attempt_count,
          max_attempts,available_at,resolved_url,error_code,error_message,updated_at
        )
        SELECT m.id,m.version_id,m.provider_id,m.provider_resource_id,v.language,
          CASE m.provider_id WHEN 'vidstream-2' THEN 0 WHEN 'hd-1' THEN 1 ELSE 2 END,
          CASE WHEN COALESCE(m.canonical_embed_url,'') <> '' THEN 'succeeded' ELSE 'pending' END,
          0,5,0,m.canonical_embed_url,NULL,NULL,?
        FROM catalogue.episode_provider_mappings m
        JOIN catalogue.episode_versions v ON v.id=m.version_id
        WHERE m.provider_id IN ('vidstream-2','hd-1','hd-2')
          AND COALESCE(m.provider_resource_id,'') <> ''
      `).run(now);
      state.exec('COMMIT');
      return Number(result.changes);
    } catch (error) {
      state.exec('ROLLBACK');
      throw error;
    } finally {
      state.exec('DETACH DATABASE catalogue');
    }
  } finally {
    state.close();
  }
}

export function setResolutionPaused(statePath: string, paused: boolean, reason: string | null = null): void {
  const state = open(resolvePath(statePath));
  try {
    const result = state.prepare('UPDATE resolution_control SET paused=?,pause_reason=?,updated_at=? WHERE id=1')
      .run(paused ? 1 : 0, paused ? reason ?? 'OPERATOR_PAUSED' : null, new Date().toISOString());
    if (Number(result.changes) !== 1) throw new Error('Resolution state is not initialized.');
  } finally {
    state.close();
  }
}

function readCounts(state: DatabaseSync): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of state.prepare('SELECT status,COUNT(*) AS count FROM resolution_jobs GROUP BY status').all() as Array<{ status: string; count: number }>)
    counts[row.status] = Number(row.count);
  return counts;
}

export function resolutionStatus(statePath: string, cataloguePath?: string): ResolutionProgress & {
  resolvedMappings: number;
  eligibleEpisodes: number;
  resolvedEpisodes: number;
} {
  const state = open(resolvePath(statePath));
  try {
    const control = state.prepare('SELECT catalogue_path AS cataloguePath,paused,pause_reason AS pauseReason FROM resolution_control WHERE id=1')
      .get() as { cataloguePath: string; paused: number; pauseReason: string | null } | undefined;
    if (!control) throw new Error('Resolution state is not initialized.');
    const path = resolvePath(cataloguePath ?? control.cataloguePath);
    if (path !== resolvePath(control.cataloguePath)) throw new Error('Catalogue path does not match the initialized state.');
    const versions = state.prepare(`SELECT COUNT(DISTINCT version_id) AS totalVersions,
      COUNT(DISTINCT CASE WHEN status='succeeded' THEN version_id END) AS coveredVersions FROM resolution_jobs`).get() as {
        totalVersions: number;
        coveredVersions: number;
      };
    const catalogue = new DatabaseSync(path, { readOnly: true });
    try {
      const coverage = catalogue.prepare(`SELECT
        COUNT(DISTINCT CASE WHEN m.provider_id IN ('vidstream-2','hd-1','hd-2') THEN v.episode_id END) AS eligibleEpisodes,
        COUNT(DISTINCT CASE WHEN m.provider_id IN ('vidstream-2','hd-1','hd-2') AND COALESCE(m.canonical_embed_url,'')<>'' THEN v.episode_id END) AS resolvedEpisodes,
        SUM(CASE WHEN m.provider_id IN ('vidstream-2','hd-1','hd-2') AND COALESCE(m.canonical_embed_url,'')<>'' THEN 1 ELSE 0 END) AS resolvedMappings
        FROM episode_provider_mappings m JOIN episode_versions v ON v.id=m.version_id`).get() as {
          eligibleEpisodes: number;
          resolvedEpisodes: number;
          resolvedMappings: number;
        };
      return {
        processedThisRun: 0,
        resolvedThisRun: 0,
        retriedThisRun: 0,
        failedThisRun: 0,
        counts: readCounts(state),
        coveredVersions: Number(versions.coveredVersions),
        totalVersions: Number(versions.totalVersions),
        paused: Boolean(control.paused),
        pauseReason: control.pauseReason,
        eligibleEpisodes: Number(coverage.eligibleEpisodes),
        resolvedEpisodes: Number(coverage.resolvedEpisodes),
        resolvedMappings: Number(coverage.resolvedMappings),
      };
    } finally {
      catalogue.close();
    }
  } finally {
    state.close();
  }
}

export function parseResolverPayload(payload: unknown, language: string, providerId: string): string {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
  const result = record?.result && typeof record.result === 'object' && !Array.isArray(record.result)
    ? record.result as Record<string, unknown>
    : null;
  if (record?.status !== 200 || typeof result?.url !== 'string') throw new Error('UPSTREAM_SCHEMA_CHANGED');
  return validateMegaPlayEmbedUrl(result.url, language, providerId).href;
}

function retryAt(response: Response, attempt: number, now: number): number {
  const header = response.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return now + Math.min(3_600_000, Math.max(1_000, seconds * 1_000));
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.min(now + 3_600_000, Math.max(now + 1_000, date));
  }
  return now + Math.min(60_000, 1_000 * 2 ** Math.min(attempt, 6));
}

async function boundedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_RESPONSE_BYTES) throw new Error('UPSTREAM_RESPONSE_TOO_LARGE');
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('UPSTREAM_RESPONSE_TOO_LARGE');
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function resolveJob(job: ResolutionJob, fetcher: typeof fetch, now: () => number): Promise<ResolveOutcome> {
  const endpoint = new URL('/ajax/server', 'https://anikototv.to');
  endpoint.searchParams.set('get', job.resourceId);
  const timeout = AbortSignal.timeout(12_000);
  try {
    const response = await fetcher(endpoint, {
      redirect: 'manual',
      signal: timeout,
      headers: { accept: 'application/json, text/javascript;q=0.9', 'x-requested-with': 'XMLHttpRequest' },
    });
    if ([401, 403, 451].includes(response.status)) {
      await response.body?.cancel();
      return { kind: 'paused', code: `UPSTREAM_HTTP_${response.status}`, message: 'The source explicitly refused access.' };
    }
    if (response.status === 429) {
      await response.body?.cancel();
      return { kind: 'retry', code: 'UPSTREAM_RATE_LIMIT', message: 'The source requested a slower rate.', retryAt: retryAt(response, job.attemptCount, now()) };
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      return { kind: 'failed', code: 'UPSTREAM_REDIRECT', message: 'The resolver unexpectedly redirected.' };
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status >= 500)
        return { kind: 'retry', code: `UPSTREAM_HTTP_${response.status}`, message: 'The resolver is temporarily unavailable.', retryAt: retryAt(response, job.attemptCount, now()) };
      return { kind: 'failed', code: `UPSTREAM_HTTP_${response.status}`, message: 'The resolver rejected this stored reference.' };
    }
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
      await response.body?.cancel();
      return { kind: 'failed', code: 'UPSTREAM_SCHEMA_CHANGED', message: 'The resolver no longer returns JSON.' };
    }
    const text = await boundedText(response);
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return { kind: 'failed', code: 'UPSTREAM_SCHEMA_CHANGED', message: 'The resolver returned malformed JSON.' };
    }
    try {
      return { kind: 'resolved', url: parseResolverPayload(payload, job.language, job.providerId) };
    } catch (error) {
      return {
        kind: 'failed',
        code: error instanceof Error && error.message === 'UPSTREAM_SCHEMA_CHANGED' ? error.message : 'INVALID_PROVIDER_RESOURCE',
        message: 'The resolver destination did not match the expected provider route.',
      };
    }
  } catch (error) {
    const code = error instanceof Error && error.message === 'UPSTREAM_RESPONSE_TOO_LARGE'
      ? error.message
      : timeout.aborted ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE';
    if (code === 'UPSTREAM_RESPONSE_TOO_LARGE') return { kind: 'failed', code, message: 'The resolver response exceeded the safe limit.' };
    return { kind: 'retry', code, message: 'The resolver request did not complete.', retryAt: now() + Math.min(60_000, 1_000 * 2 ** Math.min(job.attemptCount, 6)) };
  }
}

function claimJobs(state: DatabaseSync, limit: number, now: number): ResolutionJob[] {
  state.exec('BEGIN IMMEDIATE');
  try {
    const rows = state.prepare(`
      SELECT mapping_id AS mappingId,version_id AS versionId,provider_id AS providerId,
             resource_id AS resourceId,language,attempt_count AS attemptCount,max_attempts AS maxAttempts
      FROM resolution_jobs candidate
      WHERE status='pending' AND available_at<=?
      ORDER BY
        CASE WHEN EXISTS(SELECT 1 FROM resolution_jobs covered WHERE covered.version_id=candidate.version_id AND covered.status='succeeded') THEN 1 ELSE 0 END,
        priority,mapping_id
      LIMIT ?
    `).all(now, limit) as Array<Omit<ResolutionJob, 'providerId'> & { providerId: string }>;
    const update = state.prepare("UPDATE resolution_jobs SET status='running',attempt_count=attempt_count+1,updated_at=? WHERE mapping_id=? AND status='pending'");
    const timestamp = new Date(now).toISOString();
    const claimed: ResolutionJob[] = [];
    for (const row of rows) {
      if (Number(update.run(timestamp, row.mappingId).changes) !== 1) continue;
      claimed.push({ ...row, providerId: asProviderId(row.providerId), attemptCount: row.attemptCount + 1 });
    }
    state.exec('COMMIT');
    return claimed;
  } catch (error) {
    state.exec('ROLLBACK');
    throw error;
  }
}

function progress(state: DatabaseSync, counters: Omit<ResolutionProgress, 'counts' | 'coveredVersions' | 'totalVersions' | 'paused' | 'pauseReason'>): ResolutionProgress {
  const versions = state.prepare(`SELECT COUNT(DISTINCT version_id) AS totalVersions,
    COUNT(DISTINCT CASE WHEN status='succeeded' THEN version_id END) AS coveredVersions FROM resolution_jobs`).get() as { totalVersions: number; coveredVersions: number };
  const control = state.prepare('SELECT paused,pause_reason AS pauseReason FROM resolution_control WHERE id=1').get() as { paused: number; pauseReason: string | null };
  return { ...counters, counts: readCounts(state), totalVersions: Number(versions.totalVersions), coveredVersions: Number(versions.coveredVersions), paused: Boolean(control.paused), pauseReason: control.pauseReason };
}

export async function runEpisodeSourceResolution(options: ResolutionOptions): Promise<ResolutionProgress> {
  const cataloguePath = resolvePath(options.cataloguePath);
  const statePath = resolvePath(options.statePath);
  initializeResolutionState(statePath, cataloguePath);
  const concurrency = Math.max(1, Math.min(64, Math.trunc(options.concurrency ?? 10)));
  const spacing = Math.max(25, Math.trunc(options.startSpacingMs ?? 75));
  const maxJobs = options.maxJobs && options.maxJobs > 0 ? Math.trunc(options.maxJobs) : Number.POSITIVE_INFINITY;
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const state = open(statePath);
  const catalogue = open(cataloguePath);
  const counters = { processedThisRun: 0, resolvedThisRun: 0, retriedThisRun: 0, failedThisRun: 0 };
  let nextRequestAt = 0;
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    state.prepare("UPDATE resolution_jobs SET status='pending',available_at=MIN(available_at,?),updated_at=? WHERE status='running'")
      .run(now(), new Date(now()).toISOString());
    for (;;) {
      const control = state.prepare('SELECT paused,pause_reason AS pauseReason,next_allowed_at AS nextAllowedAt FROM resolution_control WHERE id=1')
        .get() as { paused: number; pauseReason: string | null; nextAllowedAt: number };
      if (stopping || control.paused || counters.processedThisRun >= maxJobs) break;
      if (control.nextAllowedAt > now()) {
        await new Promise(resolve => setTimeout(resolve, Math.min(5_000, control.nextAllowedAt - now())));
        continue;
      }
      const remaining = Number.isFinite(maxJobs) ? Math.min(concurrency, maxJobs - counters.processedThisRun) : concurrency;
      const jobs = claimJobs(state, Math.max(1, remaining), now());
      if (!jobs.length) {
        const next = state.prepare("SELECT MIN(available_at) AS nextAt,COUNT(*) AS count FROM resolution_jobs WHERE status='pending'").get() as { nextAt: number | null; count: number };
        if (!next.count) break;
        await new Promise(resolve => setTimeout(resolve, Math.min(5_000, Math.max(250, Number(next.nextAt ?? now()) - now()))));
        continue;
      }
      const outcomes = await Promise.all(jobs.map(async job => {
        const startAt = Math.max(now(), nextRequestAt);
        nextRequestAt = startAt + spacing;
        if (startAt > now()) await new Promise(resolve => setTimeout(resolve, startAt - now()));
        return { job, outcome: await resolveJob(job, fetcher, now) };
      }));
      for (const { job, outcome } of outcomes) {
        const timestamp = new Date(now()).toISOString();
        counters.processedThisRun += 1;
        if (outcome.kind === 'resolved') {
          const updated = catalogue.prepare(`UPDATE episode_provider_mappings SET canonical_embed_url=?,availability_state='available',
            unavailable_reason=NULL,last_successful_resolution_at=?,resolution_evidence_state='resolved',updated_at=?
            WHERE id=? AND provider_id=? AND provider_resource_id=?`).run(outcome.url, timestamp, timestamp, job.mappingId, job.providerId, job.resourceId);
          if (Number(updated.changes) !== 1) {
            state.prepare("UPDATE resolution_jobs SET status='failed',error_code='STALE_MAPPING',error_message='The catalogue mapping identity changed.',updated_at=? WHERE mapping_id=?")
              .run(timestamp, job.mappingId);
            counters.failedThisRun += 1;
          } else {
            state.prepare("UPDATE resolution_jobs SET status='succeeded',resolved_url=?,error_code=NULL,error_message=NULL,updated_at=? WHERE mapping_id=?")
              .run(outcome.url, timestamp, job.mappingId);
            counters.resolvedThisRun += 1;
          }
        } else if (outcome.kind === 'paused') {
          state.prepare("UPDATE resolution_jobs SET status='pending',available_at=?,error_code=?,error_message=?,updated_at=? WHERE mapping_id=?")
            .run(now() + 60_000, outcome.code, outcome.message, timestamp, job.mappingId);
          state.prepare('UPDATE resolution_control SET paused=1,pause_reason=?,updated_at=? WHERE id=1')
            .run(outcome.code, timestamp);
        } else if (outcome.kind === 'retry' && job.attemptCount < job.maxAttempts) {
          state.prepare("UPDATE resolution_jobs SET status='pending',available_at=?,error_code=?,error_message=?,updated_at=? WHERE mapping_id=?")
            .run(outcome.retryAt, outcome.code, outcome.message, timestamp, job.mappingId);
          if (outcome.code === 'UPSTREAM_RATE_LIMIT')
            state.prepare('UPDATE resolution_control SET next_allowed_at=MAX(next_allowed_at,?),updated_at=? WHERE id=1').run(outcome.retryAt, timestamp);
          counters.retriedThisRun += 1;
        } else {
          state.prepare("UPDATE resolution_jobs SET status='failed',error_code=?,error_message=?,updated_at=? WHERE mapping_id=?")
            .run(outcome.code, outcome.message, timestamp, job.mappingId);
          counters.failedThisRun += 1;
        }
      }
      if (counters.processedThisRun % 100 < jobs.length) options.progress?.(progress(state, counters));
    }
    if (stopping) state.prepare("UPDATE resolution_jobs SET status='pending',updated_at=? WHERE status='running'").run(new Date(now()).toISOString());
    const result = progress(state, counters);
    options.progress?.(result);
    return result;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    catalogue.close();
    state.close();
  }
}
