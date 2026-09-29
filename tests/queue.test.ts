import { describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '../server/db.ts';
import {
  acquireWorkerLease,
  blockTask,
  claimTask,
  completeTask,
  createRun,
  enqueueTask,
  failTask,
  recoverInterruptedTasks,
  releaseWorkerLease,
  retryFailedTasks,
  terminalFailTask,
} from '../server/ingestion/queue.ts';
import { captureCoverage, runAnikotoWorker } from '../server/ingestion/anikoto.ts';

describe('durable crawl queue', () => {
  it('installs the pending-priority index idempotently without changing priority or future retries', () => {
    const db = openDatabase(':memory:');
    try {
      migrate(db); migrate(db);
      const runId = createRun(db, 'full');
      enqueueTask(db, runId, 'server-first-id', 'episode_servers', {});
      enqueueTask(db, runId, 'future-page', 'catalogue_page', {});
      enqueueTask(db, runId, 'ready-title', 'title_detail', {});
      db.prepare("UPDATE crawl_tasks SET status='retry',available_at='2099-01-01T00:00:00Z' WHERE task_key='future-page'").run();
      expect(claimTask(db, runId)?.taskKey).toBe('ready-title');
      expect(claimTask(db, runId)?.taskKey).toBe('server-first-id');
      expect(claimTask(db, runId)).toBeNull();
      expect(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='idx_tasks_pending_priority'").get()).toMatchObject({ n: 1 });
      expect(db.prepare("SELECT count(*) n FROM crawl_tasks WHERE task_key='future-page' AND status='retry'").get()).toMatchObject({ n: 1 });
    } finally { db.close(); }
  });
  it('rejects a second live worker lease for the same crawl run', () => {
    const db = openDatabase(':memory:');
    try {
      migrate(db);
      const runId = createRun(db, 'full');
      expect(acquireWorkerLease(db, runId, 'worker-a')).toBe(true);
      expect(acquireWorkerLease(db, runId, 'worker-b')).toBe(false);
      expect(releaseWorkerLease(db, 'worker-a', runId)).toBe(1);
      expect(acquireWorkerLease(db, runId, 'worker-b')).toBe(true);
    } finally {
      db.close();
    }
  });

  it('recovers an interrupted claimed task and completes it idempotently', () => {
    const db = openDatabase(':memory:');
    try {
      migrate(db);
      const runId = createRun(db, 'full');
      enqueueTask(db, runId, 'catalogue:1', 'catalogue_page', { page: 1 });
      expect(claimTask(db, runId)?.taskKey).toBe('catalogue:1');
      expect(recoverInterruptedTasks(db, runId)).toBe(1);
      const recovered = claimTask(db, runId);
      expect(recovered?.attemptCount).toBe(2);
      completeTask(db, recovered!);
      expect(claimTask(db, runId)).toBeNull();
      expect(
        (db.prepare('SELECT status FROM crawl_runs WHERE id=?').get(runId) as { status: string })
          .status,
      ).toBe('completed');
    } finally {
      db.close();
    }
  });

  it('records retryable failures and exposes them for controlled retry', () => {
    const db = openDatabase(':memory:');
    try {
      migrate(db);
      const runId = createRun(db, 'slice');
      enqueueTask(db, runId, 'title:bad', 'title_detail', { sourceId: 'bad' }, 1);
      const task = claimTask(db, runId)!;
      failTask(db, task, 'UPSTREAM_CHANGED', 'Malformed response');
      expect(
        (db.prepare('SELECT status FROM crawl_tasks WHERE id=?').get(task.id) as { status: string })
          .status,
      ).toBe('failed');
      expect(retryFailedTasks(db, runId)).toBe(1);
      expect(claimTask(db, runId)?.attemptCount).toBe(1);
    } finally {
      db.close();
    }
  });

  it('keeps explicit access blocks quarantined while retrying only ordinary failed tasks', () => {
    const db = openDatabase(':memory:');
    try {
      migrate(db);
      const runId = createRun(db, 'full');
      enqueueTask(db, runId, 'blocked', 'title_detail', { sourceId: 'blocked' });
      enqueueTask(db, runId, 'gone', 'title_detail', { sourceId: 'gone' });
      blockTask(db, claimTask(db, runId)!, 'BLOCKED', 'Access refused', 403);
      terminalFailTask(db, claimTask(db, runId)!, 'UNAVAILABLE', 'Gone', 404);
      expect(retryFailedTasks(db, runId)).toBe(1);
      expect(
        db.prepare("SELECT status FROM crawl_tasks WHERE task_key='blocked'").get(),
      ).toMatchObject({ status: 'blocked' });
      expect(
        db.prepare("SELECT status FROM crawl_tasks WHERE task_key='gone'").get(),
      ).toMatchObject({ status: 'retry' });
    } finally {
      db.close();
    }
  });

  it('preserves Retry-After values beyond the old one-minute cap', () => {
    const db = openDatabase(':memory:');
    try {
      migrate(db);
      const runId = createRun(db, 'full');
      enqueueTask(db, runId, 'slow', 'title_detail', { sourceId: 'slow' });
      const before = Date.now();
      failTask(db, claimTask(db, runId)!, 'UNAVAILABLE', 'Retry later', 429, 3_600_000);
      const row = db
        .prepare("SELECT available_at AS availableAt FROM crawl_tasks WHERE task_key='slow'")
        .get() as { availableAt: string };
      expect(new Date(row.availableAt).getTime() - before).toBeGreaterThanOrEqual(3_599_000);
    } finally {
      db.close();
    }
  });

  it('prioritizes unfinished discovery before the long provider-enrichment tail', () => {
    const db = openDatabase(':memory:');
    try {
      migrate(db);
      const runId = createRun(db, 'full');
      enqueueTask(db, runId, 'servers:1', 'episode_servers', { episodeSourceId: '1' });
      enqueueTask(db, runId, 'sitemap:index', 'sitemap_index', {});
      expect(claimTask(db, runId)?.taskType).toBe('sitemap_index');
    } finally {
      db.close();
    }
  });

  it('preserves crawl checkpoints when an explicit task budget pauses the run', () => {
    const db = openDatabase(':memory:');
    try {
      migrate(db);
      const runId = createRun(db, 'full', 1);
      enqueueTask(db, runId, 'catalogue:1', 'catalogue_page', { page: 1 });
      enqueueTask(db, runId, 'catalogue:2', 'catalogue_page', { page: 2 });
      db.prepare('UPDATE crawl_runs SET checkpoint_json=? WHERE id=?').run(
        JSON.stringify({ lastCataloguePageImported: 1, sitemapChildrenDiscovered: 293 }),
        runId,
      );
      completeTask(db, claimTask(db, runId)!);

      expect(claimTask(db, runId)).toBeNull();
      const run = db
        .prepare('SELECT status,checkpoint_json AS checkpoint FROM crawl_runs WHERE id=?')
        .get(runId) as { status: string; checkpoint: string };
      expect(run.status).toBe('paused');
      expect(JSON.parse(run.checkpoint)).toMatchObject({
        lastCataloguePageImported: 1,
        sitemapChildrenDiscovered: 293,
        reason: 'budget_exhausted',
      });
    } finally {
      db.close();
    }
  });

  it('reconstructs the filter denominator from durable title tasks for older checkpoints', () => {
    const db = openDatabase(':memory:');
    try {
      migrate(db);
      const runId = createRun(db, 'full');
      enqueueTask(db, runId, 'title:1', 'title_detail', { sourceId: '1' });
      enqueueTask(db, runId, 'title:2', 'title_detail', { sourceId: '2' });
      enqueueTask(db, runId, 'sitemap-title:3', 'sitemap_title', { sourceId: '3' });
      enqueueTask(db, runId, 'sitemap-page:1', 'sitemap_page', {
        url: 'https://anikototv.to/sitemap/episodes-1.xml',
      });
      db.prepare("UPDATE crawl_tasks SET status='completed',completed_at=? WHERE run_id=?").run(
        new Date().toISOString(),
        runId,
      );
      db.prepare('UPDATE crawl_runs SET checkpoint_json=? WHERE id=?').run(
        JSON.stringify({ catalogueLastPageObserved: 298, lastCataloguePageImported: 298 }),
        runId,
      );

      captureCoverage(db, runId);

      const coverage = db
        .prepare(
          'SELECT discovered_titles AS discoveredTitles,denominator_scope AS scope FROM coverage_snapshots WHERE run_id=? ORDER BY id DESC LIMIT 1',
        )
        .get(runId) as { discoveredTitles: number; scope: string };
      expect(coverage.discoveredTitles).toBe(3);
      expect(coverage.scope).toContain('from 2 /filter records plus 1 sitemap-only routes');
    } finally {
      db.close();
    }
  });

  it('adds and executes a durable discovery reconciler for an older complete run checkpoint', async () => {
    const db = openDatabase(':memory:');
    try {
      migrate(db);
      const runId = createRun(db, 'full');
      enqueueTask(db, runId, 'catalogue:1', 'catalogue_page', { page: 1 });
      enqueueTask(db, runId, 'sitemap:index', 'sitemap_index', {});
      enqueueTask(db, runId, 'title:1', 'title_detail', { sourceId: '1' });
      db.prepare("UPDATE crawl_tasks SET status='completed',completed_at=? WHERE run_id=?").run(
        new Date().toISOString(),
        runId,
      );
      db.prepare(
        "UPDATE crawl_runs SET status='queued',started_at=?,checkpoint_json=? WHERE id=?",
      ).run(
        '2026-09-10T00:00:00.000Z',
        JSON.stringify({ cataloguePageLimit: 1, catalogueLastPageObserved: 1 }),
        runId,
      );
      await runAnikotoWorker(db, { runId, mode: 'full', maxTasksThisProcess: 1 });
      const row = db
        .prepare("SELECT status FROM crawl_tasks WHERE task_key='catalogue:reconcile'")
        .get();
      const checkpoint = JSON.parse(
        (
          db
            .prepare('SELECT checkpoint_json AS checkpoint FROM crawl_runs WHERE id=?')
            .get(runId) as { checkpoint: string }
        ).checkpoint,
      );
      expect(row).toMatchObject({ status: 'completed' });
      expect(checkpoint).toMatchObject({
        visibleFilterRecordDenominator: 1,
        discoveryReconciledAt: expect.any(String),
      });
    } finally {
      db.close();
    }
  });
});
