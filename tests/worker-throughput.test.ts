import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrate, openDatabase } from '../server/db.ts';
import { importSnapshot } from '../server/ingestion/snapshot.ts';
import { createRun, enqueueTask } from '../server/ingestion/queue.ts';
import { runAnikotoWorker } from '../server/ingestion/anikoto.ts';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function fixture(total = 3) {
  const numbers = Array.from({ length: total }, (_, index) => index + 1);
  const db = openDatabase(':memory:'); migrate(db);
  importSnapshot(db, { schemaVersion: 1, source: 'anikoto', observedAt: new Date().toISOString(), titles: [{
    sourceId: 'fixture', slug: 'fixture', canonicalUrl: 'https://anikototv.to/watch/fixture', name: 'Test only',
    episodes: numbers.map(n => ({ sourceId: `e${n}`, number: String(n), slug: `ep-${n}`, canonicalUrl: `https://anikototv.to/watch/fixture/ep-${n}`, versions: [{ sourceId: `e${n}:sub`, language: 'sub', providers: [] }] })),
  }] });
  const runId = createRun(db, 'full');
  for (const n of numbers) enqueueTask(db, runId, `server:${n}`, 'episode_servers', { titleSourceId: 'fixture', episodeSourceId: `e${n}`, serversRef: `ref${n}` });
  return { db, runId };
}
describe('bounded mapping workers', () => {
  it('bounds ten lanes under one shared gate and preserves all mapping identities', async () => {
    const { db, runId } = fixture(12); vi.stubEnv('SOLANIME_SOURCE_DELAY_MS', '50');
    const starts: number[] = []; let active = 0; let peak = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      starts.push(Date.now()); active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 650)); active--;
      const ref = new URL(url).searchParams.get('servers');
      return Response.json({ status: 200, result: `<div class="type" data-type="sub"><button data-link-id="${ref}">HD-1</button></div>` });
    }));
    try {
      await runAnikotoWorker(db, { mode: 'full', runId, concurrency: 10, maxTasksThisProcess: 10 });
      expect(peak).toBeGreaterThan(2); expect(peak).toBeLessThanOrEqual(10); expect(active).toBe(0);
      expect(starts).toHaveLength(10);
      for (let i=1;i<starts.length;i++) expect(starts[i]-starts[i-1]).toBeGreaterThanOrEqual(49);
      expect(db.prepare('SELECT count(DISTINCT source_mapping_id) n FROM episode_provider_mappings').get()).toMatchObject({ n: 10 });
      expect(db.prepare("SELECT count(*) n FROM crawl_tasks WHERE status='pending'").get()).toMatchObject({ n: 2 });
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally { db.close(); }
  });
  it('persists overload cooldown and slower pacing without draining untouched tasks', async () => {
    const { db, runId } = fixture(); vi.stubEnv('SOLANIME_SOURCE_DELAY_MS', '250');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('slow', { status: 429, headers: { 'retry-after': '3600' } })));
    try {
      await runAnikotoWorker(db, { mode: 'full', runId, concurrency: 2, maxTasksThisProcess: 2 });
      expect(fetch).toHaveBeenCalledTimes(1);
      const row = db.prepare('SELECT checkpoint_json FROM crawl_runs WHERE id=?').get(runId)!;
      const checkpoint = JSON.parse(String(row.checkpoint_json));
      expect(Date.parse(checkpoint.sourceRetryAfterAt)-Date.now()).toBeGreaterThan(3590000);
      expect(checkpoint.sourceBackoffDelayMs).toBe(1200);
      expect(db.prepare("SELECT count(*) n FROM crawl_tasks WHERE status='pending' AND attempt_count=0").get()).toMatchObject({ n: 1 });
      expect(db.prepare('SELECT count(*) n FROM episodes').get()).toMatchObject({ n: 3 });
    } finally { db.close(); }
  });
  it('overlaps two requests, keeps mappings attached correctly and preserves exact process cap', async () => {
    const { db, runId } = fixture(); vi.stubEnv('SOLANIME_SOURCE_DELAY_MS', '250');
    let active = 0; let peak = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 350)); active--;
      const ref = new URL(url).searchParams.get('servers');
      return Response.json({ status: 200, result: `<div class="type" data-type="sub"><button data-link-id="${ref}">HD-1</button></div>` });
    }));
    try {
      const result = await runAnikotoWorker(db, { mode: 'full', runId, concurrency: 2, maxTasksThisProcess: 2 });
      expect(result.processed).toBe(2); expect(peak).toBe(2); expect(fetch).toHaveBeenCalledTimes(2);
      expect(db.prepare('SELECT COUNT(*) n FROM episode_provider_mappings').get()).toMatchObject({ n: 2 });
      expect(db.prepare("SELECT COUNT(*) n FROM crawl_tasks WHERE status='pending'").get()).toMatchObject({ n: 1 });
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(db.prepare('SELECT worker_id FROM crawl_runs WHERE id=?').get(runId)).toMatchObject({ worker_id: null });
      await runAnikotoWorker(db, { mode: 'full', runId, concurrency: 2, maxTasksThisProcess: 1 });
      expect(db.prepare('SELECT COUNT(*) n FROM episode_provider_mappings').get()).toMatchObject({ n: 3 });
      expect(db.prepare('SELECT status FROM crawl_runs WHERE id=?').get(runId)).toMatchObject({ status: 'completed' });
    } finally { db.close(); }
  });
  it('holds changed responses without deleting existing records or claiming the rest', async () => {
    const { db, runId } = fixture(); vi.stubEnv('SOLANIME_SOURCE_DELAY_MS', '250');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ changed: true })));
    try {
      await runAnikotoWorker(db, { mode: 'full', runId, concurrency: 2, exitWhenPaused: true });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(db.prepare('SELECT COUNT(*) n FROM episodes').get()).toMatchObject({ n: 3 });
      expect(db.prepare('SELECT status FROM crawl_runs WHERE id=?').get(runId)).toMatchObject({ status: 'paused' });
      expect(db.prepare("SELECT COUNT(*) n FROM crawl_tasks WHERE status='pending'").get()).toMatchObject({ n: 1 });
    } finally { db.close(); }
  });
  it('does not enable mapping concurrency while a discovery prerequisite remains', async () => {
    const { db, runId } = fixture(); vi.stubEnv('SOLANIME_SOURCE_DELAY_MS', '250');
    enqueueTask(db, runId, 'later-discovery', 'title_detail', { sourceId: 'later' });
    db.prepare("UPDATE crawl_tasks SET available_at='2099-01-01T00:00:00Z' WHERE task_key='later-discovery'").run();
    let active = 0; let peak = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 350)); active--;
      return Response.json({ status: 200, result: "<p>You're watching Episode 1. If current servers doesn't work, please try other servers beside.</p>" });
    }));
    try {
      await runAnikotoWorker(db, { mode: 'full', runId, concurrency: 2, maxTasksThisProcess: 2 });
      expect(peak).toBe(1); expect(fetch).toHaveBeenCalledTimes(2);
    } finally { db.close(); }
  });
});
