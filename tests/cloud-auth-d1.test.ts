import { describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { D1AccountsRepository } from '../server/cloud/auth/repository';
import { digest, encodeBytes, randomToken } from '../server/cloud/auth/crypto';
import { createCloudAccounts } from '../server/cloud/auth/index';
import type { IdentityCredentials, IdentityUser, ManagedIdentity } from '../server/cloud/auth/types';
import { generatedTestPassphrase, generatedTestToken } from './helpers/auth-material';

describe('private account SQL in the actual D1 runtime', () => {
  it('migrates, applies atomic limits and rolls back failed batches', async () => {
    const root = fileURLToPath(new URL('../.cache/cloud-auth-d1/', import.meta.url));
    mkdirSync(root, { recursive: true });
    const runtime = new Miniflare({ ...convertV4MiniflareOptions({ modules: true,
      script: 'export default { fetch() { return new Response("D1 account contract test") } }',
      compatibilityDate: '2026-09-12', compatibilityFlags: ['nodejs_compat'], d1Databases: { ACCOUNTS: 'test-private-accounts' },
    }), resourceTmpPath: mkdtempSync(root + 'runtime-') });
    try {
      const db = await runtime.getD1Database('ACCOUNTS');
      const migration = readFileSync(new URL('../migrations/cloud/accounts/0001_accounts.sql', import.meta.url), 'utf8');
      // D1.exec treats each newline as a separate command; run complete migration statements,
      // retaining semicolons inside trigger BEGIN/END blocks as Wrangler migrations do.
      await db.batch(migration.split(/;\s*\n(?=(?:CREATE|INSERT))/).filter((sql) => sql.trim()).map((sql) => db.prepare(sql)));
      const approval = readFileSync(new URL('../migrations/cloud/accounts/0004_private_approval.sql', import.meta.url), 'utf8');
      await db.batch(approval.split(/;\s*\n(?=(?:ALTER|CREATE))/).filter((sql) => sql.trim()).map((sql) => db.prepare(sql)));
      const repository = new D1AccountsRepository(db);
      const now = 1800000000000;
      const { account } = await repository.ensureAccount({ uid: 'd1-contract-account', email: 'd1@example.test', emailVerified: false,
        createdAt: now, validSince: 0, passwordUpdatedAt: 0, disabled: false }, await digest(randomToken()), now);
      const session = { token_hash: await digest(randomToken()), account_id: account.id, csrf: randomToken(), created_at: now,
        last_seen: now, expires_at: now + 100000, device: 'D1 test', auth_revision: account.auth_revision,
        credential_cipher: 'test-only-not-a-real-credential', checked_at: now };
      await repository.insertSession(session);
      const created = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => repository.createProfile(session, { name: `Viewer ${i}`, avatar: 'ruby' }, now)));
      expect(created.filter((x) => x.status === 'fulfilled')).toHaveLength(4);
      expect(await repository.profiles(account.id)).toHaveLength(5);
      const profile = (await repository.profiles(account.id))[0].id;
      const writes = await Promise.allSettled(['[]', '["test"]'].map((value) => repository.putData(session, profile, 'history', value, 0, now)));
      expect(writes.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      expect((await repository.dataFor(profile, account.id)).revisions.history).toBe(1);
      await expect(db.batch([
        db.prepare('UPDATE accounts SET email_verified=1 WHERE id=?').bind(account.id),
        db.prepare('INSERT INTO profiles(id,account_id,name,avatar,created_at) VALUES(?,?,?,?,?)')
          .bind(crypto.randomUUID(), account.id, 'No sixth', 'ruby', now),
      ])).rejects.toThrow('PROFILE_LIMIT');
      expect((await repository.account(account.id))?.email_verified).toBe(0);
      const rates = await Promise.allSettled([1, 2, 3].map(() => repository.rate('test-rate', 2, 10000, now)));
      expect(rates.filter((x) => x.status === 'fulfilled')).toHaveLength(2);
      const deletion = await repository.startOperation(account, 'deleting', now, session);
      await expect(repository.deleteAccount(account.id, deletion)).resolves.toBeUndefined();
      expect(await repository.account(account.id)).toBeNull();
      expect(await repository.profiles(account.id)).toEqual([]);
      expect((await db.prepare('SELECT * FROM profile_data').all()).results).toEqual([]);
      expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    } finally { await runtime.dispose(); }
  }, 30000);

  it('runs the HTTP bridge against request-scoped primary D1 sessions under concurrent profile and revision changes', async () => {
    const root = fileURLToPath(new URL('../.cache/cloud-auth-d1-bridge/', import.meta.url));
    mkdirSync(root, { recursive: true });
    const runtime = new Miniflare({ ...convertV4MiniflareOptions({ modules: true,
      script: 'export default { fetch() { return new Response("D1 bridge contract test") } }',
      compatibilityDate: '2026-09-12', compatibilityFlags: ['nodejs_compat'], d1Databases: { ACCOUNTS: 'test-bridge-private-accounts' },
    }), resourceTmpPath: mkdtempSync(root + 'runtime-') });
    try {
      const db = await runtime.getD1Database('ACCOUNTS');
      const migration = readFileSync(new URL('../migrations/cloud/accounts/0001_accounts.sql', import.meta.url), 'utf8');
      await db.batch(migration.split(/;\s*\n(?=(?:CREATE|INSERT))/).filter(sql => sql.trim()).map(sql => db.prepare(sql)));
      const approval = readFileSync(new URL('../migrations/cloud/accounts/0004_private_approval.sql', import.meta.url), 'utf8');
      await db.batch(approval.split(/;\s*\n(?=(?:ALTER|CREATE))/).filter(sql => sql.trim()).map(sql => db.prepare(sql)));
      const now = 1800000000000;
      const origin = 'https://d1-auth-contract.example.test';
      const password = generatedTestPassphrase('D1 bridge');
      const refreshCredential = generatedTestToken('D1 refresh');
      const users = new Map<string, IdentityUser & { password: string }>();
      const credentials = (user: IdentityUser): IdentityCredentials => ({ uid: user.uid, idToken: 'test-only-id-token',
        refreshToken: refreshCredential, authenticatedAt: now, expiresAt: now + 3600000 });
      // Only the external identity transport is deterministic. The actual bridge,
      // encryption, migrations, D1 SQL, triggers and request-scoped sessions run here.
      const identity: ManagedIdentity = {
        recoveryAvailable: true,
        async signUp(email, password) {
          const user = { uid: crypto.randomUUID(), email, password, emailVerified: false, createdAt: now, validSince: 0, passwordUpdatedAt: 0, disabled: false };
          users.set(user.uid, user); return credentials(user);
        },
        async signIn(email, password) {
          const user = [...users.values()].find(user => user.email === email && user.password === password);
          if (!user) throw Error('Unexpected test identity');
          return credentials(user);
        },
        async lookup(value) { const user = users.get(value.uid); if (!user) throw Error('Unexpected test identity'); return user; },
        async refresh(value) { return value; },
        async changePassword() { throw Error('Password changes are outside this bounded test'); },
        async resetPassword() { throw Error('Recovery is outside this bounded test'); },
        async deleteUser(value) { if (!users.delete(value.uid)) throw Error('Unexpected test identity'); },
      };
      type Body = { account: { id: string } | null; profile: { id: string }; profiles: Array<{ id: string }>; csrfToken: string; revisions: Record<string, number>; values: Record<string, unknown> };
      function client() {
        let cookie = '', csrf = '';
        return { async call(path: string, value?: unknown) {
          const bridge = createCloudAccounts(db.withSession('first-primary'), { origin, identity,
            credentialKey: encodeBytes(new Uint8Array(32).fill(14)), now: () => now });
          const response = await bridge.handle(new Request(origin + '/api/account/' + path, {
            method: value === undefined ? 'GET' : 'POST',
            headers: { cookie, ...(value === undefined ? {} : { origin, 'content-type': 'application/json',
              'x-solanime-intent': 'account', 'x-csrf-token': csrf, 'sec-fetch-site': 'same-origin' }) },
            ...(value === undefined ? {} : { body: JSON.stringify(value) }),
          }));
          if (!response) throw Error('Expected account route');
          if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie')!.split(';')[0];
          const body = await response.json() as Body;
          if (body.csrfToken) csrf = body.csrfToken;
          return { response, body };
        } };
      }
      const owner = client(), stranger = client();
      const registered = await owner.call('register', { email: 'owner-d1@example.test', password });
      expect(registered.response.status).toBe(201);
      expect(registered.response.headers.get('set-cookie')).toContain('; HttpOnly; SameSite=Strict; Secure');
      const profile = registered.body.profiles[0].id;
      expect((await stranger.call('register', { email: 'stranger-d1@example.test', password })).response.status).toBe(201);
      const created = await Promise.all(Array.from({ length: 8 }, (_, index) => owner.call('profiles', { name: `Concurrent ${index}`, avatar: 'ruby' })));
      expect(created.filter(result => result.response.status === 201)).toHaveLength(4);
      expect(created.filter(result => result.response.status === 409)).toHaveLength(4);
      expect((await owner.call('session')).body.profiles).toHaveLength(5);
      expect((await stranger.call(`profiles/${profile}/data`)).response.status).toBe(404);
      expect((await stranger.call(`profiles/${profile}/data`, { key: 'preferences', value: { autoplayNext: true }, revision: 0 })).response.status).toBe(404);
      const writes = await Promise.all([true, false].map(autoplayNext => owner.call(`profiles/${profile}/data`, { key: 'preferences', value: { autoplayNext }, revision: 0 })));
      expect(writes.map(result => result.response.status).sort()).toEqual([200, 409]);
      expect((await owner.call(`profiles/${profile}/data`)).body.revisions.preferences).toBe(1);
      const smallAccount = (await stranger.call('session')).body.profiles[0].id;
      const second = (await stranger.call('profiles', { name: 'Second', avatar: 'amber' })).body.profile.id;
      expect((await stranger.call(`profiles/${smallAccount}/data`, { key: 'preferences', value: { autoplayNext: true }, revision: 0 })).response.status).toBe(200);
      expect((await stranger.call(`profiles/${second}/data`, { key: 'preferences', value: { autoplayNext: false }, revision: 0 })).response.status).toBe(200);
      const deleted = await Promise.all([smallAccount, second].map(id => stranger.call(`profiles/${id}/delete`, { currentPassword: password })));
      expect(deleted.map(result => result.response.status).sort()).toEqual([200, 409]);
      expect((await stranger.call('session')).body.profiles).toHaveLength(1);
      const otherDevice = client();
      expect((await otherDevice.call('login', { email: 'owner-d1@example.test', password })).response.status).toBe(200);
      expect((await owner.call('revoke-other-sessions', {})).response.status).toBe(200);
      expect((await otherDevice.call('session')).body.account).toBeNull();
      const stored = await db.prepare('SELECT credential_cipher FROM sessions').all<{ credential_cipher: string }>();
      expect(stored.results.every(row => row.credential_cipher.startsWith('v1.') && !row.credential_cipher.includes(refreshCredential))).toBe(true);
      expect((await owner.call('delete', { currentPassword: password })).response.status).toBe(200);
      expect((await owner.call('session')).body.account).toBeNull();
      expect((await stranger.call('session')).body.account).not.toBeNull();
      expect((await stranger.call('delete', { currentPassword: password })).response.status).toBe(200);
      expect(users.size).toBe(0);
      for (const table of ['accounts', 'profiles', 'profile_data', 'sessions'])
        expect((await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first())?.count).toBe(0);
      expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
    } finally { await runtime.dispose(); }
  }, 30000);
});
