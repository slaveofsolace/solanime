-- PRIVATE DATABASE ONLY. Public responses expose a sanitized projection and never
-- account IDs, Firebase identities, email addresses, session data, or profile IDs.
CREATE TABLE IF NOT EXISTS episode_comments(
  id TEXT PRIMARY KEY CHECK(length(id)=36),
  episode_id INTEGER NOT NULL CHECK(episode_id > 0),
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 1000),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
  moderation_state TEXT NOT NULL DEFAULT 'visible'
    CHECK(moderation_state IN ('visible','hidden')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL CHECK(updated_at >= created_at)
);
CREATE INDEX IF NOT EXISTS episode_comments_public_page
  ON episode_comments(episode_id,moderation_state,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS episode_comments_profile
  ON episode_comments(profile_id,updated_at DESC,id DESC);
CREATE TRIGGER IF NOT EXISTS episode_comment_profile_limit BEFORE INSERT ON episode_comments
WHEN (SELECT count(*) FROM episode_comments WHERE profile_id=NEW.profile_id)>=5000
  OR (SELECT count(*) FROM episode_comments
      WHERE profile_id=NEW.profile_id AND episode_id=NEW.episode_id)>=100
BEGIN SELECT RAISE(ABORT,'COMMENT_LIMIT'); END;
INSERT OR IGNORE INTO account_schema(version) VALUES(2);
