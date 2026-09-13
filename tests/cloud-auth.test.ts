import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createCloudAccounts, type CloudAccountConfig } from '../server/cloud/auth/index';
import { FirebaseAuthError } from '../server/cloud/auth/firebase';
import { digest, encodeBytes, openCredentials, randomToken, sealCredentials } from '../server/cloud/auth/crypto';
import type { AccountDatabase, AccountStatement, CloudProfile, CloudSession, IdentityCredentials, IdentityUser, ManagedIdentity } from '../server/cloud/auth/types';
import { generatedTestPassphrase, generatedTestToken } from './helpers/auth-material';
import type { CommunityComment, CommunityCommentsPage } from '../src/types';

// Real SQLite executes the D1 contract SQL. Network identity is deterministic and test-only.
class SQLiteD1 implements AccountDatabase {
  readonly raw = new DatabaseSync(':memory:');
  constructor() {
    this.raw.exec('PRAGMA foreign_keys=ON');
    for (const file of readdirSync(new URL('../migrations/cloud/accounts/', import.meta.url)).filter((item) => item.endsWith('.sql')).sort())
      this.raw.exec(readFileSync(new URL(`../migrations/cloud/accounts/${file}`, import.meta.url), 'utf8'));
  }
  prepare(sql: string) { return new Statement(this.raw, sql); }
  async batch(statements: AccountStatement[]) {
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const values = statements.map((statement) => {
        if (!(statement instanceof Statement)) throw Error('Unexpected statement type');
        return statement.execute();
      });
      this.raw.exec('COMMIT');
      return values;
    } catch (error) { this.raw.exec('ROLLBACK'); throw error; }
  }
}
class Statement implements AccountStatement {
  constructor(private readonly db: DatabaseSync, private readonly sql: string, private readonly values: SQLInputValue[] = []) {}
  bind(...values: unknown[]) {
    const checked = values.map((value) => {
      if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || value instanceof Uint8Array) return value;
      throw Error('Unsupported D1 binding value');
    });
    return new Statement(this.db, this.sql, checked);
  }
  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.values);
    return (column ? row?.[column] : row) as T ?? null;
  }
  async all<T = Record<string, unknown>>() {
    return { results: this.db.prepare(this.sql).all(...this.values) as T[], success: true };
  }
  execute() {
    const result = this.db.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
  async run() { return this.execute(); }
}
class TestIdentity implements ManagedIdentity {
  recoveryAvailable = true;
  readonly users = new Map<string, IdentityUser & { password: string }>();
  lookupFailure?: Error;
  resetFailure?: Error;
  onLookup?: () => Promise<void>;
  resets = 0;
  refreshes = 0;
  constructor(private readonly now: () => number) {}
  private credentials(user: IdentityUser, authenticatedAt = this.now()) {
    return { uid: user.uid, idToken: generatedTestToken('identity'), refreshToken: generatedTestToken('refresh'),
      expiresAt: this.now() + 3600000, authenticatedAt };
  }
  async signUp(email: string, password: string) {
    if ([...this.users.values()].some((x) => x.email === email)) throw new FirebaseAuthError(409, 'Already exists', 'AUTH_EMAIL_EXISTS');
    const user = { uid: crypto.randomUUID(), email, password, emailVerified: false, createdAt: this.now(), validSince: 0, passwordUpdatedAt: 0, disabled: false };
    this.users.set(user.uid, user);
    return this.credentials(user);
  }
  async signIn(email: string, password: string) {
    const user = [...this.users.values()].find((x) => x.email === email && x.password === password && !x.disabled);
    if (!user) throw new FirebaseAuthError(401, 'Rejected', 'AUTH_CREDENTIAL_REJECTED');
    return this.credentials(user);
  }
  async refresh(c: IdentityCredentials) {
    this.refreshes++;
    const user = this.users.get(c.uid);
    if (!user || user.validSince > c.authenticatedAt) throw new FirebaseAuthError(401, 'Revoked', 'AUTH_CREDENTIAL_REJECTED');
    return this.credentials(user, c.authenticatedAt);
  }
  async lookup(c: IdentityCredentials) {
    if (this.onLookup) await this.onLookup();
    if (this.lookupFailure) throw this.lookupFailure;
    const user = this.users.get(c.uid);
    if (!user) throw new FirebaseAuthError(401, 'Missing', 'AUTH_CREDENTIAL_REJECTED');
    return { ...user };
  }
  async changePassword(c: IdentityCredentials, password: string) {
    const user = this.users.get(c.uid)!;
    user.password = password; user.passwordUpdatedAt = this.now();
    return this.credentials(user);
  }
  async resetPassword(id: string, password: string) {
    this.resets++;
    if (this.resetFailure) throw this.resetFailure;
    const user = this.users.get(id)!;
    user.password = password; user.validSince = this.now(); user.passwordUpdatedAt = this.now();
  }
  async deleteUser(c: IdentityCredentials) { this.users.delete(c.uid); }
}
type Body = {
  account: { id: string; email: string; emailVerified: boolean } | null;
  profiles: CloudProfile[];
  profile: CloudProfile;
  csrfToken: string;
  recoveryCode: string;
  registrationOpen: boolean;
  recoveryMethod: string;
  values: Record<string, unknown>;
  revisions: Record<string, number>;
  revision: number;
  items: Array<{ id: string; current: boolean }>;
  error: { code: string; message: string; details?: { reason: string } };
};
const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0)) close(); });
const password = generatedTestPassphrase('cloud bridge');
const origin = 'https://preview.solanime.pages.dev';
function fixture(overrides: Partial<CloudAccountConfig> = {}) {
  const db = new SQLiteD1();
  cleanup.push(() => db.raw.close());
  let time = 1800000000000;
  const identity = new TestIdentity(() => time);
  const key = encodeBytes(new Uint8Array(32).fill(12));
  const service = createCloudAccounts(db, { origin, identity, credentialKey: key, now: () => time, ...overrides });
  const client = () => {
    let cookie = '', csrf = '';
    return {
      get cookie() { return cookie; },
      async call(path: string, value?: unknown, headers: Record<string, string> = {}) {
        const r = await service.handle(new Request(origin + '/api/account/' + path, { method: value === undefined ? 'GET' : 'POST',
          headers: { ...(cookie ? { cookie } : {}), ...(value === undefined ? {} : {
            origin, 'content-type': 'application/json', 'x-solanime-intent': 'account', 'x-csrf-token': csrf,
            'sec-fetch-site': 'same-origin',
          }), ...headers }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) }));
        if (!r) throw Error('Account handler did not match');
        if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie')!.split(';')[0];
        const body = await r.json() as Body;
        if (body.csrfToken) csrf = body.csrfToken;
        return { response: r, body };
      },
      async community<T = Record<string, unknown>>(
        path: string,
        options: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown; headers?: Record<string, string> } = {},
      ) {
        const method = options.method ?? 'GET';
        const mutation = method !== 'GET';
        const r = await service.handle(new Request(origin + '/api/episodes/' + path, {
          method,
          headers: {
            ...(cookie ? { cookie } : {}),
            ...(mutation ? { origin, 'content-type': 'application/json', 'x-solanime-intent': 'account',
              'x-csrf-token': csrf, 'sec-fetch-site': 'same-origin' } : {}),
            ...options.headers,
          },
          ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        }));
        if (!r) throw Error('Community handler did not match');
        return { response: r, body: await r.json() as T };
      },
    };
  };
  return { db, identity, key, service, client, advance: (ms: number) => { time += ms; }, now: () => time };
}

describe('D1 managed account bridge', () => {
  it('fails closed when unconfigured while leaving other APIs unhandled', async () => {
    const f = fixture({ identity: undefined, credentialKey: undefined });
    expect(await f.service.handle(new Request(origin + '/api/titles'))).toBeNull();
    const r = await f.client().call('session');
    expect(r.response.status).toBe(503);
    expect(r.body.error.details?.reason).toBe('AUTH_NOT_CONFIGURED');
    expect(r.response.headers.get('cache-control')).toBe('no-store');
  });
  it('stores no password hash and encrypts every retained Firebase credential', async () => {
    const f = fixture(), a = f.client();
    const r = await a.call('register', { email: 'First@Example.test', password });
    expect(r.response.status).toBe(201);
    expect(r.body.account?.email).toBe('first@example.test');
    expect(r.body.profiles).toHaveLength(1);
    expect(r.body.recoveryCode).toMatch(/^[\w-]{43}$/);
    const columns = f.db.raw.prepare('PRAGMA table_info(accounts)').all();
    expect(columns.map((x) => x.name)).not.toContain('password_hash');
    const s = f.db.raw.prepare('SELECT * FROM sessions').get() as CloudSession;
    expect(s.credential_cipher).toMatch(/^v1\./);
    expect(s.credential_cipher).not.toMatch(/identity-token|refresh-/);
    const credentials = await openCredentials(s.credential_cipher, f.key, `${s.account_id}:${s.token_hash}`);
    expect(s.credential_cipher).not.toContain(credentials.idToken);
    expect(s.credential_cipher).not.toContain(credentials.refreshToken);
    expect(credentials.uid).toBe(r.body.account!.id);
    expect(JSON.stringify(r.body)).not.toMatch(/idToken|refreshToken|cipher|password_hash|token_hash/);
    expect(a.cookie).not.toContain(s.token_hash);
    expect(r.response.headers.get('set-cookie')).toContain('; HttpOnly; SameSite=Strict; Secure');
    expect(r.response.headers.get('set-cookie')).not.toContain('Domain=');
  });
  it('enforces five profiles under concurrent requests and at the database layer', async () => {
    const f = fixture(), a = f.client();
    const registered = await a.call('register', { email: 'profiles@example.test', password });
    const responses = await Promise.all(Array.from({ length: 10 }, (_, index) => a.call('profiles', { name: `Viewer ${index}`, avatar: 'ocean' })));
    expect(responses.filter((x) => x.response.status === 201)).toHaveLength(4);
    expect(responses.filter((x) => x.response.status === 409)).toHaveLength(6);
    expect((await a.call('session')).body.profiles).toHaveLength(5);
    expect(() => f.db.raw.prepare('INSERT INTO profiles(id,account_id,name,avatar,created_at) VALUES(?,?,?,?,?)')
      .run(crypto.randomUUID(), registered.body.account!.id, 'Injected', 'ruby', f.now())).toThrow('PROFILE_LIMIT');
  });
  it('keeps at least one profile when two delete requests race', async () => {
    const f = fixture(), a = f.client();
    const first = (await a.call('register', { email: 'last@example.test', password })).body.profiles[0].id;
    const second = (await a.call('profiles', { name: 'Second', avatar: 'amber' })).body.profile.id;
    const responses = await Promise.all([first, second].map((id) => a.call(`profiles/${id}/delete`, { currentPassword: password })));
    expect(responses.map((x) => x.response.status).sort()).toEqual([200, 409]);
    expect((await a.call('session')).body.profiles).toHaveLength(1);
  });
  it('isolates account data, guards names and keeps one winner for simultaneous same-revision writes', async () => {
    const f = fixture(), a = f.client(), b = f.client();
    const profile = (await a.call('register', { email: 'owner@example.test', password })).body.profiles[0].id;
    await b.call('register', { email: 'other@example.test', password });
    expect((await b.call(`profiles/${profile}/data`)).response.status).toBe(404);
    expect((await b.call(`profiles/${profile}`, { name: 'Stolen', avatar: 'ruby' })).response.status).toBe(404);
    const responses = await Promise.all([true, false].map((autoplayNext) => a.call(`profiles/${profile}/data`, {
      key: 'preferences', value: { autoplayNext }, revision: 0,
    })));
    expect(responses.map((x) => x.response.status).sort()).toEqual([200, 409]);
    const saved = await a.call(`profiles/${profile}/data`);
    expect(saved.body.revisions.preferences).toBe(1);
    expect((await a.call(`profiles/${profile}/data`, { key: 'history', value: [], revision: 2 })).response.status).toBe(409);
    expect((await a.call(`profiles/${profile}/data`)).body.values).not.toHaveProperty('history');
  });
  it('enforces profile byte quotas atomically without replacing good data', async () => {
    const f = fixture(), a = f.client();
    const id = (await a.call('register', { email: 'quota@example.test', password })).body.profiles[0].id;
    const session = f.db.raw.prepare('SELECT * FROM sessions').get() as CloudSession;
    for (let index = 0; index < 10; index++) {
      await f.service.repository.putData(session, id, `fixture-${index}`, JSON.stringify('x'.repeat(190000)), 0, f.now());
    }
    const attempts = await Promise.allSettled(['a', 'b'].map((suffix) =>
      f.service.repository.putData(session, id, `new-${suffix}`, JSON.stringify('y'.repeat(180000)), 0, f.now())));
    expect(attempts.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const rejected = attempts.find((x) => x.status === 'rejected');
    expect(rejected && rejected.status === 'rejected' && rejected.reason.status).toBe(413);
    expect(f.db.raw.prepare('SELECT count(*) AS n FROM profile_data WHERE profile_id=?').get(id)?.n).toBe(11);
  });
  it('rejects missing intent, forged origins, duplicate cookies and invalid CSRF', async () => {
    const f = fixture(), a = f.client();
    await a.call('register', { email: 'csrf@example.test', password });
    const invalidHeaders: Record<string, string>[] = [{ origin: 'https://evil.example' }, { 'x-csrf-token': 'invalid' }, { 'x-solanime-intent': '' }, { 'sec-fetch-site': 'same-site' }];
    for (const headers of invalidHeaders)
      expect((await a.call('profiles', { name: 'Rejected', avatar: 'ruby' }, headers)).response.status).toBe(403);
    expect((await a.call('session', undefined, { cookie: a.cookie + '; ' + a.cookie })).body.account).toBeNull();
    expect((await a.call('login', { email: 'csrf@example.test', password }, { origin: '' })).response.status).toBe(403);
  });
  it('rotates every login, revokes other sessions, and expires inactive persistent sessions', async () => {
    const f = fixture(), a = f.client(), b = f.client();
    await a.call('register', { email: 'sessions@example.test', password });
    const before = a.cookie;
    await a.call('login', { email: 'sessions@example.test', password, remember: true });
    expect(a.cookie).not.toBe(before);
    expect((await a.call('session', undefined, { cookie: before })).body.account).toBeNull();
    await b.call('login', { email: 'sessions@example.test', password });
    expect((await a.call('sessions')).body.items).toHaveLength(2);
    expect((await a.call('revoke-other-sessions', {})).response.status).toBe(200);
    expect((await b.call('session')).body.account).toBeNull();
    f.advance(7 * 86400000 + 1);
    expect((await a.call('session')).body.account).toBeNull();
  });
  it('detects upstream revocation without deleting account data', async () => {
    const f = fixture(), a = f.client();
    const r = await a.call('register', { email: 'external@example.test', password });
    f.advance(6 * 60000);
    f.identity.users.get(r.body.account!.id)!.validSince = f.now();
    expect((await a.call('session')).body.account).toBeNull();
    expect(f.db.raw.prepare('SELECT count(*) AS n FROM accounts').get()?.n).toBe(1);
    expect(f.db.raw.prepare('SELECT count(*) AS n FROM profiles').get()?.n).toBe(1);
  });
  it('refreshes expired identity credentials and refuses a late response after logout', async () => {
    const f = fixture(), a = f.client();
    await a.call('register', { email: 'refresh@example.test', password });
    f.advance(61 * 60000);
    expect((await a.call('session')).response.status).toBe(200);
    expect(f.identity.refreshes).toBe(1);
    f.advance(6 * 60000);
    f.identity.onLookup = async () => { f.db.raw.exec('DELETE FROM sessions'); };
    expect((await a.call('session')).body.account).toBeNull();
  });
  it('does not treat an identity outage as logout or overwrite usable state', async () => {
    const f = fixture(), a = f.client();
    await a.call('register', { email: 'outage@example.test', password });
    f.advance(6 * 60000);
    f.identity.lookupFailure = new FirebaseAuthError(503, 'Unavailable', 'AUTH_UPSTREAM_UNAVAILABLE', true);
    expect((await a.call('session')).response.status).toBe(503);
    expect(f.db.raw.prepare('SELECT count(*) AS n FROM sessions').get()?.n).toBe(1);
    f.identity.lookupFailure = undefined;
    expect((await a.call('session')).body.account?.email).toBe('outage@example.test');
  });
  it('uses single-use recovery claims and rotates codes after the remote password update', async () => {
    const f = fixture(), a = f.client(), guest = f.client();
    const changedPassword = generatedTestPassphrase('single-use recovery');
    const r = await a.call('register', { email: 'recover@example.test', password });
    const responses = await Promise.all([1, 2].map(() => guest.call('recover', {
      email: 'recover@example.test', password: changedPassword, recoveryCode: r.body.recoveryCode,
    })));
    expect(responses.filter((x) => x.response.status === 200)).toHaveLength(1);
    expect(f.identity.resets).toBe(1);
    expect((await a.call('session')).body.account).toBeNull();
    expect((await guest.call('recover', { email: 'recover@example.test', password, recoveryCode: r.body.recoveryCode })).response.status).toBe(400);
    expect((await a.call('login', { email: 'recover@example.test', password: changedPassword })).response.status).toBe(200);
  });
  it('preserves good data and an explicit durable record when a reset outcome is uncertain', async () => {
    const f = fixture(), a = f.client();
    const r = await a.call('register', { email: 'uncertain@example.test', password });
    f.identity.resetFailure = new FirebaseAuthError(503, 'Uncertain', 'AUTH_UPSTREAM_UNAVAILABLE', true);
    const reset = await a.call('recover', { email: 'uncertain@example.test', password, recoveryCode: r.body.recoveryCode });
    expect(reset.response.status).toBe(503);
    expect(reset.body.error.details?.reason).toBe('AUTH_OPERATION_PENDING');
    const row = f.db.raw.prepare('SELECT auth_state,operation_error,recovery_hash FROM accounts').get();
    expect(row?.auth_state).toBe('recovering');
    expect(row?.operation_error).toBe('UPSTREAM_OUTCOME_UNCERTAIN');
    expect(row?.recovery_hash).toBe(await digest(r.body.recoveryCode));
    expect((await a.call('recover', { email: 'uncertain@example.test', password, recoveryCode: r.body.recoveryCode })).response.status).toBe(409);
    expect(f.identity.resets).toBe(1);
    expect(f.db.raw.prepare('SELECT count(*) AS n FROM profiles').get()?.n).toBe(1);
  });
  it('does not require optional recovery credentials for an existing account login', async () => {
    const f = fixture(), a = f.client();
    await a.call('register', { email: 'optional@example.test', password });
    f.identity.recoveryAvailable = false;
    const loggedIn = await a.call('login', { email: 'optional@example.test', password });
    expect(loggedIn.response.status).toBe(200);
    expect(loggedIn.body.registrationOpen).toBe(false);
    expect(loggedIn.body.recoveryMethod).toBe('unavailable');
    expect((await a.call('recover', { email: 'optional@example.test' })).response.status).toBe(503);
  });
  it('does not bypass closed registration by signing up directly with Firebase first', async () => {
    const f = fixture({ registration: false });
    await f.identity.signUp('outside@example.test', password);
    const r = await f.client().call('login', { email: 'outside@example.test', password });
    expect(r.response.status).toBe(403);
    expect(r.body.error.details?.reason).toBe('ACCOUNT_NOT_PROVISIONED');
    expect(f.db.raw.prepare('SELECT count(*) AS n FROM accounts').get()?.n).toBe(0);
  });
  it('changes passwords, revokes all prior sessions and excludes secrets from account exports', async () => {
    const f = fixture(), a = f.client(), b = f.client();
    const changedPassword = generatedTestPassphrase('password change');
    await a.call('register', { email: 'password@example.test', password });
    await b.call('login', { email: 'password@example.test', password });
    const old = a.cookie;
    const changed = await a.call('password', { currentPassword: password, password: changedPassword });
    expect(changed.response.status).toBe(200);
    expect(a.cookie).not.toBe(old);
    expect((await b.call('session')).body.account).toBeNull();
    expect((await b.call('login', { email: 'password@example.test', password })).response.status).toBe(401);
    const exported = await a.call('export');
    expect(exported.response.status).toBe(200);
    expect(JSON.stringify(exported.body)).not.toMatch(/recovery_hash|password_hash|token_hash|refreshToken|idToken|credential_cipher/);
    expect((await a.call('delete', { currentPassword: changedPassword })).response.status).toBe(200);
    expect(f.identity.users.size).toBe(0);
    expect(f.db.raw.prepare('SELECT count(*) AS n FROM accounts').get()?.n).toBe(0);
    expect(f.db.raw.prepare('SELECT count(*) AS n FROM profiles').get()?.n).toBe(0);
  });
  it('bounds credential attempts and gives Retry-After without storing an IP or email', async () => {
    const f = fixture(), a = f.client();
    for (let index = 0; index < 12; index++) await a.call('login', { email: 'guess@example.test', password: 'wrong' });
    const limited = await a.call('login', { email: 'guess@example.test', password: 'wrong' });
    expect(limited.response.status).toBe(429);
    expect(Number(limited.response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(JSON.stringify(f.db.raw.prepare('SELECT * FROM account_rate_limits').all())).not.toContain('guess@example.test');
  });
  it('rejects malformed and oversized bodies, unsupported keys and weak passwords', async () => {
    const f = fixture(), a = f.client();
    expect((await a.call('register', { email: 'bad@example.test', password: 'short' })).response.status).toBe(400);
    const profile = (await a.call('register', { email: 'valid@example.test', password })).body.profiles[0].id;
    expect((await a.call(`profiles/${profile}/data`, { key: '__proto__', value: {}, revision: 0 })).response.status).toBe(400);
    expect((await a.call('profiles', { name: 'x'.repeat(280000), avatar: 'ruby' })).response.status).toBe(413);
  });

  it('publishes paginated episode comments without exposing private account or profile identifiers', async () => {
    const f = fixture({ episodeExists: async (id) => id === 10 }), a = f.client(), guest = f.client();
    const registered = await a.call('register', { email: 'community-owner@example.test', password });
    const profileId = registered.body.profiles[0].id;
    for (const body of ['First public thought', 'Second public thought', 'Third public thought']) {
      const created = await a.community<{ comment: CommunityComment }>('10/comments', {
        method: 'POST', body: { profileId, body },
      });
      expect(created.response.status).toBe(201);
      expect(created.body.comment).toMatchObject({ episodeId: '10', body, revision: 1,
        ownedByViewer: true, author: { name: 'You', avatar: 'ruby' } });
    }
    const first = await guest.community<CommunityCommentsPage>('10/comments?page=1&pageSize=2');
    const second = await guest.community<CommunityCommentsPage>('10/comments?page=2&pageSize=2');
    expect(first.response.status).toBe(200);
    expect(first.body).toMatchObject({ total: 3, page: 1, pageSize: 2, pages: 2 });
    expect(first.body.items).toHaveLength(2);
    expect(second.body.items).toHaveLength(1);
    expect(first.body.items.every((comment) => !comment.ownedByViewer)).toBe(true);
    const publicJson = JSON.stringify(first.body);
    expect(publicJson).not.toContain('community-owner@example.test');
    expect(publicJson).not.toContain(profileId);
    expect(publicJson).not.toMatch(/firebase|account_id|profile_id|csrf|token/i);
    const owned = await a.community<CommunityCommentsPage>(`10/comments?profile=${profileId}`);
    expect(owned.body.items.every((comment) => comment.ownedByViewer)).toBe(true);
    expect((await guest.community('10/comments?page=0')).response.status).toBe(400);
    expect((await guest.community('10/comments?pageSize=51')).response.status).toBe(400);
    expect((await guest.community('11/comments')).response.status).toBe(404);
  });

  it('requires an owned current profile, exact CSRF, and matching revisions to edit or delete comments', async () => {
    const f = fixture({ episodeExists: async (id) => id === 10 }), owner = f.client(), other = f.client(), guest = f.client();
    const ownerProfile = (await owner.call('register', { email: 'comment-owner@example.test', password })).body.profiles[0].id;
    const otherProfile = (await other.call('register', { email: 'comment-other@example.test', password })).body.profiles[0].id;
    const created = await owner.community<{ comment: CommunityComment }>('10/comments', {
      method: 'POST', body: { profileId: ownerProfile, body: 'Original comment' },
    });
    const id = created.body.comment.id;
    expect((await guest.community('10/comments', { method: 'POST', body: { profileId: ownerProfile, body: 'No session' } })).response.status).toBe(401);
    expect((await owner.community('10/comments', { method: 'POST', body: { profileId: ownerProfile, body: 'Bad CSRF' },
      headers: { 'x-csrf-token': 'invalid' } })).response.status).toBe(403);
    expect((await owner.community('10/comments', { method: 'POST', body: { profileId: ownerProfile, body: 'Bad intent' },
      headers: { 'x-solanime-intent': '' } })).response.status).toBe(403);
    expect((await other.community(`10/comments/${id}`, { method: 'PATCH',
      body: { profileId: otherProfile, body: 'Not mine', revision: 1 } })).response.status).toBe(404);
    f.advance(1);
    const edited = await owner.community<{ comment: CommunityComment }>(`10/comments/${id}`, {
      method: 'PATCH', body: { profileId: ownerProfile, body: 'Edited comment', revision: 1 },
    });
    expect(edited.response.status).toBe(200);
    expect(edited.body.comment).toMatchObject({ id, body: 'Edited comment', revision: 2, ownedByViewer: true });
    expect(Date.parse(edited.body.comment.updatedAt)).toBeGreaterThan(Date.parse(edited.body.comment.createdAt));
    expect((await owner.community(`10/comments/${id}`, { method: 'PATCH',
      body: { profileId: ownerProfile, body: 'Stale edit', revision: 1 } })).response.status).toBe(409);
    expect((await owner.community(`10/comments/${id}`, { method: 'DELETE',
      body: { profileId: ownerProfile, revision: 1 } })).response.status).toBe(409);
    const removed = await owner.community<{ deleted: boolean; id: string }>(`10/comments/${id}`, {
      method: 'DELETE', body: { profileId: ownerProfile, revision: 2 },
    });
    expect(removed.response.status).toBe(200);
    expect(removed.body).toEqual({ deleted: true, id });
    expect((await guest.community<CommunityCommentsPage>('10/comments')).body.total).toBe(0);
  });

  it('rejects deceptive controls, oversized comments, invalid IDs, and hidden-row mutations', async () => {
    const f = fixture({ episodeExists: async (id) => id === 10 }), a = f.client();
    const profileId = (await a.call('register', { email: 'comment-validation@example.test', password })).body.profiles[0].id;
    for (const body of ['', 'x'.repeat(1001), 'hidden\u202eevil'])
      expect((await a.community('10/comments', { method: 'POST', body: { profileId, body } })).response.status).toBe(400);
    const created = await a.community<{ comment: CommunityComment }>('10/comments', {
      method: 'POST', body: { profileId, body: 'Visible before review' },
    });
    f.db.raw.prepare("UPDATE episode_comments SET moderation_state='hidden' WHERE id=?").run(created.body.comment.id);
    expect((await a.community<CommunityCommentsPage>('10/comments')).body.total).toBe(0);
    expect((await a.community(`10/comments/${created.body.comment.id}`, { method: 'PATCH',
      body: { profileId, body: 'Cannot unhide it', revision: 1 } })).response.status).toBe(404);
    expect((await a.community(`10/comments/${'0'.repeat(36)}`, { method: 'PATCH',
      body: { profileId, body: 'Invalid', revision: 1 } })).response.status).toBe(400);
  });
});

describe('credential envelope', () => {
  it('authenticates ciphertext, owning account and session; rotation invalidates prior keys', async () => {
    const value = { uid: 'uid', idToken: generatedTestToken('identity'), refreshToken: generatedTestToken('refresh'), expiresAt: 1800000010000, authenticatedAt: 1800000000000 };
    const secret = encodeBytes(new Uint8Array(32).fill(1));
    const cipher = await sealCredentials(value, secret, 'owner:session');
    expect(await openCredentials(cipher, secret, 'owner:session')).toEqual(value);
    for (const [key, context] of [[secret, 'other:session'], [encodeBytes(new Uint8Array(32).fill(2)), 'owner:session']])
      await expect(openCredentials(cipher, key, context)).rejects.toMatchObject({ status: 401 });
    await expect(openCredentials(cipher.slice(0, -8) + 'AAAAAAAA', secret, 'owner:session')).rejects.toMatchObject({ status: 401 });
  });
});

export { SQLiteD1 };
