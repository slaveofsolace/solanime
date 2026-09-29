CREATE TABLE external_catalogue_sync (
  source TEXT PRIMARY KEY,
  next_page INTEGER NOT NULL DEFAULT 0 CHECK(next_page >= 0),
  status TEXT NOT NULL DEFAULT 'idle' CHECK(status IN ('idle','running','paused','complete','failed')),
  pages_imported INTEGER NOT NULL DEFAULT 0 CHECK(pages_imported >= 0),
  titles_imported INTEGER NOT NULL DEFAULT 0 CHECK(titles_imported >= 0),
  episodes_imported INTEGER NOT NULL DEFAULT 0 CHECK(episodes_imported >= 0),
  last_error_code TEXT,
  last_error_message TEXT,
  last_successful_import_at TEXT,
  updated_at TEXT NOT NULL
);
