import type { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/app.ts';
import { migrate, openDatabase, type SqliteDatabase } from '../server/db.ts';
import { importSnapshot } from '../server/ingestion/snapshot.ts';
import { createRun, enqueueTask } from '../server/ingestion/queue.ts';
import { validatePublicSourceUrl } from '../server/security.ts';

const servers: Array<{ close: () => Promise<void>; db: SqliteDatabase }> = [];
const temporaryDirectories: string[] = [];

async function app(options: Parameters<typeof createApp>[1] = {}) {
  const db = openDatabase(':memory:');
  migrate(db);
  importSnapshot(db, {
    schemaVersion: 1,
    source: 'anikoto',
    observedAt: '2026-09-10T00:00:00.000Z',
    titles: [{
      sourceId: 'api-title', slug: 'api-title', canonicalUrl: 'https://anikototv.to/watch/api-title', name: 'API Title', episodes: [{
        sourceId: 'api-episode', number: '1', slug: 'ep-1', canonicalUrl: 'https://anikototv.to/watch/api-title/ep-1', versions: [{
          sourceId: 'api-episode:sub', language: 'sub', providers: [
            { sourceMappingId: 'safe-hash', providerId: 'hd-1', providerResourceId: 'private-opaque-reference' },
            { sourceMappingId: 'safe-hd2-hash', providerId: 'hd-2', providerResourceId: 'second-private-reference' },
            { sourceMappingId: 'safe-kiwi-hash', providerId: 'kiwi', providerResourceId: 'download-only-reference' },
          ],
        }],
      }],
    }],
  });
  const server = createApp(db, options);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const close = () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  servers.push({ close, db });
  return { origin, db };
}

afterEach(async () => {
  for (const item of servers.splice(0)) { await item.close(); item.db.close(); }
  const temporaryRoot = resolve(tmpdir());
  for (const path of temporaryDirectories.splice(0)) {
    if (!resolve(path).startsWith(`${temporaryRoot}${process.platform === 'win32' ? '\\' : '/'}`)) throw new Error(`Refusing to remove non-temporary test directory: ${path}`);
    rmSync(path, { recursive: true, force: true });
  }
  vi.unstubAllEnvs();
});

describe('application HTTP API', () => {
  it('keeps the operational source allowlist on the canonical Anikoto hosts', () => {
    expect(validatePublicSourceUrl('https://anikototv.to/filter').hostname).toBe('anikototv.to');
    expect(() => validatePublicSourceUrl('https://anikotoapi.site/filter')).toThrow(/not allowlisted/i);
  });

  it('serves database-backed browse data and typed input errors', async () => {
    const { origin, db } = await app();
    const catalogueResponse = await fetch(`${origin}/api/titles?q=API`);
    expect(catalogueResponse.headers.get('x-content-type-options')).toBe('nosniff');
    expect(catalogueResponse.headers.get('permissions-policy')).toContain('camera=()');
    const catalogue = await catalogueResponse.json();
    expect(catalogue).toMatchObject({ total: 1, items: [{ name: 'API Title' }] });
    const episodeId = String((db.prepare("SELECT id FROM episodes WHERE source_id='api-episode'").get() as { id: number }).id);
    const providerResponse = await fetch(`${origin}/api/episodes/${episodeId}/providers?language=sub`).then((response) => response.json());
    expect(providerResponse).toMatchObject({
      episode: { id: episodeId, versions: [{ language: 'sub', providerCount: 3 }] },
      version: { language: 'sub', providerCount: 3 },
      providers: expect.arrayContaining([expect.objectContaining({ mappingId: expect.any(String) })]),
    });
    expect(providerResponse.version.id).toEqual(expect.any(String));
    const bad = await fetch(`${origin}/api/titles?pageSize=999`);
    expect(bad.status).toBe(400);
    await expect(bad.json()).resolves.toMatchObject({ error: { code: 'BAD_REQUEST' } });
    const malformedSlug = await fetch(`${origin}/api/titles/%`);
    expect(malformedSlug.status).toBe(400);
    const unsafeEpisodeId = await fetch(`${origin}/api/episodes/999999999999999999999/providers`);
    expect(unsafeEpisodeId.status).toBe(400);
  });

  it('protects diagnostics and keeps opaque provider references out of public exports', async () => {
    const { origin } = await app();
    const diagnostics = await fetch(`${origin}/api/admin/import/status`);
    expect(diagnostics.status).toBe(503);
    await expect(diagnostics.json()).resolves.toMatchObject({ error: { code: 'ADMIN_UNCONFIGURED' } });
    const exported = JSON.stringify(await fetch(`${origin}/api/exports/catalogue.json`).then((response) => response.json()));
    expect(exported).toContain('safe-hash');
    expect(exported).not.toContain('private-opaque-reference');
  });

  it('accepts the configured local admin token without exposing it in responses', async () => {
    vi.stubEnv('SOLANIME_ADMIN_TOKEN', 'unit-test-admin-token');
    const { origin } = await app();
    const response = await fetch(`${origin}/api/admin/import/status`, { headers: { 'x-admin-token': 'unit-test-admin-token' } });
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain('unit-test-admin-token');
  });

  it('rejects an incorrect token and executes authenticated queue and backup controls', async () => {
    vi.stubEnv('SOLANIME_ADMIN_TOKEN', 'unit-test-admin-token');
    const backupDirectory = mkdtempSync(join(tmpdir(), 'solanime-api-'));
    temporaryDirectories.push(backupDirectory);
    const { origin, db } = await app({ backupDirectory });
    const wrong = await fetch(`${origin}/api/admin/import/status`, { headers: { 'x-admin-token': 'wrong-token' } });
    expect(wrong.status).toBe(401);

    const runId = createRun(db, 'full');
    enqueueTask(db, runId, 'title:admin-test', 'title_detail', { sourceId: 'admin-test' });
    const headers = { 'x-admin-token': 'unit-test-admin-token' };
    const paused = await fetch(`${origin}/api/admin/import/${runId}/pause`, { method: 'POST', headers });
    await expect(paused.json()).resolves.toMatchObject({ runId, status: 'paused' });
    const resumed = await fetch(`${origin}/api/admin/import/${runId}/resume`, { method: 'POST', headers });
    await expect(resumed.json()).resolves.toMatchObject({ runId, status: 'queued' });

    db.prepare("UPDATE crawl_tasks SET status='failed',last_error_code='TEST_FAILURE' WHERE run_id=?").run(runId);
    const retried = await fetch(`${origin}/api/admin/import/${runId}/retry`, { method: 'POST', headers });
    await expect(retried.json()).resolves.toMatchObject({ runId, retried: 1 });

    const backupResponse = await fetch(`${origin}/api/admin/backup`, { method: 'POST', headers });
    expect(backupResponse.status).toBe(201);
    const backup = await backupResponse.json() as { path: string; schemaVersion: number };
    expect(resolve(backup.path).startsWith(resolve(backupDirectory))).toBe(true);
    expect(existsSync(backup.path)).toBe(true);
    expect(backup.schemaVersion).toBeGreaterThan(0);
  });

  it('rejects cross-origin and non-JSON provider mutation requests before resolution', async () => {
    const { origin, db } = await app();
    const mappingId = Number((db.prepare("SELECT id FROM episode_provider_mappings WHERE source_mapping_id='safe-kiwi-hash'").get() as { id: number }).id);
    const crossOrigin = await fetch(`${origin}/api/providers/${mappingId}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://example.invalid', 'sec-fetch-site': 'cross-site' },
      body: JSON.stringify({ language: 'sub' }),
    });
    expect(crossOrigin.status).toBe(403);
    const wrongType = await fetch(`${origin}/api/providers/${mappingId}/resolve`, {
      method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}',
    });
    expect(wrongType.status).toBe(415);
    expect((db.prepare("SELECT COUNT(*) AS count FROM verification_observations WHERE entity_type='mapping'").get() as { count: number }).count).toBe(0);
  });

  it('coalesces matching resolutions, applies a short cooldown, and bounds distinct work', async () => {
    let releaseFirst!: () => void;
    let calls = 0;
    const firstGate = new Promise<void>((resolveGate) => { releaseFirst = resolveGate; });
    const firstApp = await app({
      resolutionCooldownMs: 5_000,
      resolveProvider: async (mapping) => {
        calls++;
        await firstGate;
        return { mappingId: mapping.mappingId, providerId: mapping.providerId, playbackType: 'iframe', status: 'resolved', embedUrl: 'https://megaplay.buzz/stream/s-2/test' };
      },
    });
    const mappingId = Number((firstApp.db.prepare("SELECT id FROM episode_provider_mappings WHERE source_mapping_id='safe-hash'").get() as { id: number }).id);
    const resolveRequest = () => fetch(`${firstApp.origin}/api/providers/${mappingId}/resolve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ language: 'sub' }) });
    const first = resolveRequest();
    const second = resolveRequest();
    await vi.waitFor(() => expect(calls).toBe(1));
    releaseFirst();
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect((await resolveRequest()).status).toBe(200);
    expect(calls).toBe(1);
    expect((firstApp.db.prepare("SELECT COUNT(*) AS count FROM verification_observations WHERE entity_type='mapping' AND entity_id=?").get(String(mappingId)) as { count: number }).count).toBe(1);

    const releases: Array<() => void> = [];
    let capacityCalls = 0;
    const capacityApp = await app({
      maxPendingResolutions: 2,
      resolutionCooldownMs: 0,
      resolveProvider: (mapping) => new Promise((resolveResolution) => {
        capacityCalls++;
        releases.push(() => resolveResolution({ mappingId: mapping.mappingId, providerId: mapping.providerId, playbackType: 'iframe', status: 'resolved', embedUrl: 'https://megaplay.buzz/stream/s-2/test' }));
      }),
    });
    const mappingIds = (capacityApp.db.prepare('SELECT id FROM episode_provider_mappings ORDER BY id LIMIT 3').all() as Array<{ id: number }>).map((row) => row.id);
    const pending = mappingIds.slice(0, 2).map((id) => fetch(`${capacityApp.origin}/api/providers/${id}/resolve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
    await vi.waitFor(() => expect(capacityCalls).toBe(2));
    const limited = await fetch(`${capacityApp.origin}/api/providers/${mappingIds[2]}/resolve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('1');
    await expect(limited.json()).resolves.toMatchObject({ error: { code: 'UNAVAILABLE', details: { retryAfterSeconds: 1 } } });
    releases.forEach((release) => release());
    await Promise.all(pending);
  });

  it('records unavailable provider resolutions as failed verification observations', async () => {
    const { origin, db } = await app();
    const mappingId = Number((db.prepare("SELECT id FROM episode_provider_mappings WHERE source_mapping_id='safe-kiwi-hash'").get() as { id: number }).id);

    const response = await fetch(`${origin}/api/providers/${mappingId}/resolve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ language: 'sub' }) });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ status: 'unavailable', mappingId: String(mappingId) });
    expect(db.prepare("SELECT stage,result FROM verification_observations WHERE entity_type='mapping' AND entity_id=? ORDER BY id DESC LIMIT 1").get(String(mappingId))).toMatchObject({ stage: 'failed', result: 'unavailable' });
  });
});
