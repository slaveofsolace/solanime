import { AppError } from '../errors.ts';
import type { CatalogueDatabase } from '../cloud/data/catalogue.ts';
import { reserveWriteBudget, type SyncBudget } from '../cloud/data/budget.ts';
import { SyncSourceError, type SyncHandlers } from '../cloud/data/sync.ts';
import { parseStoredMatch } from './model.ts';
import { advanceArtwork, artworkFailureMutation, claimArtworkHostSql, policyArtworkFetch } from './refresh.ts';
import { ArtworkSourceError } from './source.ts';

/** Queue integration port; the application must register this handler with its shared daily budget. */
export function createArtworkSyncHandlers(db: CatalogueDatabase, options: { budget: SyncBudget; fetch?: typeof fetch }): SyncHandlers {
  return { artwork_refresh: async task => {
    if (typeof task.payload.matchId !== 'string' || task.payload.matchId.length > 160 || Object.keys(task.payload).some(key => key !== 'matchId')) throw new AppError(400, 'BAD_REQUEST', 'Artwork queue messages reference one reviewed match, never a URL.');
    const row = await db.prepare('SELECT m.* FROM artwork_matches m JOIN titles t ON t.id=m.title_id AND t.source=m.title_source AND t.source_id=m.title_source_id AND t.release_year=m.release_year AND LOWER(t.format)=LOWER(m.format) WHERE m.id=?').bind(task.payload.matchId).first<Record<string, unknown>>();
    if (!row) throw new SyncSourceError('The artwork match no longer has its reviewed catalogue owner.', 'BLOCKED', false);
    const match = parseStoredMatch(row);
    if (match.reviewStatus !== 'approved') throw new SyncSourceError('The artwork identity is disabled; no source request was made.', 'BLOCKED', false);
    const send = policyArtworkFetch({
      async claim(hostname, now, next) {
        // Includes policy row/index updates and bounded failure bookkeeping, not just the happy path.
        await reserveWriteBudget(db, `artwork-policy:${task.id}:${task.lease}:${hostname}`, 32, 0, options.budget);
        return !!await db.prepare(claimArtworkHostSql).bind(hostname, next, now).first();
      },
      state(hostname) { return db.prepare('SELECT next_request_at,blocked_status FROM artwork_source_policy WHERE hostname=?').bind(hostname).first<{ next_request_at: string; blocked_status: number | null }>(); },
      async hold(hostname, until, status) { await db.prepare('UPDATE artwork_source_policy SET next_request_at=?,blocked_status=?,updated_at=? WHERE hostname=?').bind(until, status, new Date().toISOString(), hostname).run(); },
    }, options.fetch);
    try {
      const step = await advanceArtwork(match, task.checkpoint, send);
      return { statements: step.statements.map(statement => db.prepare(statement.sql).bind(...statement.values)), estimatedWrittenRows: step.statements.length * 16, checkpoint: { ...step.checkpoint }, complete: step.complete, retryAfterSeconds: 3 };
    } catch (error) {
      if (error instanceof ArtworkSourceError) {
        if (error.code !== 'RATE_LIMITED' || error.status === 429) {
          await reserveWriteBudget(db, `artwork-failure:${task.id}:${task.lease}`, 16, 0, options.budget);
          const failure = artworkFailureMutation(match.id, error.code);
          // The owner/lease predicate prevents a stale worker from modifying even failure metadata.
          await db.prepare(`${failure.sql} AND EXISTS(SELECT 1 FROM crawl_tasks WHERE id=? AND claimed_by=? AND status='running' AND lease_expires_at>?)`).bind(...failure.values, task.id, task.lease, new Date().toISOString()).run();
        }
        throw new SyncSourceError(error.message, error.code === 'BLOCKED' || error.code === 'INVALID_DESTINATION' ? 'BLOCKED' : error.code === 'INVALID_RESPONSE' ? 'UPSTREAM_CHANGED' : 'UNAVAILABLE', error.code === 'UNAVAILABLE' || error.code === 'RATE_LIMITED', error.retryAfterSeconds, error.status);
      }
      throw error;
    }
  } };
}

/** Bounded, cursor-based fan-out for any reviewed identities, not a five-record runtime registry. */
export async function enqueueCloudArtwork(db: CatalogueDatabase, runId: number, budget: SyncBudget, afterTitleId = 0, limit = 5) {
  if (!Number.isSafeInteger(runId) || runId < 1 || !Number.isSafeInteger(afterTitleId) || afterTitleId < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 5) throw new AppError(400, 'INVALID_QUERY', 'Artwork fan-out requires a run ID, title cursor, and at most five identities per call.');
  const run = await db.prepare("SELECT id FROM crawl_runs WHERE id=? AND status IN ('queued','running')").bind(runId).first();
  if (!run) throw new AppError(409, 'IMPORT_CONFLICT', 'The artwork refresh run must be active.');
  const found = (await db.prepare("SELECT id,title_id FROM artwork_matches WHERE review_status='approved' AND title_id>? ORDER BY title_id LIMIT ?").bind(afterTitleId, limit).all<{ id: string; title_id: number }>()).results;
  if (!found.length) return { examined: 0, enqueued: 0, nextCursor: null };
  await reserveWriteBudget(db, `artwork-enqueue:${runId}:${afterTitleId}:${crypto.randomUUID()}`, 16 + found.length * 24, 0, budget);
  const now = new Date().toISOString();
  const mutations = found.map(match => db.prepare("INSERT INTO crawl_tasks(run_id,task_key,task_type,payload_json,status,max_attempts,available_at,created_at,updated_at) VALUES(?,?,'artwork_refresh',?,'pending',10,?,?,?) ON CONFLICT(run_id,task_key) DO NOTHING").bind(runId, `artwork:${match.id}`, JSON.stringify({ matchId: match.id }), now, now, now));
  const result = await db.batch(mutations);
  return { examined: found.length, enqueued: result.reduce((sum, entry) => sum + entry.meta.changes, 0), nextCursor: found.length === limit ? found.at(-1)!.title_id : null };
}

/** Explicit, idempotent operator trigger. It cannot discover or approve a new identity. */
export async function startCloudArtworkRefresh(db: CatalogueDatabase, budget: SyncBudget, input: Record<string, unknown>) {
  if (Object.keys(input).some(key => key !== 'key' && key !== 'matchIds') || typeof input.key !== 'string' || !/^[a-zA-Z0-9:_-]{1,80}$/.test(input.key)
    || !Array.isArray(input.matchIds) || input.matchIds.length < 1 || input.matchIds.length > 5
    || input.matchIds.some(id => typeof id !== 'string' || !/^anikoto:[A-Za-z0-9_-]{1,100}:anilist:[1-9][0-9]{0,14}$/.test(id))
    || new Set(input.matchIds).size !== input.matchIds.length) throw new AppError(400, 'BAD_REQUEST', 'Supply a stable refresh key and one to five distinct, explicitly reviewed match IDs. URLs and automatic catalogue matching are not accepted.');
  const matchIds = [...input.matchIds as string[]].sort();
  const schema = await db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('artwork_matches','title_artwork','artwork_source_policy')").first<{ count: number }>();
  if (schema?.count !== 3) throw new AppError(503, 'UNAVAILABLE', 'Apply the additive artwork schema before requesting a refresh.');
  const matches = (await db.prepare("SELECT m.* FROM artwork_matches m JOIN titles t ON t.id=m.title_id AND t.source=m.title_source AND t.source_id=m.title_source_id AND t.release_year=m.release_year AND LOWER(t.format)=LOWER(m.format) WHERE m.id IN (SELECT value FROM json_each(?)) AND m.review_status='approved' ORDER BY m.id").bind(JSON.stringify(matchIds)).all<Record<string, unknown>>()).results;
  if (matches.length !== matchIds.length) throw new AppError(409, 'IMPORT_IDENTITY_CONFLICT', 'Every requested artwork match must already be approved for its unchanged catalogue owner.');
  matches.forEach(parseStoredMatch);
  const source = `artwork-cloud:${input.key}`;
  const checkpoint = JSON.stringify({ matchIds });
  const find = () => db.prepare('SELECT id,status,checkpoint_json FROM crawl_runs WHERE source=? ORDER BY id DESC LIMIT 1').bind(source).first<{ id: number; status: string; checkpoint_json: string }>();
  const existing = await find();
  if (existing) {
    if (existing.checkpoint_json !== checkpoint) throw new AppError(409, 'IMPORT_CONFLICT', 'This refresh key already identifies a different explicit match set. Existing tasks were preserved.');
    return { status: 'existing' as const, runId: existing.id, runStatus: existing.status, matchIds };
  }
  await reserveWriteBudget(db, `artwork-start:${input.key}`, 64 + matchIds.length * 24, 0, budget);
  const now = new Date().toISOString();
  // High-range IDs cannot collide with the still-running pinned source snapshot.
  // Both inserts are atomic; a racing same-key trigger never changes its match set.
  const results = await db.batch([
    db.prepare("INSERT INTO crawl_runs(id,source,mode,status,tasks_discovered,checkpoint_json,started_at,created_at,updated_at) SELECT (SELECT MAX(COALESCE(MAX(id),0),1000000000)+1 FROM crawl_runs),?,'incremental','queued',?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM crawl_runs WHERE source=?)").bind(source, matchIds.length, checkpoint, now, now, now, source),
    db.prepare("INSERT INTO crawl_tasks(id,run_id,task_key,task_type,payload_json,status,max_attempts,available_at,created_at,updated_at) SELECT (SELECT MAX(COALESCE(MAX(id),0),1000000000) FROM crawl_tasks)+CAST(j.key AS INTEGER)+1,r.id,'artwork:'||j.value,'artwork_refresh',json_object('matchId',j.value),'pending',10,?,?,? FROM json_each(?) j JOIN crawl_runs r ON r.source=? AND r.checkpoint_json=? WHERE true ON CONFLICT(run_id,task_key) DO NOTHING").bind(now, now, now, JSON.stringify(matchIds), source, checkpoint),
  ]);
  const run = await find();
  if (!run || run.checkpoint_json !== checkpoint) throw new AppError(409, 'IMPORT_CONFLICT', 'This refresh key was concurrently assigned to a different match set. No existing job was changed.');
  return { status: results[0].meta.changes ? 'created' as const : 'existing' as const, runId: run.id, runStatus: run.status, matchIds };
}
