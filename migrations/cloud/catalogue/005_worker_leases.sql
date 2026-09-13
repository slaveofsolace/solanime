ALTER TABLE crawl_runs ADD COLUMN worker_id TEXT;
ALTER TABLE crawl_runs ADD COLUMN worker_heartbeat_at TEXT;

ALTER TABLE crawl_tasks ADD COLUMN claimed_by TEXT;
ALTER TABLE crawl_tasks ADD COLUMN lease_expires_at TEXT;

CREATE INDEX idx_runs_worker_heartbeat ON crawl_runs(worker_id, worker_heartbeat_at);
CREATE INDEX idx_tasks_lease ON crawl_tasks(run_id, status, lease_expires_at);
