import { describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '../server/db.ts';
import { importSnapshot } from '../server/ingestion/snapshot.ts';
import { auditPlaybackCoverage } from '../server/providers/playbackCoverage.ts';

const observedAt = '2026-09-25T06:00:00.000Z';
const snapshot = {
  schemaVersion: 1,
  source: 'anikoto',
  observedAt,
  titles: [
    {
      sourceId: 'coverage-title',
      slug: 'coverage-title',
      canonicalUrl: 'https://anikototv.to/watch/coverage-title',
      name: 'Coverage Title',
      episodes: [
        {
          sourceId: 'coverage-episode-1',
          number: '1',
          slug: 'coverage-episode-1',
          canonicalUrl: 'https://anikototv.to/watch/coverage-title/coverage-episode-1',
          versions: [
            {
              sourceId: 'coverage-episode-1:sub',
              language: 'sub',
              providers: [
                {
                  sourceMappingId: 'real-server-ref',
                  providerId: 'hd-1',
                  providerResourceId: 'YWJjZA==',
                },
              ],
            },
          ],
        },
      ],
    },
  ],
} as const;

describe('playback coverage audit', () => {
  it('counts stable provider references as candidates without claiming playback verification', () => {
    const db = openDatabase(':memory:');
    try {
      migrate(db);
      importSnapshot(db, snapshot);
      const audit = auditPlaybackCoverage(db);

      expect(audit.counts).toMatchObject({
        episodes: 1,
        versions: 1,
        mappings: 1,
        guardedEmbedCandidates: 1,
        playerOfferableMappings: 1,
      });
      expect(audit.scope).toBe('mapping-structure-only');
      expect(audit.byProvider['hd-1']).toMatchObject({
        mappings: 1,
        embedCandidates: 1,
        playbackVerifiedMappings: 0,
      });
      expect(audit.issues.megaPlayMappingsMissingStableReference).toBe(0);
    } finally {
      db.close();
    }
  });

  it('does not turn guessed provider rows into playable mappings', () => {
    const db = openDatabase(':memory:');
    try {
      migrate(db);
      importSnapshot(db, snapshot);
      const version = db
        .prepare("SELECT id FROM episode_versions WHERE source_id='coverage-episode-1:sub'")
        .get() as { id: number };
      db.prepare(
        `INSERT INTO episode_provider_mappings(
          version_id,provider_id,source_mapping_id,provider_resource_id,canonical_embed_url,
          mapping_origin,public_export_allowed,availability_state,first_seen_at,last_seen_at,
          last_successful_import_at,updated_at
        ) VALUES(?,?,?,?,?,'native',0,'available',?,?,?,?)`,
      ).run(
        version.id,
        'hd-2',
        'guessed-provider-row',
        null,
        null,
        observedAt,
        observedAt,
        observedAt,
        observedAt,
      );

      const audit = auditPlaybackCoverage(db);

      expect(audit.counts.mappings).toBe(2);
      expect(audit.counts.playerOfferableMappings).toBe(1);
      expect(audit.byProvider['hd-2']).toMatchObject({ mappings: 1, embedCandidates: 0 });
      expect(audit.issues.megaPlayMappingsMissingStableReference).toBe(1);
      expect(audit.samples.megaPlayMappingsMissingStableReference[0]).toMatchObject({
        providerId: 'hd-2',
        availability: 'available',
      });
      expect(audit.verdict).toBe('fail');
    } finally {
      db.close();
    }
  });
});
