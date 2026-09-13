import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, relative, sep } from 'node:path';
import { scryptSync } from 'node:crypto';
import { convertScryptHash, firebaseImportArguments, firebaseUser, MigrationError, STANDARD_SCRYPT, validatePrivateState, type PrivateState } from '../scripts/cloud-auth/format';
import { importPrivateState, privateImportRows } from '../scripts/cloud-auth/import-private';
import { prepareMigration, privateOutputDirectory } from '../scripts/cloud-auth/prepare';
import { PrivateD1Client } from '../scripts/cloud-auth/d1-client';
import { openAccountsDatabase } from '../server/accounts/database';
import { generatedTestPassphrase } from './helpers/auth-material';

const accountId = '00000000-0000-4000-a000-000000000001';
const profileId = '00000000-0000-4000-a000-000000000002';
const currentTime = 1800000000000;
const hash = 'scrypt$1$131072$8$1$' + 'ab'.repeat(16) + '$' + 'cd'.repeat(64);
function state(): PrivateState {
  return validatePrivateState({ schemaVersion: 1, firebaseProjectId: 'solanime-test-project', sourceBackupSha256: 'e'.repeat(64),
    accounts: [{ id: accountId, firebase_uid: accountId, email: 'private@example.test', recovery_hash: 'f'.repeat(64), email_verified: 0, created_at: currentTime }],
    profiles: [{ id: profileId, account_id: accountId, name: 'You', avatar: 'ruby', created_at: currentTime }],
    profileData: [{ profile_id: profileId, key: 'history', value: '[]', revision: 3, updated_at: currentTime }],
  });
}
const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0)) close(); });
function databaseClient() {
  const db = new DatabaseSync(':memory:'); cleanup.push(() => db.close());
  db.exec('PRAGMA foreign_keys=ON');
  for (const file of readdirSync(new URL('../migrations/cloud/accounts/', import.meta.url)).filter((item) => item.endsWith('.sql')).sort())
    db.exec(readFileSync(new URL(`../migrations/cloud/accounts/${file}`, import.meta.url), 'utf8'));
  const client = { async query(sql: string, params: unknown[] = []) {
    const values = params.map((x): SQLInputValue => {
      if (x === null || typeof x === 'string' || typeof x === 'number') return x;
      throw Error('Unexpected query parameter');
    });
    if (/^SELECT|^PRAGMA/.test(sql)) return { results: db.prepare(sql).all(...values), meta: { rows_read: 1, rows_written: 0 } };
    db.prepare(sql).run(...values);
    return { results: [], meta: { rows_read: 1, rows_written: /^INSERT INTO accounts/.test(sql) ? 4 :
      /^INSERT INTO (?:profiles|episode_comments)/.test(sql) ? 3 : 2 } };
  } };
  return { db, client };
}

describe('standard-scrypt private migration', () => {
  it('retains the exact UID, scrypt parameters, salt bytes and derived hash bytes', () => {
    const password = generatedTestPassphrase('scrypt migration unchanged');
    const salt = Buffer.alloc(16, 39);
    const derived = scryptSync(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 });
    const stored = `scrypt$1$131072$8$1$${salt.toString('hex')}$${derived.toString('hex')}`;
    const user = firebaseUser({ id: accountId, email: 'private@example.test', password_hash: stored, email_verified: 1, created_at: currentTime });
    expect(user.localId).toBe(accountId);
    expect(user.createdAt).toBe(String(currentTime));
    expect(Buffer.from(user.salt, 'base64')).toEqual(salt);
    expect(Buffer.from(user.passwordHash, 'base64')).toEqual(derived);
    expect(STANDARD_SCRYPT).toEqual({ algorithm: 'STANDARD_SCRYPT', memoryCost: 131072, parallelization: 1, blockSize: 8, derivedKeyLength: 64 });
    expect(firebaseImportArguments('private/firebase-users.json', 'solanime-test-project')).toEqual(['auth:import', 'private/firebase-users.json', '--project', 'solanime-test-project',
      '--hash-algo=STANDARD_SCRYPT', '--mem-cost=131072', '--parallelization=1', '--block-size=8', '--dk-len=64']);
  });
  it('fails on unknown hashes instead of normalizing or downgrading passwords', () => {
    for (const value of [null, '', hash.replace('131072', '1024'), hash.replace('scrypt$1', 'scrypt$2'), hash.slice(0, -2), 'bcrypt$hash'])
      expect(() => convertScryptHash(value)).toThrow(MigrationError);
  });
  it('rejects duplicate identities, unowned profiles, invalid revisions and hash-bearing D1 state', () => {
    for (const corrupt of [
      { ...state(), accounts: [...state().accounts, ...state().accounts] },
      { ...state(), profiles: [{ ...state().profiles[0], account_id: 'not-owned' }] },
      { ...state(), profileData: [{ ...state().profileData[0], revision: 0 }] },
      { ...state(), accounts: [{ ...state().accounts[0], password_hash: hash }] },
      { ...state(), profiles: [] },
      { ...state(), episodeComments: [{ id: accountId, episode_id: 10, profile_id: profileId,
        body: 'deceptive\u202ecomment', revision: 1, moderation_state: 'visible', created_at: currentTime, updated_at: currentTime }] },
    ]) expect(() => validatePrivateState(corrupt)).toThrow(MigrationError);
    expect(JSON.stringify(privateImportRows(state()))).not.toMatch(/password_hash|passwordHash|refreshToken|sessions/);
  });
  it('takes a consistent private SQLite backup and creates separate Firebase and D1 artifacts', async () => {
    const privateRoot = fileURLToPath(new URL('../data/private/', import.meta.url));
    mkdirSync(privateRoot, { recursive: true });
    const directory = mkdtempSync(resolve(privateRoot, 'test-auth-migration-'));
    cleanup.push(() => {
      const rel = relative(privateRoot, directory);
      if (!rel.startsWith('test-auth-migration-') || rel.includes(sep)) throw Error('Unsafe test cleanup target');
      rmSync(directory, { recursive: true });
    });
    const source = resolve(directory, 'source.sqlite');
    const db = openAccountsDatabase(source);
    db.prepare('INSERT INTO accounts(id,email,password_hash,recovery_hash,created_at) VALUES(?,?,?,?,?)')
      .run(accountId, 'private@example.test', hash, 'f'.repeat(64), currentTime);
    db.prepare('INSERT INTO profiles(id,account_id,name,avatar,created_at) VALUES(?,?,?,?,?)')
      .run(profileId, accountId, 'You', 'ruby', currentTime);
    db.prepare('INSERT INTO profile_data(profile_id,key,value,revision,updated_at) VALUES(?,?,?,?,?)')
      .run(profileId, 'history', '[]', 3, currentTime);
    db.prepare(`INSERT INTO episode_comments(id,episode_id,profile_id,body,revision,moderation_state,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?)`).run('00000000-0000-4000-a000-000000000003', 10, profileId,
      'Preserved public comment', 2, 'visible', currentTime, currentTime + 1);
    const out = resolve(directory, 'prepared');
    try {
      const result = await prepareMigration(source, out, 'solanime-test-project');
      expect(result).toMatchObject({ accounts: 1, profiles: 1, profileValues: 1, episodeComments: 1 });
      const firebaseText = readFileSync(resolve(out, 'firebase-users.json'), 'utf8');
      const privateText = readFileSync(resolve(out, 'private-state.json'), 'utf8');
      expect(firebaseText).toContain('passwordHash');
      expect(firebaseText).not.toContain('recovery_hash');
      expect(privateText).toContain('recovery_hash');
      expect(privateText).not.toMatch(/password_hash|passwordHash|refreshToken|token_hash/);
      const prepared = validatePrivateState(JSON.parse(privateText));
      expect(prepared.profileData[0].revision).toBe(3);
      expect(prepared.episodeComments[0]).toMatchObject({ episode_id: 10, body: 'Preserved public comment', revision: 2 });
      expect(db.prepare('SELECT password_hash FROM accounts').get()?.password_hash).toBe(hash);
      await expect(prepareMigration(source, out, 'solanime-test-project')).rejects.toThrow('already exists');
      await expect(privateOutputDirectory(resolve(directory, '../../exports/auth-public-test'))).rejects.toThrow('data/private');
    } finally { db.close(); }
  });
  it('resumes a write-budget stop and repeats idempotently without resetting revisions', async () => {
    const f = databaseClient();
    const checkpoints: number[] = [];
    const first = await importPrivateState(f.client, state(), 4, 0, async (next) => { checkpoints.push(next); });
    expect(first).toMatchObject({ completed: false, nextRecord: 1, writtenRows: 4 });
    const second = await importPrivateState(f.client, state(), 5, first.nextRecord);
    expect(second).toMatchObject({ completed: true, nextRecord: 3, writtenRows: 5 });
    const repeated = await importPrivateState(f.client, state(), 9);
    expect(repeated).toMatchObject({ completed: true, writtenRows: 0, skipped: 3 });
    expect(f.db.prepare('SELECT revision FROM profile_data').get()?.revision).toBe(3);
    expect(checkpoints.at(-1)).toBe(1);
  });
  it('imports validated episode comments only after their owning profiles and preserves revisions', async () => {
    const value = validatePrivateState({ ...state(), episodeComments: [{
      id: '00000000-0000-4000-a000-000000000003', episode_id: 10, profile_id: profileId,
      body: 'Migrated public comment', revision: 4, moderation_state: 'hidden',
      created_at: currentTime, updated_at: currentTime + 1,
    }] });
    const rows = privateImportRows(value);
    expect(rows.map((row) => row.table)).toEqual(['accounts', 'profiles', 'profile_data', 'episode_comments']);
    const f = databaseClient();
    expect(await importPrivateState(f.client, value, 12)).toMatchObject({ completed: true, nextRecord: 4 });
    expect(f.db.prepare('SELECT episode_id,profile_id,body,revision,moderation_state FROM episode_comments').get())
      .toEqual({ episode_id: 10, profile_id: profileId, body: 'Migrated public comment', revision: 4, moderation_state: 'hidden' });
    expect(await importPrivateState(f.client, value, 12)).toMatchObject({ completed: true, writtenRows: 0, skipped: 4 });
  });
  it('preserves existing private rows when the input snapshot conflicts with live state', async () => {
    const f = databaseClient();
    await importPrivateState(f.client, state(), 10);
    f.db.prepare('UPDATE profiles SET name=? WHERE id=?').run('Changed after import', profileId);
    await expect(importPrivateState(f.client, state(), 10)).rejects.toThrow('was preserved');
    expect(f.db.prepare('SELECT name FROM profiles WHERE id=?').get(profileId)?.name).toBe('Changed after import');
  });
  it('can resume a request whose write succeeded but response was interrupted', async () => {
    const f = databaseClient();
    const interrupted = { async query(sql: string, params?: unknown[]) {
      const result = await f.client.query(sql, params);
      if (/^INSERT/.test(sql)) throw new MigrationError('Response lost');
      return result;
    } };
    await expect(importPrivateState(interrupted, state(), 10)).rejects.toThrow('Response lost');
    const resumed = await importPrivateState(f.client, state(), 10);
    expect(resumed).toMatchObject({ completed: true, skipped: 1, writtenRows: 5 });
    expect(f.db.prepare('SELECT count(*) AS n FROM accounts').get()?.n).toBe(1);
  });
  it('requires the exact private database identity and redacts upstream API errors', async () => {
    const client = new PrivateD1Client('a'.repeat(32), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'solanime-accounts-preview', 'test-private-token',
      async () => new Response(JSON.stringify({ success: false, errors: [{ message: 'private-token-must-not-be-logged' }] }), { status: 429, headers: { 'content-type': 'application/json' } }));
    await expect(client.verifyTarget()).rejects.toThrow('quota/rate limit');
    expect(() => new PrivateD1Client('a'.repeat(32), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'unrelated-catalogue', 'secret')).toThrow('exact Solanime');
    await expect(client.query('SELECT 1')).rejects.not.toThrow('private-token-must-not-be-logged');
  });
});
