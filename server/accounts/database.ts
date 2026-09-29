import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, readFileSync } from 'node:fs';
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
    CREATE TABLE IF NOT EXISTS episode_comments(
      id TEXT PRIMARY KEY CHECK(length(id)=36),
      episode_id INTEGER NOT NULL CHECK(episode_id>0),
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 1000),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
      moderation_state TEXT NOT NULL DEFAULT 'visible'
        CHECK(moderation_state IN ('visible','hidden')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL CHECK(updated_at>=created_at));
    CREATE INDEX IF NOT EXISTS episode_comments_public_page
      ON episode_comments(episode_id,moderation_state,created_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS episode_comments_profile
      ON episode_comments(profile_id,updated_at DESC,id DESC);
    CREATE TRIGGER IF NOT EXISTS episode_comment_profile_limit BEFORE INSERT ON episode_comments
      WHEN (SELECT count(*) FROM episode_comments WHERE profile_id=NEW.profile_id)>=5000
        OR (SELECT count(*) FROM episode_comments
            WHERE profile_id=NEW.profile_id AND episode_id=NEW.episode_id)>=100
      BEGIN SELECT RAISE(ABORT,'COMMENT_LIMIT'); END;
    INSERT OR IGNORE INTO account_schema(version) VALUES(1);
    INSERT OR IGNORE INTO account_schema(version) VALUES(2);
  `);
  if (!db.prepare('SELECT version FROM account_schema WHERE version=3').get()) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(readFileSync(resolve(projectRoot, 'migrations/cloud/accounts/0003_myanimelist.sql'), 'utf8'));
      db.exec('INSERT INTO account_schema(version) VALUES(3); COMMIT;');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  if (!db.prepare('SELECT version FROM account_schema WHERE version=4').get()) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(readFileSync(resolve(projectRoot, 'migrations/cloud/accounts/0004_private_approval.sql'), 'utf8'));
      db.exec('INSERT INTO account_schema(version) VALUES(4); COMMIT;');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return db;
}
