CREATE TABLE provider_connections (
  id INTEGER PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  hostname TEXT NOT NULL,
  path_pattern TEXT,
  relationship TEXT NOT NULL,
  evidence_state TEXT NOT NULL CHECK (evidence_state IN ('observed','corroborated','inferred','unknown')),
  observation_scope TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE(provider_id,hostname,path_pattern,relationship)
);

INSERT INTO provider_connections(provider_id,hostname,path_pattern,relationship,evidence_state,observation_scope,first_seen_at,last_seen_at) VALUES
 ('vidstream-2','megaplay.buzz','/stream/s-2/','resolved_embed_backend','observed','Bleach episode 1 SUB and one imported Candy Caries episode mapping; source resolution only','2026-09-10T04:30:00.000Z','2026-09-10T13:03:36.300Z'),
 ('hd-1','megaplay.buzz','/stream/s-2/','resolved_embed_backend','observed','Bleach episode 1 SUB and one imported Candy Caries episode mapping; source resolution plus sandbox-rejection document','2026-09-10T04:30:00.000Z','2026-09-10T13:25:49.238Z'),
 ('hd-2','megaplay.buzz','/stream/s-2/','resolved_embed_backend','observed','Bleach episode 1 SUB and one imported Candy Caries episode mapping; source resolution only','2026-09-10T04:30:00.000Z','2026-09-10T13:03:37.485Z');

UPDATE providers SET identity_state='corroborated',evidence_class='research_attachment',observed_limitation='Reported in the supplied research attachment but not re-observed in the bounded live samples; backend unknown.',updated_at='2026-09-10T13:30:00.000Z' WHERE id='vidplay-1';

DELETE FROM provider_aliases WHERE provider_id='megaplay';
DELETE FROM providers WHERE id='megaplay';

CREATE INDEX idx_provider_connections_provider ON provider_connections(provider_id,last_seen_at DESC);
