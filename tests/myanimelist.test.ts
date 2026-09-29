import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { MalClient } from '../server/integrations/myanimelist';
import { malService } from '../server/integrations/malService';
import { sqliteAccountAdapter } from '../server/integrations/sqliteAdapter';
import { encodeBytes } from '../server/cloud/auth/crypto';

const config = { clientId: 'test-client', redirectUri: 'https://solanime.example.test/settings/mal/callback',
  credentialKey: encodeBytes(new Uint8Array(32).fill(5)) };
const entry = (id: number) => ({ node: { id, title: `Anime ${id}`, num_episodes: 12 },
  list_status: { status: 'watching', num_episodes_watched: 2, score: 7 } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const testAccessToken = 'test-access';
const testRefreshToken = 'test-refresh';
const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); });
function fixture() {
  const raw = new DatabaseSync(':memory:'); databases.push(raw);
  raw.exec('PRAGMA foreign_keys=ON; CREATE TABLE accounts(id TEXT PRIMARY KEY); CREATE TABLE profiles(id TEXT PRIMARY KEY);');
  raw.exec("INSERT INTO accounts VALUES('a'); INSERT INTO profiles VALUES('p'),('other');");
  raw.exec(readFileSync(new URL('../migrations/cloud/accounts/0003_myanimelist.sql', import.meta.url), 'utf8'));
  const db = sqliteAccountAdapter(raw);
  const fetcher = vi.fn<typeof fetch>(async input => {
    const url = String(input);
    if (url.endsWith('/token')) return json({ access_token: testAccessToken, refresh_token: testRefreshToken, expires_in: 3600 });
    if (url.endsWith('/users/@me')) return json({ id: 1, name: 'test-member' });
    return json({ data: [entry(10)], paging: {} });
  });
  let time = 1_800_000_000_000;
  const call = malService(db, config, fetcher, () => time);
  const active = vi.fn(async () => {});
  async function connect() {
    const start = await call('p', 'a', 'connect', {}, active) as { url: string };
    const state = new URL(start.url).searchParams.get('state')!;
    await call('p', 'a', 'complete', { state, code: 'test-code' }, active);
    return { state, url: start.url };
  }
  return { raw, db, fetcher, call, active, connect, advance: (ms: number) => { time += ms; } };
}

describe('official MAL client', () => {
  it('uses the documented PKCE flow and rejects foreign pagination without fetching it', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => json({ data: [entry(1)], paging: { next: 'https://other.example.test/?offset=500' } }));
    const client = new MalClient(config, fetcher);
    const url = new URL(client.authorizationUrl('state', 'verifier'));
    expect(url.searchParams.get('code_challenge_method')).toBe('plain');
    expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri);
    await expect(client.list('token')).rejects.toMatchObject({ status: 502, code: 'INVALID_RESPONSE' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.redirect).toBe('error');
  });
  it.each(['not a URL', 'https://api.myanimelist.net/v2/users/@me/animelist?offset=0'])('rejects malformed or stalled paging: %s', async next => {
    const client = new MalClient(config, async () => json({ data: [entry(1)], paging: { next } }));
    await expect(client.list('token')).rejects.toMatchObject({ status: 502 });
  });
  it('keeps provider authorization errors separate from Solanime session expiry', async () => {
    await expect(new MalClient(config, async () => json({}, 401)).list('token')).rejects.toMatchObject({ status: 409 });
    await expect(new MalClient(config, async () => new Response('', { status: 429, headers: { 'retry-after': '12' } })).list('token'))
      .rejects.toMatchObject({ status: 429, details: { retryAfterSeconds: 12 } });
  });
  it('validates list schema and confirms every explicit write response', async () => {
    await expect(new MalClient(config, async () => json({ data: [{ node: {} }], paging: {} })).list('token')).rejects.toMatchObject({ status: 502 });
    const send = vi.fn<typeof fetch>(async () => json({ status: 'completed', num_episodes_watched: 12 }));
    await expect(new MalClient(config, send).update('token', 10, 'completed', 12)).resolves.toEqual({ status: 'completed', watchedEpisodes: 12 });
    expect(send.mock.calls[0][1]?.method).toBe('PATCH');
    await expect(new MalClient(config, async () => json({})).update('token', 10, 'watching', 2)).rejects.toMatchObject({ status: 502 });
  });
});

describe('private profile MAL integration', () => {
  it('encrypts credentials, binds state to a profile and rejects replay', async () => {
    const f = fixture();
    const start = await f.call('p', 'a', 'connect', {}, f.active) as { url: string };
    const state = new URL(start.url).searchParams.get('state')!;
    await expect(f.call('other', 'a', 'complete', { state, code: 'code' }, f.active)).rejects.toMatchObject({ status: 400 });
    await f.call('p', 'a', 'complete', { state, code: 'code' }, f.active);
    await expect(f.call('p', 'a', 'complete', { state, code: 'code' }, f.active)).rejects.toMatchObject({ status: 400 });
    const cipher = f.raw.prepare('SELECT credential_cipher FROM mal_connections WHERE profile_id=?').get('p')!.credential_cipher;
    expect(cipher).not.toContain('test-access'); expect(cipher).not.toContain('test-refresh');
    const status = await f.call('p', 'a', 'status', {}, f.active);
    expect(status).toMatchObject({ connected: true, username: 'test-member' });
    expect(JSON.stringify(status)).not.toContain('credential');
    expect(await f.call('other', 'a', 'list', {}, f.active)).toMatchObject({ items: [] });
  });
  it('expires authorization and releases its lease after failure', async () => {
    const f = fixture();
    const start = await f.call('p', 'a', 'connect', {}, f.active) as { url: string };
    f.advance(600001);
    await expect(f.call('p', 'a', 'complete', { state: new URL(start.url).searchParams.get('state'), code: 'code' }, f.active)).rejects.toMatchObject({ status: 400 });
    expect(f.raw.prepare('SELECT lease_token FROM mal_connections WHERE profile_id=?').get('p')!.lease_token).toBeNull();
  });
  it('retains its committed list through failure and resumes a staged import', async () => {
    const f = fixture(); await f.connect(); await f.call('p', 'a', 'sync', {}, f.active);
    f.fetcher.mockImplementationOnce(async () => json({ data: [entry(20)], paging: { next: 'https://api.myanimelist.net/v2/users/@me/animelist?offset=500' } }));
    expect(await f.call('p', 'a', 'sync', {}, f.active)).toMatchObject({ complete: false, nextOffset: 500 });
    expect(await f.call('p', 'a', 'list', {}, f.active)).toMatchObject({ items: [{ id: 10 }] });
    await expect(f.call('p', 'a', 'update', { id: 10, status: 'completed', watchedEpisodes: 12 }, f.active)).rejects.toMatchObject({ status: 409 });
    f.fetcher.mockImplementationOnce(async () => json({}, 503));
    await expect(f.call('p', 'a', 'sync', {}, f.active)).rejects.toMatchObject({ status: 502 });
    expect(await f.call('p', 'a', 'list', {}, f.active)).toMatchObject({ items: [{ id: 10 }] });
    f.fetcher.mockImplementationOnce(async input => {
      expect(new URL(String(input)).searchParams.get('offset')).toBe('500');
      return json({ data: [entry(30)], paging: {} });
    });
    await f.call('p', 'a', 'sync', {}, f.active);
    expect(await f.call('p', 'a', 'list', {}, f.active)).toMatchObject({ items: [{ id: 20 }, { id: 30 }] });
  });
  it('only writes explicitly imported IDs and permits disconnect when configuration is disabled', async () => {
    const f = fixture(); await f.connect();
    await expect(f.call('p', 'a', 'update', { id: 10 }, f.active)).rejects.toMatchObject({ status: 404 });
    await f.call('p', 'a', 'sync', {}, f.active);
    f.fetcher.mockImplementationOnce(async () => json({ status: 'completed', num_episodes_watched: 12 }));
    expect(await f.call('p', 'a', 'update', { id: 10, status: 'completed', watchedEpisodes: 12 }, f.active)).toMatchObject({ item: { id: 10, status: 'completed' } });
    const disabled = malService(f.db, {});
    await disabled('p', 'a', 'disconnect', {}, f.active);
    expect(f.raw.prepare('SELECT count(*) AS n FROM mal_list_items').get()!.n).toBe(0);
  });
  it('does not publish fetched data after the owning session is revoked', async () => {
    const f = fixture(); await f.connect();
    f.fetcher.mockImplementationOnce(async () => {
      f.active.mockRejectedValue(new Error('Session revoked'));
      return json({ data: [entry(99)], paging: {} });
    });
    await expect(f.call('p', 'a', 'sync', {}, f.active)).rejects.toThrow('Session revoked');
    expect(f.raw.prepare('SELECT count(*) AS n FROM mal_list_items').get()!.n).toBe(0);
  });
});
