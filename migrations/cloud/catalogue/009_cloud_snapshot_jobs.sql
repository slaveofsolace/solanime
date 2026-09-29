-- Only pinned deployment assets may supply snapshot jobs. Imported local IDs remain unchanged.
CREATE TABLE cloud_snapshot_jobs (
  id TEXT PRIMARY KEY,
  manifest_path TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  source_manifest_hash TEXT NOT NULL,
  run_id INTEGER NOT NULL UNIQUE REFERENCES crawl_runs(id),
  task_id INTEGER NOT NULL UNIQUE REFERENCES crawl_tasks(id),
  total_batches INTEGER NOT NULL CHECK (total_batches > 0),
  total_rows INTEGER NOT NULL CHECK (total_rows > 0),
  created_at TEXT NOT NULL
);
