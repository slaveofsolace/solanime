-- D1 is authoritative; a Queue notification may expire without losing a task.
ALTER TABLE crawl_tasks ADD COLUMN cloud_dispatched_at TEXT;
ALTER TABLE crawl_tasks ADD COLUMN cloud_dispatch_token TEXT;
ALTER TABLE crawl_tasks ADD COLUMN checkpoint_json TEXT NOT NULL DEFAULT '{}';
CREATE INDEX idx_cloud_tasks_due ON crawl_tasks(status,available_at,cloud_dispatched_at,id);

CREATE TABLE cloud_daily_budget (
  day TEXT PRIMARY KEY,
  writes_reserved INTEGER NOT NULL DEFAULT 0 CHECK(writes_reserved>=0),
  queue_operations_reserved INTEGER NOT NULL DEFAULT 0 CHECK(queue_operations_reserved>=0),
  updated_at TEXT NOT NULL
);
CREATE TABLE cloud_budget_reservations (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  writes_reserved INTEGER NOT NULL,
  queue_operations_reserved INTEGER NOT NULL,
  settled_writes INTEGER,
  created_at TEXT NOT NULL
);
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
CREATE TABLE cloud_sync_control (
  id INTEGER PRIMARY KEY CHECK(id=1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  updated_at TEXT NOT NULL
);
INSERT INTO cloud_sync_control(id,enabled,updated_at) VALUES(1,0,'2026-09-12T00:00:00.000Z');
CREATE TABLE cloud_source_policy (
  hostname TEXT PRIMARY KEY,
  policy_json TEXT NOT NULL DEFAULT '{}',
  expires_at TEXT,
  next_allowed_at INTEGER NOT NULL DEFAULT 0
);
