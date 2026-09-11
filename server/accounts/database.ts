import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { projectRoot } from '../db.ts';

/** Credentials deliberately live outside the distributable catalogue database. */
export function openAccountsDatabase(
  path = process.env.SOLANIME_ACCOUNTS_DB_PATH ||
    resolve(projectRoot, 'data/private/accounts.sqlite'),
) {
  if (path !== ':memory:') {
    path = resolve(projectRoot, path);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  }
  const db = new DatabaseSync(path);
  if (path !== ':memory:') chmodSync(path, 0o600);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS account_schema(version INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS accounts(
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL, recovery_hash TEXT NOT NULL,
      email_verified INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS profiles(
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 32),
      avatar TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS profiles_account ON profiles(account_id);
    CREATE TRIGGER IF NOT EXISTS maximum_five_profiles BEFORE INSERT ON profiles
      WHEN (SELECT count(*) FROM profiles WHERE account_id=NEW.account_id)>=5
      BEGIN SELECT RAISE(ABORT,'PROFILE_LIMIT'); END;
    CREATE TABLE IF NOT EXISTS sessions(
      token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      csrf TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL,
      expires_at INTEGER NOT NULL, device TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id);
    CREATE TABLE IF NOT EXISTS profile_data(
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      key TEXT NOT NULL, value TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL, PRIMARY KEY(profile_id,key));
    CREATE TABLE IF NOT EXISTS account_rate_limits(
      key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    INSERT OR IGNORE INTO account_schema(version) VALUES(1);
  `);
  return db;
}
