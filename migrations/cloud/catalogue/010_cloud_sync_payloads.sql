-- Private, bounded acquisition fragments. Final catalogue records remain normalized.
CREATE TABLE cloud_sync_payloads (
  task_id INTEGER NOT NULL REFERENCES crawl_tasks(id),
  part INTEGER NOT NULL,
  payload_json TEXT NOT NULL CHECK (length(CAST(payload_json AS BLOB)) <= 50000),
  observed_at TEXT NOT NULL,
  PRIMARY KEY(task_id,part)
);
