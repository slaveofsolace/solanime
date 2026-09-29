-- Stable sorting and filters used by catalogue requests.
CREATE INDEX IF NOT EXISTS idx_titles_updated_id ON titles(updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_titles_lower_format ON titles(LOWER(format));
CREATE INDEX IF NOT EXISTS idx_titles_lower_status ON titles(LOWER(status));
CREATE INDEX IF NOT EXISTS idx_versions_language_episode ON episode_versions(language, episode_id);
