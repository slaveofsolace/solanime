import type { D1PreparedStatement, Message, Queue } from '@cloudflare/workers-types';
import { AppError } from '../../errors.ts';
import type { CatalogueDatabase } from './catalogue.ts';
import { DEFAULT_SYNC_BUDGET, QuotaExhaustedError, getWriteBudget, reserveWriteBudget, type SyncBudget } from './budget.ts';

export interface SyncMessage { taskId: number; }
export interface SyncTask { id: number; runId: number; taskKey: string; taskType: string; payload: Record<string, unknown>; checkpoint: Record<string, unknown>; attempt: number; maxAttempts: number; lease: string; }
export interface SyncPlan { statements: D1PreparedStatement[]; estimatedWrittenRows: number; checkpoint?: Record<string, unknown>; complete?: boolean; retryAfterSeconds?: number; }
export type SyncHandler = (task: SyncTask) => Promise<SyncPlan>;
export type SyncHandlers = Readonly<Record<string, SyncHandler>>;
const objectJson = (value: unknown): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(String(value));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new AppError(422, 'UPSTREAM_CHANGED', 'Persisted synchronization payload is malformed.');
  return parsed as Record<string, unknown>;
};
export class SyncSourceError extends Error {
  constructor(message: string, readonly code: 'BLOCKED' | 'UNAVAILABLE' | 'UPSTREAM_CHANGED', readonly retryable: boolean, readonly retryAfterSeconds = 60, readonly httpStatus?: number) { super(message); }
}

export function createSyncRepository(db: CatalogueDatabase) {
  async function enqueue(runId: number, key: string, type: string, payload: Record<string, unknown>, maxAttempts = 4) {
    if (!Number.isSafeInteger(runId) || runId < 1 || !key || key.length > 200 || !/^[a-z_]{1,60}$/.test(type) || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10 || new TextEncoder().encode(JSON.stringify(payload)).byteLength > 50_000) throw new AppError(400, 'BAD_REQUEST', 'Invalid synchronization task.');
    const now = new Date().toISOString();
    await reserveWriteBudget(db, `enqueue:${runId}:${key}`, 24);
    await db.prepare("INSERT INTO crawl_tasks(run_id,task_key,task_type,payload_json,status,max_attempts,available_at,created_at,updated_at) VALUES(?,?,?,?,'pending',?,?,?,?) ON CONFLICT(run_id,task_key) DO NOTHING").bind(runId, key, type, JSON.stringify(payload), maxAttempts, now, now, now).run();
    return db.prepare('SELECT id,status FROM crawl_tasks WHERE run_id=? AND task_key=?').bind(runId, key).first<{ id: number; status: string }>();
  }
  async function setRunPaused(runId: number, paused: boolean) {
    await reserveWriteBudget(db, `run-state:${runId}:${crypto.randomUUID()}`, 16);
    const result = await db.prepare("UPDATE crawl_runs SET status=?,updated_at=? WHERE id=? AND status IN ('queued','running','paused')").bind(paused ? 'paused' : 'queued', new Date().toISOString(), runId).run();
    return result.meta.changes > 0;
  }
  async function setEnabled(enabled: boolean) {
    await db.prepare('UPDATE cloud_sync_control SET enabled=?,updated_at=? WHERE id=1').bind(enabled ? 1 : 0, new Date().toISOString()).run();
    return { enabled };
  }
  /** Explicit operator retry. Checkpoints and source refusal policy are never reset. */
  async function retryRun(runId: number, options: { limit?: number; includeBlocked?: boolean } = {}, budget: SyncBudget = DEFAULT_SYNC_BUDGET) {
    const limit = options.limit ?? 100; const includeBlocked = options.includeBlocked ?? true;
    if (!Number.isSafeInteger(runId) || runId < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || typeof includeBlocked !== 'boolean') throw new AppError(400, 'BAD_REQUEST', 'Retry requires a run ID and a limit from one to one hundred tasks.');
    const run = await db.prepare('SELECT status FROM crawl_runs WHERE id=?').bind(runId).first<{ status: string }>();
    if (!run) throw new AppError(404, 'NOT_FOUND', 'The synchronization run was not found.');
    if (run.status === 'cancelled') throw new AppError(409, 'IMPORT_CONFLICT', 'A cancelled run cannot be resumed through retry.');
    const stateFilter = includeBlocked ? "status IN ('failed','blocked')" : "status='failed'";
    const candidates = (await db.prepare(`SELECT id FROM crawl_tasks WHERE run_id=? AND ${stateFilter} ORDER BY id LIMIT ?`).bind(runId, limit).all<{ id: number }>()).results;
    let retried = 0;
    if (candidates.length) {
      await reserveWriteBudget(db, `operator-retry:${runId}:${crypto.randomUUID()}`, candidates.length * 24 + 32, 0, budget);
      const selected = JSON.stringify(candidates.map(row => row.id)); const now = new Date().toISOString();
      // One atomic batch records the pre-retry state, resets only the selected tasks,
      // and resumes their run. The JSON ID parameter stays below D1's 100-binding limit.
      const result = await db.batch([
        db.prepare(`INSERT INTO verification_observations(id,entity_type,entity_id,stage,result,reason_code,evidence_class,details_json,observed_at) SELECT (SELECT MAX(COALESCE(MAX(id),0),1000000000) FROM verification_observations)+ROW_NUMBER() OVER(ORDER BY t.id),'crawl_task',CAST(t.id AS TEXT),'observed','operator_retry','OPERATOR_RETRY','operator_action',json_object('runId',t.run_id,'previousStatus',t.status,'previousCode',t.last_error_code,'checkpointPreserved',json('true')),? FROM crawl_tasks t WHERE t.run_id=? AND t.id IN (SELECT value FROM json_each(?)) AND t.${stateFilter} AND EXISTS(SELECT 1 FROM crawl_runs r WHERE r.id=t.run_id AND r.status<>'cancelled')`).bind(now, runId, selected),
        db.prepare(`UPDATE crawl_tasks SET status='retry',attempt_count=0,available_at=?,retry_after_at=NULL,claimed_at=NULL,claimed_by=NULL,completed_at=NULL,lease_expires_at=NULL,cloud_dispatched_at=NULL,cloud_dispatch_token=NULL,updated_at=? WHERE run_id=? AND id IN (SELECT value FROM json_each(?)) AND ${stateFilter} AND EXISTS(SELECT 1 FROM crawl_runs r WHERE r.id=crawl_tasks.run_id AND r.status<>'cancelled')`).bind(now, now, runId, selected),
        db.prepare("UPDATE crawl_runs SET status='queued',finished_at=NULL,tasks_failed=(SELECT COUNT(*) FROM crawl_tasks WHERE run_id=? AND status IN ('failed','blocked')),updated_at=? WHERE id=? AND status<>'cancelled' AND changes()>0").bind(runId, now, runId),
      ]);
      retried = result[1].meta.changes;
    }
    const current = await db.prepare(`SELECT r.status AS runStatus,(SELECT COUNT(*) FROM crawl_tasks WHERE run_id=r.id AND ${stateFilter}) AS remaining FROM crawl_runs r WHERE r.id=?`).bind(runId).first<{ runStatus: string; remaining: number }>();
    return { runId, retried, remaining: current?.remaining ?? 0, runStatus: current?.runStatus ?? run.status };
  }
  async function status(budget = DEFAULT_SYNC_BUDGET) {
    const result = await db.batch([
      db.prepare('SELECT enabled,updated_at AS updatedAt FROM cloud_sync_control WHERE id=1'),
      db.prepare('SELECT task_type AS taskType,status,COUNT(*) AS count FROM crawl_tasks GROUP BY task_type,status ORDER BY task_type,status'),
      db.prepare('SELECT id,run_id AS runId,task_key AS taskKey,last_error_code AS code,last_error_message AS message,retry_after_at AS retryAt,updated_at AS updatedAt FROM crawl_tasks WHERE last_error_code IS NOT NULL ORDER BY updated_at DESC LIMIT 30'),
    ]);
    return { control: result[0].results[0], tasks: result[1].results, recentErrors: result[2].results, budget: await getWriteBudget(db, budget) };
  }
  return { enqueue, setRunPaused, setEnabled, retryRun, status };
}

/** Cron may call this repeatedly. Sending is not the authoritative task state transition. */
export async function dispatchSyncTasks(db: CatalogueDatabase, queue: Pick<Queue<SyncMessage>, 'send'>, budget = DEFAULT_SYNC_BUDGET, limit = 5, now = new Date(), taskTypes?: readonly string[]) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 8) throw new AppError(400, 'BAD_REQUEST', 'Dispatch at most eight task notifications per invocation.');
  if (taskTypes && (!taskTypes.length || taskTypes.length > 20 || taskTypes.some(type => !/^[a-z_]{1,60}$/.test(type)))) throw new AppError(400, 'BAD_REQUEST', 'Choose a bounded set of implemented task types.');
  const control = await db.prepare('SELECT enabled FROM cloud_sync_control WHERE id=1').first<{ enabled: number }>();
  if (!control?.enabled) return { dispatched: 0, status: 'paused' as const };
  const allowance = await getWriteBudget(db, budget, now);
  if (allowance.writtenRowsReserved + 20 * limit + 96 > budget.dailyWrittenRows || allowance.queueOperationsReserved + 3 * limit > budget.dailyQueueOperations) return { dispatched: 0, status: 'quota_paused' as const, retryAt: new QuotaExhaustedError(now).retryAt };
  const timestamp = now.toISOString(); const stale = new Date(now.getTime() - 10 * 60_000).toISOString();
  const typeFilter = taskTypes ? ` AND t.task_type IN (${taskTypes.map(() => '?').join(',')})` : '';
  const due = await db.prepare(`SELECT t.id FROM crawl_tasks t JOIN crawl_runs r ON r.id=t.run_id WHERE r.status IN ('queued','running') AND ((t.status IN ('pending','retry') AND t.available_at<=?) OR (t.status='running' AND (t.lease_expires_at IS NULL OR t.lease_expires_at<=?))) AND (t.cloud_dispatched_at IS NULL OR t.cloud_dispatched_at<=?)${typeFilter} ORDER BY CASE t.task_type WHEN 'artwork_refresh' THEN -1 WHEN 'snapshot_import' THEN 0 WHEN 'catalogue_page' THEN 1 WHEN 'sitemap_index' THEN 2 WHEN 'sitemap_page' THEN 3 WHEN 'title_detail' THEN 4 WHEN 'sitemap_title' THEN 5 WHEN 'title_reconcile' THEN 6 ELSE 7 END,t.available_at,t.id LIMIT ?`).bind(timestamp, timestamp, stale, ...(taskTypes ?? []), limit).all<{ id: number }>();
  if (!due.results.length) return { dispatched: 0, status: 'idle' as const };
  const dispatchToken = crypto.randomUUID();
  try { await reserveWriteBudget(db, `dispatch:${dispatchToken}`, 20 * due.results.length + 16, 3 * due.results.length, budget, now); }
  catch (error) { if (error instanceof QuotaExhaustedError) return { dispatched: 0, status: 'quota_paused' as const, retryAt: error.retryAt }; throw error; }
  let dispatched = 0;
  for (const { id } of due.results) {
    const claim = await db.prepare('UPDATE crawl_tasks SET cloud_dispatched_at=?,cloud_dispatch_token=? WHERE id=? AND (cloud_dispatched_at IS NULL OR cloud_dispatched_at<=?)').bind(timestamp, dispatchToken, id, stale).run();
    if (!claim.meta.changes) continue;
    try { await queue.send({ taskId: id }); dispatched++; }
    catch (error) {
      // A failed send is retried by a later cron. A crash after send produces only a duplicate ID.
      await db.prepare('UPDATE crawl_tasks SET cloud_dispatched_at=NULL,cloud_dispatch_token=NULL WHERE id=? AND cloud_dispatch_token=?').bind(id, dispatchToken).run();
      throw error;
    }
  }
  return { dispatched, status: 'dispatched' as const };
}

/** Every delivery is explicitly acked/retried. The D1 lease rejects duplicates and stale workers. */
export async function consumeSyncMessage(message: Pick<Message<unknown>, 'body' | 'ack' | 'retry'>, db: CatalogueDatabase, handlers: SyncHandlers, budget: SyncBudget = DEFAULT_SYNC_BUDGET, now = new Date()) {
  const body = message.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !Number.isSafeInteger((body as Record<string, unknown>).taskId) || Number((body as Record<string, unknown>).taskId) < 1) { message.ack(); return { status: 'invalid_message' }; }
  const id = Number((body as Record<string, unknown>).taskId);
  const timestamp = now.toISOString(); const lease = crypto.randomUUID();
  const existing = await db.prepare('SELECT t.attempt_count AS attempt,t.task_type AS taskType,r.status AS runStatus,c.enabled FROM crawl_tasks t JOIN crawl_runs r ON r.id=t.run_id JOIN cloud_sync_control c ON c.id=1 WHERE t.id=?').bind(id).first<{ attempt: number; taskType: string; runStatus: string; enabled: number }>();
  if (!existing || !existing.enabled || !['running', 'queued'].includes(existing.runStatus)) { message.ack(); return { status: 'paused_or_absent' }; }
  try { await reserveWriteBudget(db, `task-control:${id}:${lease}`, existing.taskType === 'snapshot_import' ? 80 : 48, 0, budget, now); }
  catch (error) { if (error instanceof QuotaExhaustedError) { message.ack(); return { status: 'quota_paused', retryAt: error.retryAt }; } throw error; }
  const claimed = await db.prepare(`UPDATE crawl_tasks SET status='running',claimed_at=?,claimed_by=?,lease_expires_at=?,attempt_count=attempt_count+1,updated_at=? WHERE id=? AND ((status IN ('pending','retry') AND available_at<=?) OR (status='running' AND (lease_expires_at IS NULL OR lease_expires_at<=?))) RETURNING id,run_id,task_key,task_type,payload_json,checkpoint_json,attempt_count,max_attempts`).bind(timestamp, lease, new Date(now.getTime() + 5 * 60_000).toISOString(), timestamp, id, timestamp, timestamp).first<Record<string, unknown>>();
  if (!claimed) { message.ack(); return { status: 'duplicate_or_not_due' }; }
  const task: SyncTask = { id, runId: Number(claimed.run_id), taskKey: String(claimed.task_key), taskType: String(claimed.task_type), payload: {}, checkpoint: {}, attempt: Number(claimed.attempt_count), maxAttempts: Number(claimed.max_attempts), lease };
  try {
    task.payload = objectJson(claimed.payload_json); task.checkpoint = objectJson(claimed.checkpoint_json);
    const handler = handlers[task.taskType];
    if (!handler) throw new SyncSourceError('No cloud handler is enabled for this recorded task type; the task and payload are retained for review.', 'BLOCKED', false);
    const plan = await handler(task);
    if (plan.statements.length > 30 || !Number.isSafeInteger(plan.estimatedWrittenRows) || plan.estimatedWrittenRows < 0 || JSON.stringify(plan.checkpoint ?? {}).length > 50_000) throw new AppError(422, 'UPSTREAM_CHANGED', 'The synchronization handler exceeded the bounded mutation contract.');
    await reserveWriteBudget(db, `task-data:${id}:${lease}`, plan.estimatedWrittenRows + 32, 0, budget, now);
    const checkpoint = JSON.stringify(plan.checkpoint ?? task.checkpoint);
    const completed = plan.complete !== false;
    const availableAt = new Date(now.getTime() + Math.max(1, Math.min(86_400, plan.retryAfterSeconds ?? 1)) * 1000).toISOString();
    // Guard the entire transaction: a stale worker must not write data after its lease is replaced.
    const leaseCheckAt = new Date().toISOString();
    // content_hash is NOT NULL: losing the lease makes this statement fail and rolls back every mutation.
    const guard = db.prepare("INSERT INTO cloud_import_receipts(id,snapshot_id,table_name,content_hash,row_count,estimated_writes,imported_at) VALUES(?,?,'sync',(SELECT t.claimed_by FROM crawl_tasks t JOIN crawl_runs r ON r.id=t.run_id WHERE t.id=? AND t.claimed_by=? AND t.status='running' AND t.lease_expires_at>? AND r.status IN ('queued','running')),0,0,?)").bind(`sync:${id}:${task.attempt}:${lease}`, String(task.runId), id, lease, leaseCheckAt, timestamp);
    const verifyLease = await db.prepare('SELECT id FROM crawl_tasks WHERE id=? AND claimed_by=? AND status=\'running\' AND lease_expires_at>?').bind(id, lease, new Date().toISOString()).first();
    if (!verifyLease) { message.ack(); return { status: 'stale_lease' }; }
    await db.batch([
      ...plan.statements,
      guard,
      db.prepare("UPDATE crawl_tasks SET status=?,checkpoint_json=?,completed_at=?,available_at=?,attempt_count=CASE WHEN ?=0 THEN 0 ELSE attempt_count END,lease_expires_at=NULL,cloud_dispatched_at=NULL,cloud_dispatch_token=NULL,last_error_code=NULL,last_error_message=NULL,updated_at=? WHERE id=? AND claimed_by=?").bind(completed ? 'completed' : 'retry', checkpoint, completed ? timestamp : null, availableAt, completed ? 1 : 0, timestamp, id, lease),
      db.prepare("UPDATE crawl_runs SET tasks_completed=(SELECT COUNT(*) FROM crawl_tasks WHERE run_id=? AND status='completed'),tasks_discovered=(SELECT COUNT(*) FROM crawl_tasks WHERE run_id=?),status=CASE WHEN NOT EXISTS(SELECT 1 FROM crawl_tasks WHERE run_id=? AND status IN ('pending','running','retry')) THEN CASE WHEN EXISTS(SELECT 1 FROM crawl_tasks WHERE run_id=? AND status IN ('failed','blocked')) THEN 'failed' ELSE 'completed' END ELSE 'running' END,updated_at=? WHERE id=? AND status IN ('queued','running')").bind(task.runId, task.runId, task.runId, task.runId, timestamp, task.runId),
    ]);
    message.ack(); return { status: completed ? 'completed' : 'checkpointed', taskId: id };
  } catch (error) {
    const quota = error instanceof QuotaExhaustedError;
    const source = error instanceof SyncSourceError ? error : null;
    const retryable = quota || (source ? source.retryable : !(error instanceof AppError && error.code === 'UPSTREAM_CHANGED'));
    const retry = retryable && (quota || task.attempt < task.maxAttempts);
    const status = source?.code === 'BLOCKED' ? 'blocked' : retry ? 'retry' : 'failed';
    const availableAt = quota ? error.retryAt : new Date(now.getTime() + Math.max(1, Math.min(7 * 86_400, source?.retryAfterSeconds ?? 30 * 2 ** Math.min(task.attempt, 10))) * 1000).toISOString();
    const code = quota ? error.code : source?.code ?? (error instanceof AppError ? error.code : 'UNAVAILABLE');
    const reason = quota ? error.message : source?.message ?? 'The synchronization attempt failed; previous data and the durable task are preserved.';
    try {
      const update = db.prepare("UPDATE crawl_tasks SET status=?,available_at=?,retry_after_at=?,lease_expires_at=NULL,cloud_dispatched_at=NULL,cloud_dispatch_token=NULL,last_error_code=?,last_error_message=?,last_http_status=?,updated_at=? WHERE id=? AND claimed_by=? AND status='running' AND EXISTS(SELECT 1 FROM crawl_runs r WHERE r.id=crawl_tasks.run_id AND r.status<>'cancelled')").bind(status, availableAt, retry ? availableAt : null, code, reason.slice(0, 1000), source?.httpStatus ?? null, timestamp, id, lease);
      if (status === 'blocked') await db.batch([update, db.prepare("UPDATE crawl_runs SET status='paused',tasks_failed=(SELECT COUNT(*) FROM crawl_tasks WHERE run_id=? AND status IN ('failed','blocked')),updated_at=? WHERE id=? AND status IN ('queued','running') AND changes()>0").bind(task.runId, timestamp, task.runId)]);
      else if (status === 'failed') await db.batch([update, db.prepare("UPDATE crawl_runs SET tasks_failed=(SELECT COUNT(*) FROM crawl_tasks WHERE run_id=? AND status IN ('failed','blocked')),status=CASE WHEN NOT EXISTS(SELECT 1 FROM crawl_tasks WHERE run_id=? AND status IN ('pending','running','retry')) THEN 'failed' ELSE status END,finished_at=CASE WHEN NOT EXISTS(SELECT 1 FROM crawl_tasks WHERE run_id=? AND status IN ('pending','running','retry')) THEN ? ELSE finished_at END,updated_at=? WHERE id=? AND status IN ('queued','running') AND changes()>0").bind(task.runId, task.runId, task.runId, timestamp, timestamp, task.runId)]);
      else await update.run();
      message.ack();
    } catch { message.retry({ delaySeconds: 300 }); }
    return { status, code, taskId: id };
  }
}
