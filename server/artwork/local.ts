import type { SqliteDatabase } from '../db.ts';
import { AppError } from '../errors.ts';
import { matchId, parseStoredMatch, reviewMutation, validateArtworkReview, type ArtworkReview, type SqlMutation } from './model.ts';
import { advanceArtwork, artworkFailureMutation, claimArtworkHostSql, policyArtworkFetch } from './refresh.ts';
import { ArtworkSourceError } from './source.ts';

function mutate(db: SqliteDatabase, query: SqlMutation) { return db.prepare(query.sql).run(...query.values); }
export function approveLocalArtwork(db: SqliteDatabase, input: unknown) {
  const review = validateArtworkReview(input); const id = matchId(review.titleSourceId, review.mediaId);
  db.exec('BEGIN IMMEDIATE');
  try {
    const title = db.prepare('SELECT source,source_id,format,release_year FROM titles WHERE id=?').get(review.titleId);
    if (!title || title.source !== review.titleSource || title.source_id !== review.titleSourceId || title.release_year !== review.releaseYear || String(title.format).toLowerCase() !== review.format.toLowerCase()) throw new AppError(409, 'IMPORT_IDENTITY_CONFLICT', 'Artwork approval does not match the existing catalogue identity.');
    if (review.evidence.identityProof) {
      for (const anchor of review.evidence.identityProof.anchors) {
        const episode = db.prepare('SELECT number_sort FROM episodes WHERE title_id=? AND source_id=?').get(review.titleId, anchor.sourceId);
        if (!episode || (episode.number_sort !== null && episode.number_sort !== anchor.number)) throw new AppError(409, 'IMPORT_IDENTITY_CONFLICT', 'An exact-ID artwork anchor no longer matches the title episode inventory.');
      }
    }
    const existing = db.prepare('SELECT * FROM artwork_matches WHERE title_id=? OR (metadata_source=\'anilist\' AND media_id=?)').all(review.titleId, review.mediaId);
    if (existing.some(row => row.id !== id || row.title_id !== review.titleId || row.mal_id !== review.malId)) throw new AppError(409, 'IMPORT_IDENTITY_CONFLICT', 'This title or authoritative metadata identity already has a different reviewed mapping.');
    mutate(db, reviewMutation(review));
    const stored = db.prepare('SELECT * FROM artwork_matches WHERE id=?').get(id);
    if (!stored) throw new AppError(409, 'IMPORT_IDENTITY_CONFLICT', 'Artwork approval did not match a source record.');
    db.exec('COMMIT'); return parseStoredMatch(stored);
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function enqueueLocalArtwork(db: SqliteDatabase, afterTitleId = 0, limit = 100, refreshCompleted = false) {
  if (!Number.isSafeInteger(afterTitleId) || afterTitleId < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new AppError(400, 'INVALID_QUERY', 'Choose a bounded artwork enqueue cursor.');
  const matches = db.prepare("SELECT id,title_id FROM artwork_matches WHERE review_status='approved' AND title_id>? ORDER BY title_id LIMIT ?").all(afterTitleId, limit);
  const now = new Date().toISOString(); let enqueued = 0;
  for (const match of matches) enqueued += Number(db.prepare(`INSERT INTO artwork_jobs(match_id,status,available_at,created_at,updated_at) VALUES(?,'pending',?,?,?) ON CONFLICT(match_id) DO UPDATE SET status='pending',checkpoint_json='{}',attempt_count=0,available_at=excluded.available_at,last_error_code=NULL,updated_at=excluded.updated_at WHERE ?=1 AND artwork_jobs.status='completed'`).run(String(match.id), now, now, now, refreshCompleted ? 1 : 0).changes);
  return { examined: matches.length, enqueued, nextCursor: matches.length === limit ? Number(matches.at(-1)?.title_id) : null };
}

export function localArtworkStatus(db: SqliteDatabase) {
  return { matches: db.prepare('SELECT review_status AS status,COUNT(*) AS count FROM artwork_matches GROUP BY review_status').all(), resources: db.prepare('SELECT role,COUNT(*) AS count FROM title_artwork GROUP BY role').all(), jobs: db.prepare('SELECT status,COUNT(*) AS count,MIN(available_at) AS nextAvailableAt FROM artwork_jobs GROUP BY status').all(), blockedHosts: db.prepare('SELECT hostname,blocked_status AS status,next_request_at AS nextRequestAt FROM artwork_source_policy WHERE blocked_status IS NOT NULL').all() };
}

export async function runLocalArtworkStep(db: SqliteDatabase, options: { fetch?: typeof fetch; now?: () => Date } = {}) {
  const now = options.now ?? (() => new Date()); const time = now(); const lease = crypto.randomUUID();
  const job = db.prepare(`UPDATE artwork_jobs SET status='running',lease=?,lease_expires_at=?,attempt_count=attempt_count+1,updated_at=? WHERE match_id=(SELECT j.match_id FROM artwork_jobs j JOIN artwork_matches m ON m.id=j.match_id WHERE m.review_status='approved' AND ((j.status IN ('pending','retry') AND j.available_at<=?) OR (j.status='running' AND j.lease_expires_at<=?)) ORDER BY j.available_at,j.match_id LIMIT 1) RETURNING *`).get(lease, new Date(time.getTime() + 60_000).toISOString(), time.toISOString(), time.toISOString(), time.toISOString());
  if (!job) return { status: 'idle' as const, requests: 0 };
  const id = String(job.match_id);
  let requestCount = 0;
  const counted: typeof fetch = async (input, init) => { requestCount++; return (options.fetch ?? fetch)(input, init); };
  const transport = policyArtworkFetch({
    async claim(hostname, timestamp, next) { return !!db.prepare(claimArtworkHostSql).get(hostname, next, timestamp); },
    async state(hostname) { const row = db.prepare('SELECT next_request_at,blocked_status FROM artwork_source_policy WHERE hostname=?').get(hostname); return row ? { next_request_at: String(row.next_request_at), blocked_status: row.blocked_status === null ? null : Number(row.blocked_status) } : null; },
    async hold(hostname, until, status) { db.prepare('UPDATE artwork_source_policy SET next_request_at=?,blocked_status=?,updated_at=? WHERE hostname=?').run(until, status, now().toISOString(), hostname); },
  }, counted, now);
  try {
    const row = db.prepare('SELECT m.* FROM artwork_matches m JOIN titles t ON t.id=m.title_id AND t.source=m.title_source AND t.source_id=m.title_source_id AND t.release_year=m.release_year AND LOWER(t.format)=LOWER(m.format) WHERE m.id=?').get(id);
    if (!row) throw new AppError(409, 'IMPORT_IDENTITY_CONFLICT', 'The reviewed artwork owner no longer matches a title.');
    const match = parseStoredMatch(row);
    let checkpoint: unknown; try { checkpoint = JSON.parse(String(job.checkpoint_json)); } catch { throw new AppError(422, 'UPSTREAM_CHANGED', 'Artwork checkpoint JSON is invalid.'); }
    const step = await advanceArtwork(match, checkpoint, transport);
    db.exec('BEGIN IMMEDIATE');
    try {
      const current = db.prepare("SELECT 1 FROM artwork_jobs j JOIN artwork_matches m ON m.id=j.match_id WHERE j.match_id=? AND j.lease=? AND j.status='running' AND j.lease_expires_at>? AND m.review_status='approved'").get(id, lease, now().toISOString());
      if (!current) { db.exec('ROLLBACK'); return { status: 'stale_lease' as const, requests: requestCount }; }
      for (const statement of step.statements) mutate(db, statement);
      db.prepare('UPDATE artwork_jobs SET status=?,checkpoint_json=?,available_at=?,lease=NULL,lease_expires_at=NULL,last_error_code=NULL,updated_at=? WHERE match_id=? AND lease=?').run(step.complete ? 'completed' : 'pending', JSON.stringify(step.checkpoint), new Date(now().getTime() + 2200).toISOString(), now().toISOString(), id, lease);
      db.exec('COMMIT'); return { status: step.complete ? 'completed' as const : 'checkpoint' as const, matchId: id, phase: step.checkpoint.phase, requests: requestCount };
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } catch (error) {
    const code = error instanceof ArtworkSourceError || error instanceof AppError ? error.code : 'UNAVAILABLE';
    const blocked = code === 'BLOCKED' || code === 'INVALID_DESTINATION' || code === 'IMPORT_IDENTITY_CONFLICT';
    const retryable = code === 'UNAVAILABLE' || code === 'RATE_LIMITED';
    const status = blocked ? 'blocked' : retryable && Number(job.attempt_count) < Number(job.max_attempts) ? 'retry' : 'failed';
    const delay = error instanceof ArtworkSourceError ? error.retryAfterSeconds : 60;
    db.exec('BEGIN IMMEDIATE');
    try {
      if (db.prepare("SELECT 1 FROM artwork_jobs WHERE match_id=? AND lease=? AND status='running' AND lease_expires_at>?").get(id, lease, now().toISOString())) {
        mutate(db, artworkFailureMutation(id, code));
        db.prepare('UPDATE artwork_jobs SET status=?,available_at=?,last_error_code=?,lease=NULL,lease_expires_at=NULL,updated_at=? WHERE match_id=? AND lease=?').run(status, new Date(now().getTime() + Math.max(1, delay) * 1000).toISOString(), code, now().toISOString(), id, lease);
      }
      db.exec('COMMIT');
    } catch (nested) { db.exec('ROLLBACK'); throw nested; }
    return { status, matchId: id, code, requests: requestCount };
  }
}

export type { ArtworkReview };
