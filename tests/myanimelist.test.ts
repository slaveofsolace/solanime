import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { MalPublicClient } from '../server/integrations/myanimelist';
import { malService } from '../server/integrations/malService';
import { sqliteAccountAdapter } from '../server/integrations/sqliteAdapter';

const entry = (id: number, score = 7) => ({ node: { id, title: `Anime ${id}`, num_episodes: 12 },
  list_status: { status: 'completed', num_episodes_watched: 12, score } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); });
function fixture(fetcher = vi.fn<typeof fetch>(async () => json({ data: [entry(10), entry(11, 0)], paging: {} })), clientId: string | undefined = 'public-client-id') {
  const raw = new DatabaseSync(':memory:'); databases.push(raw);
  raw.exec('PRAGMA foreign_keys=ON; CREATE TABLE accounts(id TEXT PRIMARY KEY); CREATE TABLE profiles(id TEXT PRIMARY KEY);');
  raw.exec("INSERT INTO accounts VALUES('a'); INSERT INTO profiles VALUES('p'),('other');");
  raw.exec(readFileSync(new URL('../migrations/cloud/accounts/0003_myanimelist.sql', import.meta.url), 'utf8'));
  const call = malService(sqliteAccountAdapter(raw), { clientId }, fetcher, () => 1_800_000_000_000);
  const active = vi.fn(async () => {});
  return { raw, fetcher, active, call: (action: string, input: Record<string, unknown> = {}, profile = 'p') => call(profile, 'a', action, input, active) };
}

describe('public MyAnimeList list client', () => {
  it('reads a public list with only the client ID header and never follows upstream URLs', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => json({ data: [entry(1)], paging: { next: 'https://other.example.test/?offset=1000' } }));
    await expect(new MalPublicClient('cid', fetcher).list('someone')).rejects.toMatchObject({ status: 502 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toMatch(/^https:\/\/api\.myanimelist\.net\/v2\/users\/someone\/animelist\?/);
    expect((init?.headers as Record<string, string>)['X-MAL-CLIENT-ID']).toBe('cid');
    expect(JSON.stringify(init?.headers)).not.toMatch(/authorization/i);
    expect(init?.redirect).toBe('manual');
  });
  it('explains private lists and unknown members', async () => {
    await expect(new MalPublicClient('cid', async () => new Response('', { status: 403 })).list('someone')).rejects.toMatchObject({ status: 403 });
    await expect(new MalPublicClient('cid', async () => new Response('', { status: 404 })).list('someone')).rejects.toMatchObject({ status: 404 });
    await expect(new MalPublicClient('cid', async () => json({})).list('bad name!')).rejects.toMatchObject({ status: 400 });
  });
});

describe('MyAnimeList list import', () => {
  it('imports by username, replaces the previous generation, and stores no credential', async () => {
    const t = fixture();
    expect(await t.call('status')).toMatchObject({ configured: true, usernameImport: true, connected: false, count: 0 });
    expect(await t.call('import-username', { username: 'someone' })).toEqual({ imported: 2, username: 'someone' });
    expect(await t.call('status')).toMatchObject({ connected: true, username: 'someone', count: 2 });
    expect((await t.call('list') as { items: unknown[] }).items).toHaveLength(2);
    await t.call('import-username', { username: 'someone' });
    expect(t.raw.prepare('SELECT count(*) AS n FROM mal_list_items').get()).toEqual({ n: 2 });
    expect(t.raw.prepare('SELECT credential_cipher FROM mal_connections').get()).toEqual({ credential_cipher: null });
    expect(t.active).toHaveBeenCalled();
  });
  it('keeps the previous list when an import fails', async () => {
    const t = fixture();
    await t.call('import-username', { username: 'someone' });
    t.fetcher.mockImplementation(async () => new Response('', { status: 500 }));
    await expect(t.call('import-username', { username: 'someone' })).rejects.toMatchObject({ status: 502 });
    expect(await t.call('status')).toMatchObject({ connected: true, count: 2 });
  });
  it('imports an export file without any MyAnimeList configuration', async () => {
    const t = fixture(vi.fn(), '');
    expect(await t.call('status')).toMatchObject({ usernameImport: false });
    await expect(t.call('import-username', { username: 'someone' })).rejects.toMatchObject({ status: 503 });
    const entries = [{ id: 5, title: 'Five', status: 'completed', score: 9, watchedEpisodes: 12, totalEpisodes: 12 },
      { id: 5, title: 'Five', status: 'completed', score: 9, watchedEpisodes: 12, totalEpisodes: 12 },
      { id: 6, title: 'Six', status: 'plan_to_watch', score: 0, watchedEpisodes: 0, totalEpisodes: null }];
    expect(await t.call('import-file', { entries, username: 'member' })).toEqual({ imported: 2, username: 'member' });
    await expect(t.call('import-file', { entries: [{ id: 'x' }] })).rejects.toMatchObject({ status: 400 });
    expect(await t.call('status')).toMatchObject({ connected: true, count: 2 });
  });
  it('keeps profiles isolated and removes only the imported list', async () => {
    const t = fixture();
    await t.call('import-username', { username: 'someone' });
    expect(await t.call('status', {}, 'other')).toMatchObject({ connected: false, count: 0 });
    expect(await t.call('remove')).toEqual({ removed: true });
    expect(await t.call('status')).toMatchObject({ connected: false });
  });
  it('rejects concurrent imports for the same profile', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const t = fixture(vi.fn<typeof fetch>(async () => { await gate; return json({ data: [entry(10)], paging: {} }); }));
    const first = t.call('import-username', { username: 'someone' });
    await new Promise(resolve => setTimeout(resolve, 10));
    await expect(t.call('import-username', { username: 'someone' })).rejects.toMatchObject({ status: 409 });
    release(); await first;
  });
});
