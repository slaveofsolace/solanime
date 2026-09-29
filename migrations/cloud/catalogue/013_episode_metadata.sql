ALTER TABLE episodes ADD COLUMN thumbnail_url TEXT;
ALTER TABLE episodes ADD COLUMN thumbnail_origin TEXT;
ALTER TABLE episodes ADD COLUMN thumbnail_reuse_status TEXT;
ALTER TABLE episodes ADD COLUMN duration_seconds INTEGER CHECK(duration_seconds IS NULL OR duration_seconds BETWEEN 1 AND 86400);
ALTER TABLE episodes ADD COLUMN season_number INTEGER CHECK(season_number IS NULL OR season_number BETWEEN 0 AND 10000);
