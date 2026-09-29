CREATE TABLE mal_connections (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  username TEXT, credential_cipher TEXT,
  committed_generation TEXT, imported_at INTEGER,
  sync_generation TEXT, sync_offset INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE mal_oauth_states (
  state_hash TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  verifier_cipher TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE mal_list_items (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  generation TEXT NOT NULL, mal_id INTEGER NOT NULL, value TEXT NOT NULL,
  PRIMARY KEY(profile_id,generation,mal_id)
);
