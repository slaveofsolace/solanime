-- Preserve the exact discovery-first order without sorting the entire pending
-- queue on every claim. Completed records are excluded from this small index.
CREATE INDEX IF NOT EXISTS idx_tasks_pending_priority ON crawl_tasks(
  run_id,
  CASE task_type
    WHEN 'catalogue_page' THEN 0
    WHEN 'sitemap_index' THEN 1
    WHEN 'sitemap_page' THEN 2
    WHEN 'sitemap_title' THEN 3
    WHEN 'title_detail' THEN 4
    WHEN 'catalogue_reconcile' THEN 5
    ELSE 6
  END,
  id
) WHERE status IN ('pending','retry');
