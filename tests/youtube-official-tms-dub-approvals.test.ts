import { afterEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type SqliteDatabase } from '../server/db.ts';
import { importSnapshot } from '../server/ingestion/snapshot.ts';
import {
  applyOfficialYouTubeApproval,
  locateOfficialYouTubeEpisode,
  reconcileOfficialYouTubeEdition,
  type OfficialYouTubeEpisodeApproval,
} from '../server/ingestion/youtubeOfficial.ts';
import {
  TMS_CARDFIGHT_VANGUARD_OFFICIAL_YOUTUBE_EPISODE_APPROVALS,
  TMS_SHERLOCK_HOUND_OFFICIAL_YOUTUBE_EPISODE_APPROVALS,
} from '../server/ingestion/youtubeOfficialTmsDubApprovals.ts';
import { TMS_PUBLISHER, officialYouTubePublisherPolicyForChannel } from '../shared/youtubeOfficialPublishers.ts';

const databases: SqliteDatabase[] = [];
const allApprovals = [
  ...TMS_SHERLOCK_HOUND_OFFICIAL_YOUTUBE_EPISODE_APPROVALS,
  ...TMS_CARDFIGHT_VANGUARD_OFFICIAL_YOUTUBE_EPISODE_APPROVALS,
];
const approval = TMS_SHERLOCK_HOUND_OFFICIAL_YOUTUBE_EPISODE_APPROVALS[0];

function database(): SqliteDatabase {
  const db = openDatabase(':memory:');
  databases.push(db);
  migrate(db);
  importSnapshot(db, {
    schemaVersion: 1,
    source: 'anikoto',
    observedAt: approval.observedAt,
    titles: [{
      sourceId: approval.catalogue.titleSourceId,
      slug: approval.catalogue.titleSlug,
      canonicalUrl: `https://anikototv.to/watch/${approval.catalogue.titleSlug}`,
      name: 'Sherlock Hound',
      episodes: [{
        sourceId: approval.catalogue.episodeSourceId,
        number: approval.catalogue.episodeNumber,
        slug: '1',
        canonicalUrl: `https://anikototv.to/watch/${approval.catalogue.titleSlug}/1`,
        versions: [{
          sourceId: `${approval.catalogue.episodeSourceId}:sub`,
          language: 'sub',
          label: 'Subtitled',
          subtitleLanguage: 'en',
          providers: [],
        }],
      }],
    }],
  });
  return db;
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe('TMS supplemental English-dub approvals', () => {
  it('preserves 45 unique, contiguous, publisher-reviewed episode identities', () => {
    expect(TMS_SHERLOCK_HOUND_OFFICIAL_YOUTUBE_EPISODE_APPROVALS).toHaveLength(26);
    expect(TMS_CARDFIGHT_VANGUARD_OFFICIAL_YOUTUBE_EPISODE_APPROVALS).toHaveLength(19);
    expect(new Set(allApprovals.map((item) => item.id)).size).toBe(45);
    expect(new Set(allApprovals.map((item) => item.video.id)).size).toBe(45);
    expect(new Set(allApprovals.map((item) => item.catalogue.versionSourceId)).size).toBe(45);
    expect(TMS_SHERLOCK_HOUND_OFFICIAL_YOUTUBE_EPISODE_APPROVALS.map((item) => Number(item.catalogue.episodeNumber)))
      .toEqual(Array.from({ length: 26 }, (_, index) => index + 1));
    expect(TMS_CARDFIGHT_VANGUARD_OFFICIAL_YOUTUBE_EPISODE_APPROVALS.map((item) => Number(item.catalogue.episodeNumber)))
      .toEqual(Array.from({ length: 19 }, (_, index) => index + 1));
  });

  it('keeps the title crosswalk, dub identity, and TMS publisher policy exact', () => {
    for (const item of allApprovals) {
      expect(item.id.startsWith('tms-dub-')).toBe(true);
      expect(item.catalogue.language).toBe('dub');
      expect(item.catalogue.versionSourceId).toBe(`${item.catalogue.episodeSourceId}:dub`);
      expect(item.supplementalVersion).toEqual({
        createIfMissing: true,
        versionLabel: 'Dubbed',
        audioLanguage: 'en',
        subtitleLanguage: null,
      });
      expect(item.video.channelId).toBe(TMS_PUBLISHER.channelId);
      expect(item.video.title).toMatch(/English Dub/);
      expect(item.video.watchUrl).toBe(`https://www.youtube.com/watch?v=${item.video.id}`);
      expect(Number.isFinite(Date.parse(item.observedAt))).toBe(true);
      expect(officialYouTubePublisherPolicyForChannel(item.video.channelId)?.publisher).toBe(TMS_PUBLISHER);
    }
    expect(new Set(TMS_SHERLOCK_HOUND_OFFICIAL_YOUTUBE_EPISODE_APPROVALS.map((item) => item.catalogue.titleSourceId)))
      .toEqual(new Set(['290']));
    expect(new Set(TMS_CARDFIGHT_VANGUARD_OFFICIAL_YOUTUBE_EPISODE_APPROVALS.map((item) => item.catalogue.titleSourceId)))
      .toEqual(new Set(['2518']));
  });

  it('creates only the explicitly reviewed missing dub version and remains idempotent', () => {
    const db = database();
    const before = locateOfficialYouTubeEpisode(db, approval);
    expect(before.versionId).toBeNull();
    expect(reconcileOfficialYouTubeEdition(db, approval)).toBeNull();

    const first = applyOfficialYouTubeApproval(db, approval, '2026-09-18T06:00:00.000Z');
    const second = applyOfficialYouTubeApproval(db, approval, '2026-09-18T06:01:00.000Z');
    expect(second).toEqual(first);
    expect(db.prepare(`SELECT source_id AS sourceId,language,version_label AS versionLabel,
      audio_language AS audioLanguage,subtitle_language AS subtitleLanguage,availability_state AS availability
      FROM episode_versions WHERE id=?`).get(first.versionId)).toEqual({
        sourceId: `${approval.catalogue.episodeSourceId}:dub`,
        language: 'dub',
        versionLabel: 'Dubbed',
        audioLanguage: 'en',
        subtitleLanguage: null,
        availability: 'observed',
      });
    expect(db.prepare("SELECT COUNT(*) AS count FROM episode_versions WHERE language='sub'").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM episode_versions WHERE language='dub'").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM episode_provider_mappings WHERE provider_id='youtube-official'").get()).toEqual({ count: 1 });
  });

  it('rejects malformed opt-ins and rolls back conflicting version metadata', () => {
    const malformed = {
      ...approval,
      supplementalVersion: { ...approval.supplementalVersion, createIfMissing: false },
    } as unknown as OfficialYouTubeEpisodeApproval;
    const malformedDb = database();
    expect(() => locateOfficialYouTubeEpisode(malformedDb, malformed)).toThrow('INVALID_OFFICIAL_YOUTUBE_APPROVAL');

    const conflictDb = database();
    const identity = locateOfficialYouTubeEpisode(conflictDb, approval);
    conflictDb.prepare(`INSERT INTO episode_versions(episode_id,source_id,language,version_label,
      audio_language,subtitle_language,availability_state,first_seen_at,last_seen_at,last_successful_import_at)
      VALUES(?,?,?,'Incorrect','ja',NULL,'observed',?,?,?)`).run(
        identity.episodeId,
        approval.catalogue.versionSourceId,
        approval.catalogue.language,
        approval.observedAt,
        approval.observedAt,
        approval.observedAt,
      );
    expect(() => applyOfficialYouTubeApproval(conflictDb, approval)).toThrow(
      'OFFICIAL_YOUTUBE_VERSION_IDENTITY_CONFLICT',
    );
    expect(conflictDb.prepare("SELECT COUNT(*) AS count FROM episode_provider_mappings WHERE provider_id='youtube-official'").get())
      .toEqual({ count: 0 });
  });
});
