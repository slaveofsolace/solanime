import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnikotoSourceClient } from '../server/ingestion/source.ts';
import { migrate, openDatabase } from '../server/db.ts';
import { claimTask, createRun, enqueueTask } from '../server/ingestion/queue.ts';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('shared source pacing', () => {
  it('returns long shared cooldowns to the durable queue without making another request', async () => {
    vi.stubEnv('SOLANIME_SOURCE_DELAY_MS', '250');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('slow', { status: 429, headers: { 'retry-after': '3600' } })));
    const client = new AnikotoSourceClient();
    await expect(client.text('/filter?page=1', 'html')).rejects.toMatchObject({ retryAfterMs: 3600000 });
    await expect(client.text('/filter?page=2', 'html')).rejects.toMatchObject({ retryable: true, retryAfterMs: expect.any(Number) });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('spaces concurrent starts globally, not once per lane', async () => {
    vi.useFakeTimers(); vi.stubEnv('SOLANIME_SOURCE_DELAY_MS', '250');
    const starts: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => { starts.push(Date.now()); return new Response('{}'); }));
    const client = new AnikotoSourceClient();
    const work = Promise.all([1, 2, 3].map(i => client.text(`/filter?page=${i}`, 'html')));
    await vi.advanceTimersByTimeAsync(500); await work;
    expect(starts.map(t => t - starts[0])).toEqual([0, 250, 500]);
  });
  it('rechecks Retry-After when another lane already began waiting', async () => {
    vi.useFakeTimers(); vi.stubEnv('SOLANIME_SOURCE_DELAY_MS', '250');
    const start = Date.now(); const starts: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => {
      starts.push(Date.now() - start);
      if (starts.length === 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
        return new Response('slow', { status: 429, headers: { 'retry-after': '2' } });
      }
      return new Response('{}');
    }));
    const client = new AnikotoSourceClient();
    const one = client.text('/filter?page=1', 'html').catch(error => error);
    const two = client.text('/filter?page=2', 'html');
    await vi.advanceTimersByTimeAsync(2099); expect(starts).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1); await Promise.all([one, two]);
    expect(starts).toEqual([0, 2100]); expect(client.delayMs).toBe(1200);
  });
  it('stops queued network requests after explicit refusal', async () => {
    vi.useFakeTimers(); vi.stubEnv('SOLANIME_SOURCE_DELAY_MS', '250');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('refused', { status: 403 })));
    const client = new AnikotoSourceClient();
    const outcomes = Promise.allSettled([client.text('/filter?page=1', 'html'), client.text('/filter?page=2', 'html')]);
    await vi.advanceTimersByTimeAsync(500);
    expect((await outcomes).every(item => item.status === 'rejected')).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('backs off overload without Retry-After and keeps queued cancellation working', async () => {
    vi.useFakeTimers(); vi.stubEnv('SOLANIME_SOURCE_DELAY_MS', '250');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('busy', { status: 503 })));
    const client = new AnikotoSourceClient();
    await expect(client.text('/filter?page=1', 'html')).rejects.toMatchObject({ retryAfterMs: 1200 });
    const controller = new AbortController();
    const second = client.text('/filter?page=2', 'html', controller.signal).catch(error => error);
    await vi.advanceTimersByTimeAsync(100); controller.abort();
    expect(await second).toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

it('counts in-flight claims against the durable task budget', () => {
  const db = openDatabase(':memory:');
  try {
    migrate(db); const runId = createRun(db, 'full', 1);
    enqueueTask(db, runId, 'one', 'episode_servers', {});
    enqueueTask(db, runId, 'two', 'episode_servers', {});
    expect(claimTask(db, runId)?.taskKey).toBe('one');
    expect(claimTask(db, runId)).toBeNull();
    expect(db.prepare("SELECT count(*) n FROM crawl_tasks WHERE status='running'").get()).toMatchObject({ n: 1 });
  } finally { db.close(); }
});

it('persists a host cooldown across worker restarts without consuming task attempts', () => {
  const db = openDatabase(':memory:');
  try {
    migrate(db); const runId = createRun(db, 'full');
    enqueueTask(db, runId, 'one', 'episode_servers', {});
    db.prepare('UPDATE crawl_runs SET checkpoint_json=? WHERE id=?').run(JSON.stringify({ sourceRetryAfterAt: new Date(Date.now()+3600000).toISOString() }),runId);
    expect(claimTask(db, runId)).toBeNull();
    expect(db.prepare('SELECT attempt_count FROM crawl_tasks WHERE run_id=?').get(runId)).toMatchObject({ attempt_count: 0 });
    db.prepare('UPDATE crawl_runs SET checkpoint_json=? WHERE id=?').run('{}',runId);
    expect(claimTask(db, runId)?.attemptCount).toBe(1);
  } finally { db.close(); }
});
