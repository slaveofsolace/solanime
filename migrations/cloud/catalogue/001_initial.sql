PRAGMA foreign_keys = ON;

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE titles (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'anikoto',
  source_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  format TEXT,
  release_year INTEGER,
  status TEXT,
  artwork_url TEXT,
  artwork_origin TEXT,
  artwork_reuse_status TEXT NOT NULL DEFAULT 'unknown',
  availability_state TEXT NOT NULL DEFAULT 'observed' CHECK (availability_state IN ('observed','available','unavailable','blocked','stale','unknown')),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_successful_import_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source, source_id),
  UNIQUE(source, slug)
);

CREATE TABLE title_aliases (
  id INTEGER PRIMARY KEY,
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  language TEXT,
  alias_type TEXT NOT NULL DEFAULT 'alternate',
  UNIQUE(title_id, alias, language)
);

CREATE TABLE genres (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE title_genres (
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  genre_id INTEGER NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
  PRIMARY KEY(title_id, genre_id)
);

CREATE TABLE related_titles (
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  related_title_id INTEGER REFERENCES titles(id) ON DELETE SET NULL,
  related_source_id TEXT,
  relationship_type TEXT NOT NULL,
  label TEXT,
  source_url TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY(title_id, relationship_type, related_source_id)
);

CREATE TABLE episodes (
  id INTEGER PRIMARY KEY,
  title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  number_text TEXT NOT NULL,
  number_sort REAL,
  label TEXT,
  slug TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  episode_type TEXT NOT NULL DEFAULT 'regular',
  availability_state TEXT NOT NULL DEFAULT 'observed' CHECK (availability_state IN ('observed','available','unavailable','blocked','stale','unknown')),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_successful_import_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(title_id, source_id),
  UNIQUE(title_id, slug)
);

CREATE TABLE episode_versions (
  id INTEGER PRIMARY KEY,
  episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  language TEXT NOT NULL,
  version_label TEXT,
  audio_language TEXT,
  subtitle_language TEXT,
  availability_state TEXT NOT NULL DEFAULT 'observed' CHECK (availability_state IN ('observed','available','unavailable','blocked','stale','unknown')),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_successful_import_at TEXT,
  UNIQUE(episode_id, source_id, language)
);

CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  identity_state TEXT NOT NULL CHECK (identity_state IN ('confirmed','corroborated','inferred','unknown')),
  playback_type TEXT NOT NULL CHECK (playback_type IN ('iframe','hls','dash','direct','download','unknown')),
  adapter_state TEXT NOT NULL DEFAULT 'unavailable' CHECK (adapter_state IN ('implemented','unavailable','blocked','unknown')),
  hostname TEXT,
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  observed_limitation TEXT,
  evidence_class TEXT NOT NULL DEFAULT 'direct_observation',
  first_seen_at TEXT,
  last_seen_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE provider_aliases (
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  alias_type TEXT NOT NULL DEFAULT 'visible_label',
  PRIMARY KEY(provider_id, alias)
);

CREATE TABLE episode_provider_mappings (
  id INTEGER PRIMARY KEY,
  version_id INTEGER NOT NULL REFERENCES episode_versions(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  source_mapping_id TEXT NOT NULL,
  provider_resource_id TEXT,
  canonical_embed_url TEXT,
  mapping_origin TEXT NOT NULL DEFAULT 'native' CHECK (mapping_origin IN ('native','external_mapper')),
  public_export_allowed INTEGER NOT NULL DEFAULT 0 CHECK (public_export_allowed IN (0,1)),
  availability_state TEXT NOT NULL DEFAULT 'observed' CHECK (availability_state IN ('observed','available','unavailable','blocked','stale','unknown')),
  unavailable_reason TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_successful_import_at TEXT,
  last_successful_resolution_at TEXT,
  last_playback_verification_at TEXT,
  resolution_evidence_state TEXT NOT NULL DEFAULT 'unverified' CHECK (resolution_evidence_state IN ('unverified','resolved','player_loaded','playback_verified','failed')),
  updated_at TEXT NOT NULL,
  UNIQUE(version_id, provider_id, source_mapping_id)
);

CREATE TABLE crawl_runs (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('slice','full','incremental','snapshot')),
  status TEXT NOT NULL CHECK (status IN ('queued','running','paused','completed','failed','cancelled')),
  budget INTEGER,
  tasks_discovered INTEGER NOT NULL DEFAULT 0,
  tasks_completed INTEGER NOT NULL DEFAULT 0,
  tasks_failed INTEGER NOT NULL DEFAULT 0,
  checkpoint_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE crawl_tasks (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES crawl_runs(id) ON DELETE CASCADE,
  task_key TEXT NOT NULL,
  task_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','running','retry','completed','failed','blocked','cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 4,
  available_at TEXT NOT NULL,
  claimed_at TEXT,
  completed_at TEXT,
  last_http_status INTEGER,
  last_error_code TEXT,
  last_error_message TEXT,
  retry_after_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(run_id, task_key)
);

CREATE TABLE verification_observations (
  id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('observed','adapter_implemented','source_resolved','player_loaded','playback_verified','failed','blocked')),
  result TEXT NOT NULL,
  reason_code TEXT,
  evidence_class TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  observed_at TEXT NOT NULL
);

CREATE TABLE coverage_snapshots (
  id INTEGER PRIMARY KEY,
  run_id INTEGER REFERENCES crawl_runs(id) ON DELETE SET NULL,
  discovered_titles INTEGER NOT NULL DEFAULT 0,
  imported_titles INTEGER NOT NULL DEFAULT 0,
  discovered_episodes INTEGER NOT NULL DEFAULT 0,
  imported_episodes INTEGER NOT NULL DEFAULT 0,
  imported_versions INTEGER NOT NULL DEFAULT 0,
  discovered_mappings INTEGER NOT NULL DEFAULT 0,
  imported_mappings INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0,
  blocked INTEGER NOT NULL DEFAULT 0,
  pending INTEGER NOT NULL DEFAULT 0,
  denominator_scope TEXT,
  captured_at TEXT NOT NULL
);

CREATE INDEX idx_titles_name ON titles(name COLLATE NOCASE);
CREATE INDEX idx_titles_browse ON titles(status, format, release_year DESC, name COLLATE NOCASE);
CREATE INDEX idx_aliases_search ON title_aliases(alias COLLATE NOCASE);
CREATE INDEX idx_episodes_title_sort ON episodes(title_id, number_sort, number_text);
CREATE INDEX idx_versions_episode_language ON episode_versions(episode_id, language);
CREATE INDEX idx_mappings_version_state ON episode_provider_mappings(version_id, availability_state);
CREATE INDEX idx_tasks_claim ON crawl_tasks(run_id, status, available_at, id);
CREATE INDEX idx_tasks_errors ON crawl_tasks(status, last_error_code, updated_at DESC);
CREATE INDEX idx_observations_entity ON verification_observations(entity_type, entity_id, observed_at DESC);

INSERT INTO providers(id,label,identity_state,playback_type,adapter_state,hostname,capabilities_json,observed_limitation,evidence_class,first_seen_at,last_seen_at,updated_at) VALUES
 ('vidstream-2','Vidstream-2','confirmed','unknown','unavailable',NULL,'{}','Visible label confirmed; no reliable current label-to-host mapping.','direct_observation','2026-09-09T00:00:00.000Z','2026-09-09T00:00:00.000Z','2026-09-09T00:00:00.000Z'),
 ('hd-1','HD-1','confirmed','iframe','implemented','megaplay.buzz','{"embed":true,"fullscreen":true}','Observed MegaPlay iframe connection on one SUB mapping; media extensions were blocked and playback was not verified.','direct_observation','2026-09-09T00:00:00.000Z','2026-09-09T00:00:00.000Z','2026-09-09T00:00:00.000Z'),
 ('hd-2','HD-2','confirmed','unknown','unavailable',NULL,'{}','Visible label confirmed; backend unknown.','direct_observation','2026-09-09T00:00:00.000Z','2026-09-09T00:00:00.000Z','2026-09-09T00:00:00.000Z'),
 ('vidplay-1','VidPlay-1','confirmed','unknown','unavailable',NULL,'{}','Visible label confirmed; no reliable current label-to-host mapping.','direct_observation','2026-09-09T00:00:00.000Z','2026-09-09T00:00:00.000Z','2026-09-09T00:00:00.000Z'),
 ('kiwi','Kiwi','confirmed','download','unavailable',NULL,'{}','Observed as a download/source label; exact role and backend unknown.','direct_observation','2026-09-09T00:00:00.000Z','2026-09-09T00:00:00.000Z','2026-09-09T00:00:00.000Z'),
 ('megaplay','MegaPlay','corroborated','iframe','unavailable','megaplay.buzz','{"embed":true}','Independent resolver corroborates a route, but no UI-label mapping or authorized stable resource is established.','third_party_code','2026-09-09T00:00:00.000Z','2026-09-09T00:00:00.000Z','2026-09-09T00:00:00.000Z');

INSERT INTO provider_aliases(provider_id,alias,alias_type) VALUES
 ('vidstream-2','Vidstream-2','visible_label'),
 ('hd-1','HD-1','visible_label'),
 ('hd-2','HD-2','visible_label'),
 ('vidplay-1','VidPlay-1','visible_label'),
 ('kiwi','Kiwi','visible_label'),
 ('megaplay','MegaPlay','corroborated_name');
