import { describe, expect, it, vi } from 'vitest';
import { allowedCloudOrigin, boundedJson, exerciseSnapshotControls, redactReceipt, snapshotState, verifyCloudRuntime } from '../scripts/verify-cloud-runtime.mjs';

describe('bounded live-cloud verification utility', () => {
  it('accepts only exact reviewed origins', () => {
    expect(allowedCloudOrigin('https://cloud-release.solanime.pages.dev')).toBe(true);
    expect(allowedCloudOrigin('https://solanime.pages.dev')).toBe(true);
    for (const value of ['https://solanime.pages.dev/', 'http://solanime.pages.dev', 'https://solanime.pages.dev.attacker.test', 'https://user:pass@solanime.pages.dev', 'http://127.0.0.1']) expect(allowedCloudOrigin(value)).toBe(false);
  });

  it('redacts nested private fields and exact credential values', () => {
    const secret = `test-only-${crypto.randomUUID()}`;
    const result = redactReceipt({ authorization: secret, safe: `prefix:${secret}`, items: [{ content: 'raw-research', token: secret, status: 200 }] }, secret);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain('raw-research');
    expect(result).toMatchObject({ safe: 'prefix:[redacted]', items: [{ status: 200 }] });
  });

  it('bounds streamed JSON and rejects HTML without retaining its body', async () => {
    await expect(boundedJson(new Response(JSON.stringify({ value: 'x'.repeat(100) }), { headers: { 'content-type': 'application/json' } }), 20)).rejects.toThrow('response_too_large');
    await expect(boundedJson(new Response('<html>private response</html>', { headers: { 'content-type': 'text/html' } }))).rejects.toThrow('non_json_response');
    await expect(boundedJson(Response.json({ ok: true }))).resolves.toEqual({ ok: true });
  });

  it('does not issue any request when operator authorization is missing', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const receipt = await verifyCloudRuntime({ origin: 'https://cloud-release.solanime.pages.dev', fetchImpl: fetcher });
    expect(receipt).toMatchObject({ status: 'blocked', requestCount: 0, failure: { reason: 'operator_auth_unavailable' } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('uses the pinned snapshot run state even when an artwork refresh is the latest run', () => {
    const expected = { runId: 1000000001, cursor: 111, totalBatches: 28364, snapshotId: 'a'.repeat(64) };
    const job = { id: expected.snapshotId, runId: expected.runId, taskId: expected.runId, totalBatches: 28364, importedBatches: 111, status: 'retry', runStatus: 'running', availableAt: '2026-09-12T00:00:00Z', errorCode: null };
    const status = { latestRun: { id: 1000000002, source: 'artwork-cloud:test-only', status: 'completed' }, snapshot: { jobs: [job] } };
    expect(snapshotState(status, expected)).toMatchObject({ runId: expected.runId, runStatus: 'running', importedBatches: 111 });
    expect(() => snapshotState({ ...status, snapshot: { jobs: [{ ...job, runStatus: 'failed' }] } }, expected)).toThrow('unrecognized_or_terminal_run');
  });

  it('supports older snapshot responses only when latestRun matches the pinned run identity', () => {
    const expected = { runId: 1000000001, cursor: 111, totalBatches: 28364, snapshotId: 'b'.repeat(64) };
    const job = { id: expected.snapshotId, runId: expected.runId, taskId: expected.runId, totalBatches: 28364, importedBatches: 111, status: 'retry', availableAt: '2026-09-12T00:00:00Z', errorCode: null };
    const status = { latestRun: { id: expected.runId, status: 'queued' }, snapshot: { jobs: [job] } };
    expect(snapshotState(status, expected)).toMatchObject({ runStatus: 'queued' });
    expect(() => snapshotState({ ...status, latestRun: { id: 1000000002, status: 'running' } }, expected)).toThrow('unrecognized_or_terminal_run');
  });

  it('restores dispatch and an active run after a failed pause-state response', async () => {
    const expected = { runId: 1000000001, cursor: 111, totalBatches: 28364, snapshotId: 'a'.repeat(64) };
    const job = { id: expected.snapshotId, runId: expected.runId, taskId: expected.runId, totalBatches: 28364, importedBatches: 111, status: 'retry', availableAt: '2026-09-12T00:00:00.000Z', errorCode: null };
    let enabled = 1, runStatus = 'running'; const mutations: string[] = [];
    const initial = { enabled: true, snapshot: { ...job, status: undefined, taskStatus: job.status, runStatus } };
    const api = async (path: string, check: string, input?: { method?: string; body?: unknown }): Promise<Record<string, unknown>> => {
      if (path === '/api/admin/sync/control') { enabled = (input?.body as { enabled: boolean }).enabled ? 1 : 0; mutations.push(`control:${enabled}`); return { enabled: !!enabled }; }
      if (path === '/api/admin/sync/status') return { control: { enabled } };
      if (path.endsWith('/pause')) { runStatus = 'paused'; mutations.push('pause'); return { status: runStatus }; }
      if (path.endsWith('/resume')) { runStatus = 'queued'; mutations.push('resume'); return { status: runStatus }; }
      if (check === 'paused_snapshot') throw new Error('test-only failed response');
      return { latestRun: { id: expected.runId, status: runStatus }, snapshot: { jobs: [job] } };
    };
    await expect(exerciseSnapshotControls(api, initial, expected)).rejects.toThrow('test-only failed response');
    expect(enabled).toBe(1);
    expect(runStatus).toBe('queued');
    expect(mutations).toEqual(['control:0', 'pause', 'resume', 'control:1']);
  });
});
