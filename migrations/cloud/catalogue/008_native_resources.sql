CREATE TABLE native_resources (
  mapping_id INTEGER PRIMARY KEY REFERENCES episode_provider_mappings(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  resource_id TEXT NOT NULL,
  language TEXT NOT NULL,
  edition TEXT NOT NULL,
  license TEXT NOT NULL,
  rights_evidence_url TEXT NOT NULL,
  identity_evidence_url TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1))
);
