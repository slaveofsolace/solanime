UPDATE related_titles
SET related_title_id = (
  SELECT t.id
  FROM titles t
  WHERE t.source = 'anikoto'
    AND t.source_id = related_titles.related_source_id
)
WHERE related_title_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM titles t
    WHERE t.source = 'anikoto'
      AND t.source_id = related_titles.related_source_id
  );

CREATE INDEX IF NOT EXISTS idx_related_title_target ON related_titles(related_title_id);
CREATE INDEX IF NOT EXISTS idx_related_title_source ON related_titles(related_source_id);
