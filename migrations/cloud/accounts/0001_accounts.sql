-- PRIVATE DATABASE ONLY. Do not apply to the catalogue or operator-research database.
-- Local scrypt hashes are deliberately absent; Firebase owns password verification.
CREATE TABLE IF NOT EXISTS account_schema(version INTEGER PRIMARY KEY);
CREATE TABLE IF NOT EXISTS accounts(
  id TEXT PRIMARY KEY,
  firebase_uid TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  recovery_hash TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK(email_verified IN (0,1)),
  created_at INTEGER NOT NULL,
  auth_revision INTEGER NOT NULL DEFAULT 1 CHECK(auth_revision >= 1),
  auth_state TEXT NOT NULL DEFAULT 'active' CHECK(auth_state IN ('active','recovering','password-changing','deleting')),
  operation_id TEXT,
  operation_started_at INTEGER,
  operation_error TEXT,
  CHECK(recovery_hash IS NULL OR length(recovery_hash)=64)
);
CREATE TABLE IF NOT EXISTS profiles(
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 32),
  avatar TEXT NOT NULL CHECK(avatar IN ('ruby','ocean','violet','emerald','amber')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS profiles_account ON profiles(account_id);
CREATE TRIGGER IF NOT EXISTS maximum_five_profiles BEFORE INSERT ON profiles
WHEN (SELECT count(*) FROM profiles WHERE account_id=NEW.account_id)>=5
BEGIN SELECT RAISE(ABORT,'PROFILE_LIMIT'); END;
CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64),
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  device TEXT NOT NULL,
  auth_revision INTEGER NOT NULL,
  credential_cipher TEXT NOT NULL,
  checked_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS profile_data(
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  key TEXT NOT NULL CHECK(length(key) BETWEEN 1 AND 250),
  value TEXT NOT NULL CHECK(json_valid(value)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(profile_id,key)
);
CREATE TRIGGER IF NOT EXISTS profile_data_insert_quota BEFORE INSERT ON profile_data
WHEN NOT EXISTS(SELECT 1 FROM profile_data WHERE profile_id=NEW.profile_id AND key=NEW.key)
  AND ((SELECT count(*) FROM profile_data WHERE profile_id=NEW.profile_id)>=2005
    OR (SELECT COALESCE(sum(length(CAST(value AS BLOB))),0) FROM profile_data WHERE profile_id=NEW.profile_id)
      + length(CAST(NEW.value AS BLOB))>2097152)
BEGIN SELECT RAISE(ABORT,'PROFILE_DATA_LIMIT'); END;
CREATE TRIGGER IF NOT EXISTS profile_data_update_quota BEFORE UPDATE OF value ON profile_data
WHEN (SELECT COALESCE(sum(length(CAST(value AS BLOB))),0) FROM profile_data WHERE profile_id=NEW.profile_id)
  - length(CAST(OLD.value AS BLOB)) + length(CAST(NEW.value AS BLOB))>2097152
BEGIN SELECT RAISE(ABORT,'PROFILE_DATA_LIMIT'); END;
CREATE TABLE IF NOT EXISTS account_rate_limits(
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS account_rates_expiry ON account_rate_limits(expires_at);
INSERT OR IGNORE INTO account_schema(version) VALUES(1);
