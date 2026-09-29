import type { SqliteDatabase } from '../db.ts';

export interface CrawlTask {
  id: number;
  runId: number;
  taskKey: string;
  taskType: string;
  payload: Record<string, unknown>;
  attemptCount: number;
  maxAttempts: number;
}

const now = () => new Date().toISOString();
const MAX_QUEUE_RETRY_AFTER_MS = 7 * 24 * 60 * 60_000;
const WORKER_LEASE_MS = 90_000;

function defaultMaxAttempts(): number {
  const raw = Number(process.env.SOLANIME_SOURCE_MAX_RETRIES ?? 4);
  const retries = Number.isInteger(raw) && raw >= 0 && raw <= 10 ? raw : 4;
  return retries + 1;
}

export function createRun(
  db: SqliteDatabase,
  mode: 'slice' | 'full' | 'incremental' | 'snapshot',
  budget?: number,
): number {
  const timestamp = now();
  const result = db
    .prepare(
      `INSERT INTO crawl_runs(source,mode,status,budget,created_at,updated_at) VALUES ('anikoto',?,'queued',?,?,?)`,
    )
    .run(mode, budget ?? null, timestamp, timestamp);
  return Number(result.lastInsertRowid);
}

export function enqueueTask(
  db: SqliteDatabase,
  runId: number,
  taskKey: string,
  taskType: string,
  payload: Record<string, unknown>,
  maxAttempts = defaultMaxAttempts(),
): void {
  const timestamp = now();
  db.prepare(
    `INSERT INTO crawl_tasks(run_id,task_key,task_type,payload_json,status,max_attempts,available_at,created_at,updated_at) VALUES (?,?,?,?,'pending',?,?,?,?) ON CONFLICT(run_id,task_key) DO NOTHING`,
  ).run(
    runId,
    taskKey,
    taskType,
    JSON.stringify(payload),
    maxAttempts,
    timestamp,
    timestamp,
    timestamp,
  );
  db.prepare(
    `UPDATE crawl_runs SET tasks_discovered=(SELECT COUNT(*) FROM crawl_tasks WHERE run_id=?),updated_at=? WHERE id=?`,
  ).run(runId, timestamp, runId);
}

export function acquireWorkerLease(db: SqliteDatabase, runId: number, workerId: string): boolean {
  const timestamp = now();
  const staleBefore = new Date(Date.now() - WORKER_LEASE_MS).toISOString();
  const result = db
    .prepare(
      `UPDATE crawl_runs SET worker_id=?,worker_heartbeat_at=?,updated_at=? WHERE id=?
    AND (worker_id IS NULL OR worker_id=? OR worker_heartbeat_at IS NULL OR worker_heartbeat_at<=?)`,
    )
    .run(workerId, timestamp, timestamp, runId, workerId, staleBefore);
  return result.changes === 1;
}

export function heartbeatWorkerLease(db: SqliteDatabase, runId: number, workerId: string): boolean {
  const timestamp = now();
  const result = db
    .prepare('UPDATE crawl_runs SET worker_heartbeat_at=?,updated_at=? WHERE id=? AND worker_id=?')
    .run(timestamp, timestamp, runId, workerId);
  return result.changes === 1;
}

export function releaseWorkerLease(db: SqliteDatabase, workerId: string, runId?: number): number {
  const timestamp = now();
  const result =
    runId == null
      ? db
          .prepare(
            'UPDATE crawl_runs SET worker_id=NULL,worker_heartbeat_at=NULL,updated_at=? WHERE worker_id=?',
          )
          .run(timestamp, workerId)
      : db
          .prepare(
            'UPDATE crawl_runs SET worker_id=NULL,worker_heartbeat_at=NULL,updated_at=? WHERE id=? AND worker_id=?',
          )
          .run(timestamp, runId, workerId);
  return Number(result.changes);
}

export function claimTask(db: SqliteDatabase, runId: number, workerId?: string): CrawlTask | null {
  const timestamp = now();
  db.exec('BEGIN IMMEDIATE');
  try {
    const run = db
      .prepare(
        'SELECT status,budget,tasks_completed,tasks_failed,checkpoint_json,worker_id FROM crawl_runs WHERE id=?',
      )
      .get(runId) as
      | {
          status: string;
          budget: number | null;
          tasks_completed: number;
          tasks_failed: number;
          checkpoint_json: string;
          worker_id: string | null;
        }
      | undefined;
    if (
      !run ||
      run.status === 'paused' ||
      ['completed', 'failed', 'cancelled'].includes(run.status)
    ) {
      db.exec('COMMIT');
      return null;
    }
    if (workerId && run.worker_id !== workerId) {
      db.exec('COMMIT');
      throw new Error('The crawl run worker lease is not owned by this process.');
    }
    let sourceRetryAfterAt = 0;
    try { sourceRetryAfterAt = Date.parse(JSON.parse(run.checkpoint_json || '{}').sourceRetryAfterAt ?? ''); }
    catch { /* Preserve legacy malformed checkpoints; existing recovery handles them. */ }
    if (sourceRetryAfterAt > Date.now()) {
      db.exec('COMMIT');
      return null;
    }
    const inFlight = run.budget == null ? 0 : Number((db.prepare(
      "SELECT COUNT(*) AS n FROM crawl_tasks WHERE run_id=? AND status='running'",
    ).get(runId) as { n: number }).n);
    if (run.budget != null && run.tasks_completed + run.tasks_failed + inFlight >= run.budget) {
      let checkpoint: Record<string, unknown> = {};
      try {
        checkpoint = run.checkpoint_json
          ? (JSON.parse(run.checkpoint_json) as Record<string, unknown>)
          : {};
      } catch {
        checkpoint = {};
      }
      db.prepare(
        "UPDATE crawl_runs SET status='paused',checkpoint_json=?,updated_at=? WHERE id=?",
      ).run(JSON.stringify({ ...checkpoint, reason: 'budget_exhausted' }), timestamp, runId);
      db.exec('COMMIT');
      return null;
    }
    const row = db
      .prepare(
        `SELECT id,run_id,task_key,task_type,payload_json,attempt_count,max_attempts FROM crawl_tasks candidate WHERE run_id=? AND status IN ('pending','retry') AND available_at<=?
      AND (task_type<>'catalogue_reconcile' OR NOT EXISTS (
        SELECT 1 FROM crawl_tasks prerequisite WHERE prerequisite.run_id=candidate.run_id
        AND prerequisite.task_type IN ('catalogue_page','sitemap_index','sitemap_page','sitemap_title','title_detail')
        AND prerequisite.status IN ('pending','running','retry')
      ))
      ORDER BY CASE task_type WHEN 'catalogue_page' THEN 0 WHEN 'sitemap_index' THEN 1 WHEN 'sitemap_page' THEN 2 WHEN 'sitemap_title' THEN 3 WHEN 'title_detail' THEN 4 WHEN 'catalogue_reconcile' THEN 5 ELSE 6 END,id LIMIT 1`,
      )
      .get(runId, timestamp) as Record<string, unknown> | undefined;
    if (!row) {
      db.exec('COMMIT');
      return null;
    }
    const leaseExpiresAt = new Date(Date.now() + WORKER_LEASE_MS).toISOString();
    db.prepare(
      "UPDATE crawl_tasks SET status='running',claimed_at=?,claimed_by=?,lease_expires_at=?,attempt_count=attempt_count+1,updated_at=? WHERE id=?",
    ).run(timestamp, workerId ?? null, leaseExpiresAt, timestamp, row.id as number);
    db.prepare(
      "UPDATE crawl_runs SET status='running',started_at=COALESCE(started_at,?),worker_heartbeat_at=CASE WHEN worker_id=? THEN ? ELSE worker_heartbeat_at END,updated_at=? WHERE id=?",
    ).run(timestamp, workerId ?? null, timestamp, timestamp, runId);
    db.exec('COMMIT');
    return {
      id: Number(row.id),
      runId: Number(row.run_id),
      taskKey: String(row.task_key),
      taskType: String(row.task_type),
      payload: JSON.parse(String(row.payload_json)),
      attemptCount: Number(row.attempt_count) + 1,
      maxAttempts: Number(row.max_attempts),
    };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function completeTask(db: SqliteDatabase, task: CrawlTask): void {
  const timestamp = now();
  db.prepare(
    "UPDATE crawl_tasks SET status='completed',completed_at=?,lease_expires_at=NULL,updated_at=?,last_error_code=NULL,last_error_message=NULL WHERE id=?",
  ).run(timestamp, timestamp, task.id);
  db.prepare(
    `UPDATE crawl_runs SET tasks_completed=(SELECT COUNT(*) FROM crawl_tasks WHERE run_id=? AND status='completed'),tasks_failed=(SELECT COUNT(*) FROM crawl_tasks WHERE run_id=? AND status IN ('failed','blocked')),updated_at=? WHERE id=?`,
  ).run(task.runId, task.runId, timestamp, task.runId);
  finishRunIfSettled(db, task.runId);
}

export function failTask(
  db: SqliteDatabase,
  task: CrawlTask,
  code: string,
  message: string,
  httpStatus?: number,
  retryAfterMs?: number,
): void {
  const timestamp = now();
  const retry = task.attemptCount < task.maxAttempts;
  const jitterlessBackoff =
    retryAfterMs == null
      ? Math.min(60_000, 500 * 2 ** Math.max(0, task.attemptCount - 1))
      : Math.min(MAX_QUEUE_RETRY_AFTER_MS, Math.max(0, retryAfterMs));
  const availableAt = new Date(Date.now() + jitterlessBackoff).toISOString();
  db.prepare(
    `UPDATE crawl_tasks SET status=?,available_at=?,retry_after_at=?,lease_expires_at=NULL,last_http_status=?,last_error_code=?,last_error_message=?,updated_at=? WHERE id=?`,
  ).run(
    retry ? 'retry' : 'failed',
    availableAt,
    retry ? availableAt : null,
    httpStatus ?? null,
    code,
    message.slice(0, 2000),
    timestamp,
    task.id,
  );
  db.prepare(
    `UPDATE crawl_runs SET tasks_failed=(SELECT COUNT(*) FROM crawl_tasks WHERE run_id=? AND status IN ('failed','blocked')),updated_at=? WHERE id=?`,
  ).run(task.runId, timestamp, task.runId);
  finishRunIfSettled(db, task.runId);
}

export function terminalFailTask(
  db: SqliteDatabase,
  task: CrawlTask,
  code: string,
  message: string,
  httpStatus?: number,
): void {
  const timestamp = now();
  db.prepare(
    "UPDATE crawl_tasks SET status='failed',retry_after_at=NULL,lease_expires_at=NULL,last_http_status=?,last_error_code=?,last_error_message=?,updated_at=? WHERE id=?",
  ).run(httpStatus ?? null, code, message.slice(0, 2000), timestamp, task.id);
  db.prepare(
    `UPDATE crawl_runs SET tasks_failed=(SELECT COUNT(*) FROM crawl_tasks WHERE run_id=? AND status IN ('failed','blocked')),updated_at=? WHERE id=?`,
  ).run(task.runId, timestamp, task.runId);
  finishRunIfSettled(db, task.runId);
}

export function finishRunIfSettled(db: SqliteDatabase, runId: number): void {
  const pending = (
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM crawl_tasks WHERE run_id=? AND status IN ('pending','running','retry')",
      )
      .get(runId) as { count: number }
  ).count;
  if (pending !== 0) return;
  const failed = (
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM crawl_tasks WHERE run_id=? AND status IN ('failed','blocked')",
      )
      .get(runId) as { count: number }
  ).count;
  const timestamp = now();
  db.prepare('UPDATE crawl_runs SET status=?,finished_at=?,updated_at=? WHERE id=?').run(
    failed ? 'failed' : 'completed',
    timestamp,
    timestamp,
    runId,
  );
}

export function setRunPaused(db: SqliteDatabase, runId: number, paused: boolean): boolean {
  const timestamp = now();
  const result = db
    .prepare(
      `UPDATE crawl_runs SET status=?,updated_at=? WHERE id=? AND status IN ('queued','running','paused')`,
    )
    .run(paused ? 'paused' : 'queued', timestamp, runId);
  return result.changes > 0;
}

export function retryFailedTasks(db: SqliteDatabase, runId: number): number {
  const timestamp = now();
  const result = db
    .prepare(
      "UPDATE crawl_tasks SET status='retry',attempt_count=0,available_at=?,claimed_at=NULL,retry_after_at=NULL,last_error_code=NULL,last_error_message=NULL,updated_at=? WHERE run_id=? AND status='failed'",
    )
    .run(timestamp, timestamp, runId);
  if (result.changes)
    db.prepare(
      "UPDATE crawl_runs SET status='queued',finished_at=NULL,tasks_failed=(SELECT COUNT(*) FROM crawl_tasks WHERE run_id=? AND status IN ('failed','blocked')),updated_at=? WHERE id=?",
    ).run(runId, timestamp, runId);
  return Number(result.changes);
}

export function recoverInterruptedTasks(
  db: SqliteDatabase,
  runId: number,
  workerId?: string,
): number {
  const timestamp = now();
  const result = workerId
    ? db
        .prepare(
          "UPDATE crawl_tasks SET status='retry',available_at=?,claimed_at=NULL,claimed_by=NULL,lease_expires_at=NULL,last_error_code='WORKER_INTERRUPTED',last_error_message='The previous worker lease expired before completing this idempotent task.',updated_at=? WHERE run_id=? AND status='running' AND (claimed_by IS NULL OR claimed_by<>?)",
        )
        .run(timestamp, timestamp, runId, workerId)
    : db
        .prepare(
          "UPDATE crawl_tasks SET status='retry',available_at=?,claimed_at=NULL,claimed_by=NULL,lease_expires_at=NULL,last_error_code='WORKER_INTERRUPTED',last_error_message='The previous worker stopped before completing this idempotent task.',updated_at=? WHERE run_id=? AND status='running'",
        )
        .run(timestamp, timestamp, runId);
  if (result.changes)
    db.prepare(
      "UPDATE crawl_runs SET status='queued',finished_at=NULL,updated_at=? WHERE id=? AND status='running'",
    ).run(timestamp, runId);
  return Number(result.changes);
}

export function blockTask(
  db: SqliteDatabase,
  task: CrawlTask,
  code: string,
  message: string,
  httpStatus?: number,
): void {
  const timestamp = now();
  db.prepare(
    "UPDATE crawl_tasks SET status='blocked',lease_expires_at=NULL,last_http_status=?,last_error_code=?,last_error_message=?,updated_at=? WHERE id=?",
  ).run(httpStatus ?? null, code, message.slice(0, 2000), timestamp, task.id);
  db.prepare(
    `UPDATE crawl_runs SET tasks_failed=(SELECT COUNT(*) FROM crawl_tasks WHERE run_id=? AND status IN ('failed','blocked')),updated_at=? WHERE id=?`,
  ).run(task.runId, timestamp, task.runId);
  finishRunIfSettled(db, task.runId);
}
