import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app';
import { openDatabase, migrate } from '../server/db';
import { openAccountsDatabase } from '../server/accounts/database';
import { createAccounts } from '../server/accounts/service';
import { verifyPassword } from '../server/accounts/passwords';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0)) await dispose();
});
const password = 'a long testing passphrase 2026';
async function fixture(secure = false) {
  const catalog = openDatabase(':memory:');
  migrate(catalog);
  const privateDb = openAccountsDatabase(':memory:');
  let currentTime = Date.now();
  const service = createAccounts(privateDb, { secure, now: () => currentTime });
  const server = createApp(catalog, { accounts: service });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  cleanup.push(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    catalog.close();
  });
  const user = () => {
    let cookie = '',
      csrf = '';
    return {
      get cookie() {
        return cookie;
      },
      get csrf() {
        return csrf;
      },
      async call(path: string, body?: unknown, extra: Record<string, string> = {}) {
        const response = await fetch(origin + '/api/account/' + path, {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            ...(cookie ? { cookie } : {}),
            ...(body === undefined
              ? {}
              : {
                  origin,
                  'content-type': 'application/json',
                  'x-solanime-intent': 'account',
                  'x-csrf-token': csrf,
                }),
            ...extra,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const set = response.headers.get('set-cookie');
        if (set) cookie = set.split(';')[0];
        const json = (await response.json()) as any;
        if (typeof json.csrfToken === 'string') csrf = json.csrfToken;
        return { response, body: json };
      },
    };
  };
  return {
    db: privateDb,
    catalog,
    service,
    origin,
    user,
    advance: (n: number) => {
      currentTime += n;
    },
  };
}
// Password tests execute real memory-hard hashes; allow several operations on shared CI CPUs.
describe('private accounts and profile ownership', { timeout: 20000 }, () => {
  it('creates a salted account, session and one profile without leaking secrets to the catalogue', async () => {
    const f = await fixture(),
      a = f.user();
    const r = await a.call('register', { email: ' First@Example.test ', password });
    expect(r.response.status).toBe(201);
    expect(r.body.profiles).toHaveLength(1);
    expect(r.body.recoveryCode).toMatch(/^[\w-]{43}$/);
    expect(r.body.account.email).toBe('first@example.test');
    expect(r.response.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict');
    expect(r.response.headers.get('cache-control')).toBe('no-store');
    const row = f.db.prepare('SELECT * FROM accounts').get() as any;
    expect(row.password_hash).toMatch(/^scrypt\$1\$131072\$8\$1\$/);
    expect(row.recovery_hash).not.toBe(r.body.recoveryCode);
    expect(await verifyPassword(password, row.password_hash)).toBe(true);
    const session = f.db.prepare('SELECT token_hash FROM sessions').get() as any;
    expect(a.cookie).not.toContain(session.token_hash);
    expect(
      f.catalog.prepare("SELECT name FROM sqlite_master WHERE name='accounts'").get(),
    ).toBeUndefined();
    expect(JSON.stringify((await a.call('session')).body)).not.toContain('password_hash');
  });
  it('requires a valid password and rotates sessions on every login', async () => {
    const f = await fixture(),
      a = f.user();
    await a.call('register', { email: 'signin@example.test', password });
    const before = a.cookie;
    expect(
      (await a.call('login', { email: 'signin@example.test', password: 'wrong' })).response.status,
    ).toBe(401);
    expect(
      (await a.call('login', { email: 'missing@example.test', password: 'wrong' })).body.error
        .message,
    ).toBe('Email or password is incorrect.');
    await a.call('login', { email: 'signin@example.test', password, remember: true });
    expect(a.cookie).not.toBe(before);
    const stale = await fetch(f.origin + '/api/account/session', {
      headers: { cookie: before },
    }).then((r) => r.json());
    expect(stale.account).toBeNull();
    await a.call('logout', {});
    expect((await a.call('session')).body.account).toBeNull();
  });
  it('enforces the five-profile limit in both API and database', async () => {
    const f = await fixture(),
      a = f.user();
    const initial = await a.call('register', { email: 'profiles@example.test', password });
    for (let i = 2; i <= 5; i++)
      expect(
        (await a.call('profiles', { name: 'Viewer ' + i, avatar: 'ocean' })).response.status,
      ).toBe(201);
    expect((await a.call('profiles', { name: 'Six', avatar: 'ruby' })).response.status).toBe(409);
    expect(() =>
      f.db
        .prepare('INSERT INTO profiles(id,account_id,name,avatar,created_at) VALUES(?,?,?,?,?)')
        .run('injected', initial.body.account.id, 'Six', 'ruby', Date.now()),
    ).toThrow('PROFILE_LIMIT');
  });
  it('isolates accounts and profiles and rejects stale write revisions', async () => {
    const f = await fixture(),
      a = f.user(),
      b = f.user();
    const ra = await a.call('register', { email: 'owner@example.test', password });
    await b.call('register', { email: 'other@example.test', password });
    const id = ra.body.profiles[0].id;
    expect((await b.call(`profiles/${id}/data`)).response.status).toBe(404);
    expect(
      (await b.call(`profiles/${id}`, { name: 'Stolen', avatar: 'ocean' })).response.status,
    ).toBe(404);
    const entry = [{ id: '1', name: 'Saved title', slug: 'saved-title' }];
    expect(
      (await a.call(`profiles/${id}/data`, { key: 'watchlist-records', value: entry, revision: 0 }))
        .body.revision,
    ).toBe(1);
    expect(
      (await a.call(`profiles/${id}/data`, { key: 'watchlist-records', value: [], revision: 0 }))
        .response.status,
    ).toBe(409);
    const second = (await a.call('profiles', { name: 'Separate', avatar: 'violet' })).body.profile
      .id;
    expect((await a.call(`profiles/${second}/data`)).body.values).toEqual({});
    expect((await a.call(`profiles/${id}/data`)).body.values['watchlist-records']).toEqual(entry);
  });
  it('rejects cross-origin mutations, missing intent and invalid CSRF', async () => {
    const f = await fixture(),
      a = f.user();
    await a.call('register', { email: 'csrf@example.test', password });
    expect(
      (await a.call('profiles', { name: 'No', avatar: 'ruby' }, { origin: 'https://evil.example' }))
        .response.status,
    ).toBe(403);
    expect(
      (await a.call('profiles', { name: 'No', avatar: 'ruby' }, { 'x-csrf-token': 'invalid' }))
        .response.status,
    ).toBe(403);
    expect((await a.call('logout', {}, { 'x-solanime-intent': '' })).response.status).toBe(403);
    const response = await fetch(f.origin + '/api/account/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'csrf@example.test', password }),
    });
    expect(response.status).toBe(403);
  });
  it('sets host-prefixed secure cookies for HTTPS deployments', async () => {
    const f = await fixture(true),
      a = f.user();
    const r = await a.call('register', { email: 'https@example.test', password });
    const cookie = r.response.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^__Host-solanime_session=/);
    expect(cookie).toContain('; Secure');
    expect(cookie).not.toContain('Domain=');
  });
  it('expires and revokes persisted sessions', async () => {
    const f = await fixture(),
      a = f.user(),
      b = f.user();
    await a.call('register', { email: 'sessions@example.test', password });
    await b.call('login', { email: 'sessions@example.test', password });
    expect((await a.call('sessions')).body.items).toHaveLength(2);
    await a.call('revoke-other-sessions', {});
    expect((await b.call('session')).body.account).toBeNull();
    f.advance(13 * 3600000);
    expect((await a.call('session')).body.account).toBeNull();
  });
  it('rotates single-use recovery codes and invalidates sessions on recovery', async () => {
    const f = await fixture(),
      a = f.user(),
      anonymous = f.user();
    const r = await a.call('register', { email: 'recovery@example.test', password });
    const code = r.body.recoveryCode,
      newPassword = 'a different long passphrase 2026';
    const reset = await anonymous.call('recover', {
      email: 'recovery@example.test',
      recoveryCode: code,
      password: newPassword,
    });
    expect(reset.response.status).toBe(200);
    expect(reset.body.recoveryCode).not.toBe(code);
    expect((await a.call('session')).body.account).toBeNull();
    expect(
      (
        await anonymous.call('recover', {
          email: 'recovery@example.test',
          recoveryCode: code,
          password,
        })
      ).response.status,
    ).toBe(400);
    expect(
      (await anonymous.call('login', { email: 'recovery@example.test', password: newPassword }))
        .response.status,
    ).toBe(200);
  });
  it('requires reauthentication for destructive changes and keeps the last profile', async () => {
    const f = await fixture(),
      a = f.user();
    const r = await a.call('register', { email: 'delete@example.test', password });
    const id = r.body.profiles[0].id;
    expect(
      (await a.call(`profiles/${id}/delete`, { currentPassword: 'wrong' })).response.status,
    ).toBe(401);
    expect(
      (await a.call(`profiles/${id}/delete`, { currentPassword: password })).response.status,
    ).toBe(409);
    const p = (await a.call('profiles', { name: 'Remove me', avatar: 'amber' })).body.profile.id;
    await a.call(`profiles/${p}/data`, {
      key: 'preferences',
      value: { accent: '#AABBCC' },
      revision: 0,
    });
    expect(
      (await a.call(`profiles/${p}/delete`, { currentPassword: password })).response.status,
    ).toBe(200);
    expect(f.db.prepare('SELECT * FROM profile_data WHERE profile_id=?').get(p)).toBeUndefined();
    const exportData = (await a.call('export')).body;
    expect(exportData.account.email).toBe('delete@example.test');
    expect(JSON.stringify(exportData)).not.toMatch(/password_hash|recovery_hash|token_hash/);
    expect((await a.call('delete', { currentPassword: password })).response.status).toBe(200);
    expect(f.db.prepare('SELECT * FROM sessions').all()).toHaveLength(0);
    expect(f.db.prepare('SELECT * FROM profiles').all()).toHaveLength(0);
  });
  it('changes a password, revokes other sessions and rejects the old password', async () => {
    const f = await fixture(),
      a = f.user(),
      b = f.user();
    await a.call('register', { email: 'change@example.test', password });
    await b.call('login', { email: 'change@example.test', password });
    const old = a.cookie;
    expect(
      (
        await a.call('password', {
          currentPassword: password,
          password: 'new longer password in 2026',
        })
      ).response.status,
    ).toBe(200);
    expect(a.cookie).not.toBe(old);
    expect((await b.call('session')).body.account).toBeNull();
    expect(
      (await b.call('login', { email: 'change@example.test', password })).response.status,
    ).toBe(401);
  });
  it('rejects malformed names, avatars, state keys and weak passwords', async () => {
    const f = await fixture(),
      a = f.user();
    expect(
      (await a.call('register', { email: 'validation@example.test', password: 'short' })).response
        .status,
    ).toBe(400);
    const r = await a.call('register', { email: 'validation@example.test', password });
    const id = r.body.profiles[0].id;
    expect((await a.call('profiles', { name: ' ', avatar: 'ruby' })).response.status).toBe(400);
    expect((await a.call('profiles', { name: 'Test', avatar: 'url(evil)' })).response.status).toBe(
      400,
    );
    for (const data of [
      { key: '__proto__', value: {}, revision: 0 },
      { key: 'history', value: null, revision: 0 },
      { key: 'progress:1:sub:hd-1:direct', value: -1, revision: 0 },
      { key: 'preferences', value: {}, revision: -1 },
    ])
      expect((await a.call(`profiles/${id}/data`, data)).response.status).toBe(400);
  });
  it('rate-limits credential guessing with Retry-After', async () => {
    const f = await fixture(),
      a = f.user();
    for (let i = 0; i < 12; i++)
      await a.call('login', { email: 'guess@example.test', password: 'not valid' });
    const r = await a.call('login', { email: 'guess@example.test', password: 'not valid' });
    expect(r.response.status).toBe(429);
    expect(Number(r.response.headers.get('retry-after'))).toBeGreaterThan(0);
  }, 15000);
});
