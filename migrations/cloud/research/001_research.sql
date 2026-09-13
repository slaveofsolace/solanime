-- Operator-only database. Research declarations do not enable application capabilities.
CREATE TABLE research_records (
  id TEXT PRIMARY KEY,
  collection TEXT NOT NULL,
  source_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  url TEXT,
  research_status TEXT NOT NULL DEFAULT 'unverified',
  evidence_class TEXT NOT NULL DEFAULT 'public_reference',
  observation_date TEXT,
  canonical_id TEXT,
  provenance_path TEXT NOT NULL,
  record_json TEXT NOT NULL CHECK(json_valid(record_json)),
  record_hash TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  UNIQUE(collection,source_id)
);
CREATE INDEX idx_research_kind_name ON research_records(kind,name COLLATE NOCASE,id);
CREATE INDEX idx_research_status ON research_records(research_status,id);
CREATE INDEX idx_research_collection ON research_records(collection,id);
CREATE TABLE research_record_fragments (
  record_id TEXT NOT NULL REFERENCES research_records(id),
  fragment_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  PRIMARY KEY(record_id,fragment_index)
);
CREATE TABLE research_categories (
  record_id TEXT NOT NULL REFERENCES research_records(id),
  category TEXT NOT NULL,
  PRIMARY KEY(record_id,category)
);
CREATE INDEX idx_research_categories ON research_categories(category,record_id);
CREATE TABLE research_relationships (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  confidence TEXT NOT NULL,
  verification_scope TEXT NOT NULL,
  source_url TEXT,
  observation_date TEXT,
  evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
  provenance_path TEXT NOT NULL
);
CREATE INDEX idx_research_relationship_source ON research_relationships(source_id,id);
CREATE INDEX idx_research_relationship_target ON research_relationships(target_id,id);
CREATE TABLE research_aliases (
  alias_id TEXT PRIMARY KEY,
  canonical_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  provenance_path TEXT NOT NULL
);
CREATE TABLE research_documents (
  path TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  media_type TEXT NOT NULL,
  imported_at TEXT NOT NULL
);
CREATE TABLE research_capabilities (
  record_id TEXT NOT NULL REFERENCES research_records(id),
  capability TEXT NOT NULL CHECK(capability IN ('catalogue','identifier_mapping','metadata','artwork','subtitle','playback')),
  implementation_state TEXT NOT NULL DEFAULT 'disabled' CHECK(implementation_state IN ('disabled','implemented','blocked')),
  runtime_verified INTEGER NOT NULL DEFAULT 0 CHECK(runtime_verified IN(0,1)),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  PRIMARY KEY(record_id,capability)
);
CREATE TABLE research_reviews (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES research_records(id),
  action TEXT NOT NULL CHECK(action IN ('reviewed','needs_investigation','blocked','rejected')),
  note TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_research_reviews ON research_reviews(record_id,created_at DESC,id);
CREATE TABLE cloud_import_receipts (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  estimated_writes INTEGER NOT NULL,
  imported_at TEXT NOT NULL
);
CREATE TABLE cloud_snapshot_sources (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  counts_json TEXT NOT NULL,
  observation_date TEXT,
  imported_at TEXT NOT NULL
);
