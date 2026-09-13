import type { SqliteDatabase } from '../db.ts';
import { AppError } from '../errors.ts';
import { approveLocalArtwork } from './local.ts';
import { parseStoredMatch, sourceIdentityReview, type SqlMutation } from './model.ts';
import { fetchSourceIdentity, type ArtworkIdentityOwner, type SourceIdentityProof } from './identity.ts';
import { advanceArtwork, claimArtworkHostSql, policyArtworkFetch } from './refresh.ts';
import { ArtworkSourceError, fetchAniListMediaByMal } from './source.ts';

/** Operator-only work queue, kept separately from the catalogue/public/cloud export. */
export function migrateArtworkEnrichment(queue: SqliteDatabase): void {
  queue.exec(`CREATE TABLE IF NOT EXISTS artwork_enrichment_schema(version INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS artwork_enrichment_tasks(
      title_id INTEGER PRIMARY KEY,source TEXT NOT NULL,source_id TEXT NOT NULL,slug TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 1000,stage TEXT NOT NULL DEFAULT 'identity' CHECK(stage IN ('identity','metadata','artwork','done')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','retry','completed','review_needed','blocked','failed')),
      mal_id INTEGER,anilist_id INTEGER,proof_json TEXT,checkpoint_json TEXT NOT NULL DEFAULT '{}',
      reason TEXT NOT NULL DEFAULT 'IDENTIFIER_DISCOVERY_PENDING',attempt_count INTEGER NOT NULL DEFAULT 0,
      available_at TEXT NOT NULL,lease TEXT,lease_expires_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      UNIQUE(source,source_id));
    CREATE INDEX IF NOT EXISTS idx_artwork_enrichment_ready ON artwork_enrichment_tasks(status,priority,available_at,title_id);
    CREATE TABLE IF NOT EXISTS artwork_enrichment_budget(day TEXT PRIMARY KEY,request_limit INTEGER NOT NULL,requests_reserved INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS artwork_enrichment_requests(id INTEGER PRIMARY KEY,day TEXT NOT NULL,hostname TEXT NOT NULL,title_id INTEGER,started_at TEXT NOT NULL,status INTEGER,outcome TEXT NOT NULL DEFAULT 'reserved');
    INSERT OR IGNORE INTO artwork_enrichment_schema(version) VALUES(1);`);
  if (queue.prepare('SELECT MAX(version) AS version FROM artwork_enrichment_schema').get()?.version !== 1) throw new AppError(409, 'IMPORT_CONFLICT', 'This artwork queue schema is not supported.');
}

export function artworkOwner(db: SqliteDatabase, titleId: number): ArtworkIdentityOwner | null {
  const title = db.prepare('SELECT id,source,source_id,slug,name,release_year,format FROM titles WHERE id=?').get(titleId);
  if (!title || title.source !== 'anikoto') return null;
  return { titleId, source: 'anikoto', sourceId: String(title.source_id), slug: String(title.slug), name: String(title.name),
    aliases: db.prepare('SELECT alias FROM title_aliases WHERE title_id=?').all(titleId).map(row => String(row.alias)),
    year: title.release_year === null ? null : Number(title.release_year), format: title.format === null ? null : String(title.format),
    episodes: db.prepare('SELECT source_id,number_sort FROM episodes WHERE title_id=? ORDER BY number_sort,id').all(titleId).map(row => ({ sourceId: String(row.source_id), number: row.number_sort === null ? null : Number(row.number_sort) })) };
}

/** Mirrors actual home rows and their existing relationships; all remaining titles are still queued. */
export function visibleArtworkTitleIds(db: SqliteDatabase): number[] {
  // The current artwork crosswalk is deliberately source-specific. Keep the
  // visible checkpoint aligned with the anime rows rendered on Home instead of
  // letting newer metadata-only imports consume its highest priorities.
  const rows = [...db.prepare("SELECT id FROM titles WHERE source='anikoto' ORDER BY updated_at DESC,id ASC LIMIT 13").all(),
    ...db.prepare("SELECT id FROM titles WHERE source='anikoto' AND LOWER(format)='movie' ORDER BY release_year DESC,name COLLATE NOCASE,id ASC LIMIT 12").all()];
  const ids = rows.map(row => Number(row.id));
  const related = db.prepare(`SELECT r.related_title_id AS id FROM related_titles r
    JOIN titles related ON related.id=r.related_title_id AND related.source='anikoto'
    WHERE r.title_id IN (SELECT value FROM json_each(?)) ORDER BY r.title_id,r.related_title_id`).all(JSON.stringify(ids));
  return [...new Set([...ids,...related.map(row => Number(row.id))])];
}

/** Idempotent queue creation for the entire existing dataset; never invents external IDs or changes source records. */
export function seedArtworkEnrichment(db: SqliteDatabase, queue: SqliteDatabase, priorityIds = visibleArtworkTitleIds(db), now = new Date().toISOString()) {
  const priority = new Map(priorityIds.map((id,index) => [id,index]));
  const titles = db.prepare(`SELECT t.id,t.source,t.source_id,t.slug,t.release_year,t.format,
    (SELECT COUNT(*) FROM episodes e WHERE e.title_id=t.id) AS episodes,m.id AS match_id,m.media_id,m.mal_id,m.review_status
    FROM titles t LEFT JOIN artwork_matches m ON m.title_id=t.id ORDER BY t.id`).all();
  let inserted = 0;
  queue.exec('BEGIN IMMEDIATE');
  try {
    for (const title of titles) {
      const existing = queue.prepare('SELECT source,source_id,slug FROM artwork_enrichment_tasks WHERE title_id=? OR (source=? AND source_id=?)').all(Number(title.id), String(title.source), String(title.source_id));
      if (existing.some(row => row.source !== title.source || row.source_id !== title.source_id || row.slug !== title.slug)) throw new AppError(409, 'IMPORT_IDENTITY_CONFLICT', 'This artwork queue belongs to a different or changed source identity.');
      const reason = title.source !== 'anikoto' ? 'UNSUPPORTED_CATALOGUE_SOURCE' : title.review_status === 'disabled' ? 'OPERATOR_DISABLED' : title.match_id ? 'EXISTING_REVIEWED_MATCH' : !title.episodes ? 'NO_IMPORTED_EPISODE_ANCHOR' : title.release_year === null || title.format === null ? 'MISSING_YEAR_OR_FORMAT_CORROBORATION' : 'IDENTIFIER_DISCOVERY_PENDING';
      const status = reason === 'EXISTING_REVIEWED_MATCH' ? 'completed' : reason === 'IDENTIFIER_DISCOVERY_PENDING' ? 'pending' : 'review_needed';
      inserted += Number(queue.prepare(`INSERT INTO artwork_enrichment_tasks(title_id,source,source_id,slug,priority,stage,status,mal_id,anilist_id,reason,available_at,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(title_id) DO UPDATE SET priority=MIN(artwork_enrichment_tasks.priority,excluded.priority) WHERE artwork_enrichment_tasks.priority>excluded.priority`).run(Number(title.id),String(title.source),String(title.source_id),String(title.slug),priority.get(Number(title.id)) ?? 1000,status === 'completed' ? 'done' : 'identity',status,title.mal_id === undefined ? null : title.mal_id,title.media_id === undefined ? null : title.media_id,reason,now,now,now).changes);
    }
    queue.exec('COMMIT');
  } catch (error) { queue.exec('ROLLBACK'); throw error; }
  return { catalogueTitles: titles.length, insertedOrReprioritized: inserted, visiblePriorityTitles: priorityIds.length };
}

export function enrichmentStatus(db: SqliteDatabase, queue: SqliteDatabase) {
  return { catalogueTitles: Number(db.prepare('SELECT COUNT(*) AS count FROM titles').get()?.count),
    tasks: queue.prepare('SELECT status,stage,reason,COUNT(*) AS count,MIN(available_at) AS nextAvailableAt FROM artwork_enrichment_tasks GROUP BY status,stage,reason ORDER BY status,stage,reason').all(),
    identities: queue.prepare('SELECT COUNT(*) AS allTasks,SUM(mal_id IS NOT NULL) AS withMalId,SUM(anilist_id IS NOT NULL) AS withAniListId FROM artwork_enrichment_tasks').get(),
    resources: db.prepare('SELECT role,COUNT(*) AS count FROM title_artwork GROUP BY role').all(),
    reviewedMatches: db.prepare('SELECT review_status AS status,COUNT(*) AS count FROM artwork_matches GROUP BY review_status').all(),
    sourcePolicy: db.prepare('SELECT hostname,blocked_status,next_request_at FROM artwork_source_policy').all(),
    requestBudget: queue.prepare('SELECT * FROM artwork_enrichment_budget ORDER BY day DESC LIMIT 3').all(),
    sourceUse: { bulkAniListCollection: 'hold-source-use-review', scope: 'Explicit title-ID selection only; no automatic all-title metadata fetch.', termsUrl: 'https://docs.anilist.co/guide/terms-of-use', rights: 'reference-only; no copied image assets or cleared redistribution claim' } };
}

function policyPort(db: SqliteDatabase, now: () => Date) {
  return {
    async claim(hostname: string, timestamp: string, next: string) { return !!db.prepare(claimArtworkHostSql).get(hostname,next,timestamp); },
    async state(hostname: string) { const row = db.prepare('SELECT next_request_at,blocked_status FROM artwork_source_policy WHERE hostname=?').get(hostname); return row ? { next_request_at: String(row.next_request_at), blocked_status: row.blocked_status === null ? null : Number(row.blocked_status) } : null; },
    async hold(hostname: string, until: string, status: number | null) { db.prepare('UPDATE artwork_source_policy SET next_request_at=?,blocked_status=?,updated_at=? WHERE hostname=?').run(until,status,now().toISOString(),hostname); },
  };
}

/** A reservation is not refunded after a crash: this intentionally errs toward fewer upstream requests. */
function meteredFetch(queue: SqliteDatabase, limit: number, titleId: number, count: () => void, send: typeof fetch, now: () => Date): typeof fetch {
  return async (input,init) => {
    const time = now().toISOString(); const day = time.slice(0,10); let receiptId: number;
    queue.exec('BEGIN IMMEDIATE');
    try {
      queue.prepare('INSERT OR IGNORE INTO artwork_enrichment_budget(day,request_limit,updated_at) VALUES(?,?,?)').run(day,limit,time);
      const row = queue.prepare('SELECT request_limit,requests_reserved FROM artwork_enrichment_budget WHERE day=?').get(day)!;
      if (row.request_limit !== limit) throw new AppError(409, 'IMPORT_CONFLICT', 'The daily artwork request budget is immutable once the first request is reserved; resume with its existing value.');
      if (Number(row.requests_reserved) >= limit) throw new ArtworkSourceError('QUOTA_EXHAUSTED','The explicit daily artwork request budget is exhausted.',undefined,Math.ceil((Date.parse(`${day}T00:00:00Z`) + 86_400_000 - now().getTime()) / 1000));
      queue.prepare('UPDATE artwork_enrichment_budget SET requests_reserved=requests_reserved+1,updated_at=? WHERE day=?').run(time,day);
      receiptId = Number(queue.prepare('INSERT INTO artwork_enrichment_requests(day,hostname,title_id,started_at) VALUES(?,?,?,?)').run(day,new URL(String(input)).hostname,titleId,time).lastInsertRowid);
      queue.exec('COMMIT');
    } catch (error) { queue.exec('ROLLBACK'); throw error; }
    count();
    try { const response = await send(input,init); queue.prepare("UPDATE artwork_enrichment_requests SET status=?,outcome='responded' WHERE id=?").run(response.status,receiptId); return response; }
    catch (error) { queue.prepare("UPDATE artwork_enrichment_requests SET outcome='transport-failed' WHERE id=?").run(receiptId); throw error; }
  };
}

export interface EnrichmentOptions { titleIds: number[]; dailyRequestLimit: number; identityOnly?: boolean; fetch?: typeof fetch; now?: () => Date; }

/** One ordinary request maximum per lease. Only the explicit selected IDs can advance beyond the durable pending inventory. */
export async function runArtworkEnrichmentStep(db: SqliteDatabase, queue: SqliteDatabase, options: EnrichmentOptions) {
  if (!options.titleIds.length || options.titleIds.length > 10_000 || options.titleIds.some(id => !Number.isSafeInteger(id) || id < 1) || !Number.isSafeInteger(options.dailyRequestLimit) || options.dailyRequestLimit < 1 || options.dailyRequestLimit > 10_000) throw new AppError(400,'INVALID_QUERY','Provide explicit catalogue title IDs and a bounded daily request allowance.');
  const now = options.now ?? (() => new Date()); const time = now().toISOString(); const lease = crypto.randomUUID();
  const job = queue.prepare(`UPDATE artwork_enrichment_tasks SET status='running',lease=?,lease_expires_at=?,attempt_count=attempt_count+1,updated_at=?
    WHERE title_id=(SELECT title_id FROM artwork_enrichment_tasks WHERE title_id IN (SELECT value FROM json_each(?))
      AND ((status IN ('pending','retry') AND available_at<=?) OR (status='running' AND lease_expires_at<=?))
      AND (?=0 OR stage='identity') ORDER BY priority,title_id LIMIT 1) RETURNING *`).get(lease,new Date(now().getTime()+60_000).toISOString(),time,JSON.stringify(options.titleIds),time,time,options.identityOnly ? 1 : 0);
  if (!job) return { status: 'idle' as const, requests: 0 };
  const titleId = Number(job.title_id); let requests = 0;
  const counted = meteredFetch(queue,options.dailyRequestLimit,titleId,() => {requests++;},options.fetch ?? fetch,now);
  const send = policyArtworkFetch(policyPort(db,now),counted,now,job.stage === 'identity' ? 'identity-discovery' : 'artwork');
  const liveLease = () => !!queue.prepare("SELECT 1 FROM artwork_enrichment_tasks WHERE title_id=? AND status='running' AND lease=? AND lease_expires_at>?").get(titleId,lease,now().toISOString());
  try {
    const owner = artworkOwner(db,titleId);
    if (!owner || owner.sourceId !== job.source_id || owner.slug !== job.slug) throw new AppError(409,'IMPORT_IDENTITY_CONFLICT','The queued title owner changed. Existing artwork remains untouched.');
    let nextStage = String(job.stage); let status = 'pending'; let reason = ''; let malId = job.mal_id; let anilistId = job.anilist_id;
    let proof = job.proof_json === null ? null : JSON.parse(String(job.proof_json));
    let checkpoint = JSON.parse(String(job.checkpoint_json)); let mutations: SqlMutation[] = []; let review: ReturnType<typeof sourceIdentityReview> | null = null;
    if (job.stage === 'identity') {
      const observed = await fetchSourceIdentity(owner,send,now);
      if (observed.status === 'verified') { malId = observed.malId; proof = observed.proof; nextStage = 'metadata'; reason = 'EXACT_SOURCE_IDS_VERIFIED'; }
      else { status = 'review_needed'; reason = observed.code; }
    } else if (job.stage === 'metadata') {
      if (!proof || !Number.isSafeInteger(malId)) throw new AppError(422,'UPSTREAM_CHANGED','The durable authoritative identity proof is missing.');
      const media = await fetchAniListMediaByMal(Number(malId),send);
      review = sourceIdentityReview(owner,proof as SourceIdentityProof,media,now().toISOString());
      anilistId = media.id; nextStage = 'artwork'; checkpoint = { phase: 'poster', media }; reason = 'METADATA_IDENTITY_VERIFIED';
    } else if (job.stage === 'artwork') {
      const stored = db.prepare('SELECT * FROM artwork_matches WHERE title_id=?').get(titleId);
      if (!stored) throw new AppError(422,'UPSTREAM_CHANGED','The reviewed artwork identity is absent.');
      const step = await advanceArtwork(parseStoredMatch(stored),checkpoint,send);
      mutations = step.statements; checkpoint = step.checkpoint; nextStage = step.complete ? 'done' : 'artwork'; status = step.complete ? 'completed' : 'pending';
      reason = step.complete ? 'ARTWORK_ROLES_CHECKED' : `ARTWORK_${String(step.checkpoint.phase).toUpperCase()}_PENDING`;
    } else throw new AppError(422,'UPSTREAM_CHANGED','The queued artwork phase is unrecognized.');
    queue.exec('BEGIN IMMEDIATE');
    try {
      if (!liveLease()) { queue.exec('ROLLBACK'); return { status: 'stale_lease' as const, requests, titleId }; }
      if (review) approveLocalArtwork(db,review);
      if (mutations.length) {
        db.exec('BEGIN IMMEDIATE');
        try { for (const mutation of mutations) db.prepare(mutation.sql).run(...mutation.values); db.exec('COMMIT'); }
        catch (error) { db.exec('ROLLBACK'); throw error; }
      }
      queue.prepare('UPDATE artwork_enrichment_tasks SET stage=?,status=?,reason=?,mal_id=?,anilist_id=?,proof_json=?,checkpoint_json=?,available_at=?,attempt_count=0,lease=NULL,lease_expires_at=NULL,updated_at=? WHERE title_id=? AND lease=?')
        .run(nextStage,status,reason,malId,anilistId,proof ? JSON.stringify(proof) : null,JSON.stringify(checkpoint),new Date(now().getTime()+2200).toISOString(),now().toISOString(),titleId,lease);
      queue.exec('COMMIT');
    } catch (error) { queue.exec('ROLLBACK'); throw error; }
    return { status, stage: nextStage, reason, titleId, requests };
  } catch (error) {
    const code = error instanceof ArtworkSourceError || error instanceof AppError ? error.code : 'UNAVAILABLE';
    const status = code === 'BLOCKED' || code === 'INVALID_DESTINATION' ? 'blocked' : code === 'IMPORT_IDENTITY_CONFLICT' || code === 'INVALID_RESPONSE' || code === 'UPSTREAM_CHANGED' ? 'review_needed'
      : ['UNAVAILABLE','RATE_LIMITED','QUOTA_EXHAUSTED'].includes(code) && Number(job.attempt_count) < 6 ? 'retry' : 'failed';
    const seconds = error instanceof ArtworkSourceError ? error.retryAfterSeconds : Math.min(3600,30 * 2 ** Number(job.attempt_count));
    if (liveLease()) queue.prepare('UPDATE artwork_enrichment_tasks SET status=?,reason=?,available_at=?,lease=NULL,lease_expires_at=NULL,updated_at=? WHERE title_id=? AND lease=?')
      .run(status,code,new Date(now().getTime()+Math.max(1,seconds)*1000).toISOString(),now().toISOString(),titleId,lease);
    return { status, stage: String(job.stage), reason: code, titleId, requests };
  }
}
