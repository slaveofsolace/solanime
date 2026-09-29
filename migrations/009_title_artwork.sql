-- Additive, independently reviewed artwork. No catalogue/source identity is rewritten.
CREATE TABLE IF NOT EXISTS artwork_matches (
  id TEXT PRIMARY KEY,
  title_id INTEGER NOT NULL REFERENCES titles(id),
  title_source TEXT NOT NULL,
  title_source_id TEXT NOT NULL,
  metadata_source TEXT NOT NULL CHECK(metadata_source='anilist'),
  media_id INTEGER NOT NULL CHECK(media_id>0),
  mal_id INTEGER,
  release_year INTEGER NOT NULL,
  format TEXT NOT NULL,
  review_status TEXT NOT NULL CHECK(review_status IN ('approved','disabled')),
  evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
  reviewed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(title_id,metadata_source),
  UNIQUE(metadata_source,media_id)
);
CREATE INDEX IF NOT EXISTS artwork_matches_source ON artwork_matches(title_source,title_source_id);
CREATE TABLE IF NOT EXISTS title_artwork (
  match_id TEXT NOT NULL REFERENCES artwork_matches(id),
  role TEXT NOT NULL CHECK(role IN ('poster','backdrop')),
  url TEXT NOT NULL,
  width INTEGER NOT NULL CHECK(width>0 AND width<=12000),
  height INTEGER NOT NULL CHECK(height>0 AND height<=12000),
  format TEXT NOT NULL CHECK(format IN ('jpeg','png','webp')),
  content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64),
  reuse_status TEXT NOT NULL CHECK(reuse_status IN ('reference-only','permission-recorded','public-domain','unknown')),
  first_seen_at TEXT NOT NULL,
  last_checked_at TEXT NOT NULL,
  last_successful_verification_at TEXT NOT NULL,
  last_error_code TEXT,
  PRIMARY KEY(match_id,role)
);
CREATE TABLE IF NOT EXISTS artwork_jobs (
  match_id TEXT PRIMARY KEY REFERENCES artwork_matches(id),
  status TEXT NOT NULL CHECK(status IN ('pending','running','retry','completed','blocked','failed')),
  checkpoint_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(checkpoint_json)),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 12 CHECK(max_attempts BETWEEN 1 AND 20),
  available_at TEXT NOT NULL,
  lease TEXT,
  lease_expires_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS artwork_jobs_due ON artwork_jobs(status,available_at);
CREATE TABLE IF NOT EXISTS artwork_source_policy (
  hostname TEXT PRIMARY KEY,
  next_request_at TEXT NOT NULL,
  blocked_status INTEGER,
  updated_at TEXT NOT NULL
);
