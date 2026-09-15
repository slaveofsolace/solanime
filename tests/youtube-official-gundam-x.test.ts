import { afterEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type SqliteDatabase } from '../server/db.ts';
import { importSnapshot } from '../server/ingestion/snapshot.ts';
import {
  AFTER_WAR_GUNDAM_X_APPROVAL_ROWS,
  AFTER_WAR_GUNDAM_X_EPISODE_APPROVALS,
  applyOfficialYouTubeApproval,
  locateOfficialYouTubeEpisode,
  OFFICIAL_YOUTUBE_EPISODE_APPROVALS,
  verifyOfficialYouTubeOEmbed,
} from '../server/ingestion/youtubeOfficial.ts';
import { getMapping } from '../server/catalogue.ts';
import { GUNDAM_INFO_PUBLISHER, resolveOfficialYouTube } from '../server/providers/youtubeOfficial.ts';
import type { ApprovedNativeResource } from '../server/providers/native.ts';

const databases: SqliteDatabase[] = [];

function database(): SqliteDatabase {
  const db = openDatabase(':memory:');
  databases.push(db);
  migrate(db);
  importSnapshot(db, {
    schemaVersion: 1,
    source: 'anikoto',
    observedAt: '2026-09-13T23:30:00.000Z',
    titles: [{
      sourceId: '2106',
      slug: 'after-war-gundam-x-nawe0',
      canonicalUrl: 'https://anikototv.to/watch/after-war-gundam-x-nawe0',
      name: 'After War Gundam X',
      episodes: AFTER_WAR_GUNDAM_X_EPISODE_APPROVALS.map((approval) => ({
        sourceId: approval.catalogue.episodeSourceId,
        number: approval.catalogue.episodeNumber,
        slug: approval.catalogue.episodeNumber,
        canonicalUrl: `https://anikototv.to/watch/after-war-gundam-x-nawe0/${approval.catalogue.episodeNumber}`,
        versions: [{
          sourceId: approval.catalogue.versionSourceId,
          language: 'sub',
          providers: [],
        }],
      })),
    }],
  });
  return db;
}

function oEmbed(index: number): Response {
  const approval = AFTER_WAR_GUNDAM_X_EPISODE_APPROVALS[index];
  return Response.json({
    type: 'video',
    provider_name: 'YouTube',
    title: approval.video.title,
    author_name: GUNDAM_INFO_PUBLISHER.label,
    author_url: GUNDAM_INFO_PUBLISHER.handleUrl,
    html: `<iframe src="https://www.youtube.com/embed/${approval.video.id}"></iframe>`,
  });
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe('After War Gundam X official YouTube approvals', () => {
  it('keeps all 39 reviewed episode, catalogue and video identities explicit', () => {
    expect(AFTER_WAR_GUNDAM_X_APPROVAL_ROWS).toHaveLength(39);
    expect(AFTER_WAR_GUNDAM_X_EPISODE_APPROVALS).toHaveLength(39);
    expect(new Set(AFTER_WAR_GUNDAM_X_APPROVAL_ROWS.map((row) => row[4])).size).toBe(39);
    expect(AFTER_WAR_GUNDAM_X_APPROVAL_ROWS.map((row) => row[0])).toEqual(
      Array.from({ length: 39 }, (_, index) => index + 1),
    );
    expect(AFTER_WAR_GUNDAM_X_APPROVAL_ROWS.map((row) => row[2])).toEqual(
      Array.from({ length: 39 }, (_, index) => 101860 + index),
    );
    expect(AFTER_WAR_GUNDAM_X_APPROVAL_ROWS.map((row) => row[3])).toEqual(
      Array.from({ length: 39 }, (_, index) => 132527 + index),
    );

    for (const [index, approval] of AFTER_WAR_GUNDAM_X_EPISODE_APPROVALS.entries()) {
      const [episodeNumber, episodeSourceId, , , videoId, videoTitle, observedAt] =
        AFTER_WAR_GUNDAM_X_APPROVAL_ROWS[index];
      const subtitleLabel = episodeNumber >= 11 && episodeNumber <= 18 ? 'sbtitles' : 'subtitles';
      expect(approval).toMatchObject({
        id: `gundam-info-after-war-gundam-x-episode-${episodeNumber}`,
        catalogue: {
          source: 'anikoto',
          titleSourceId: '2106',
          titleSlug: 'after-war-gundam-x-nawe0',
          episodeSourceId,
          episodeNumber: String(episodeNumber),
          versionSourceId: `${episodeSourceId}:sub`,
          language: 'sub',
        },
        video: {
          id: videoId,
          title: `After War Gundam X -Episode${episodeNumber}(w/${subtitleLabel})`,
          watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
          channelId: GUNDAM_INFO_PUBLISHER.channelId,
        },
        titleIdentityUrl: 'https://en.gundam-official.com/gundam-x/news/mh8xey7310egn849s70ifaon/',
        episodeIdentityUrl: 'https://en.gundam-official.com/gundam-x/news/mh8xey7310egn849s70ifaon/',
        observedAt,
      });
      expect(approval.video.title).toBe(videoTitle);
      expect(OFFICIAL_YOUTUBE_EPISODE_APPROVALS).toContain(approval);
    }
  });

  it('requires the exact GUNDAM CHANNEL INTL identity for first, middle and last samples', async () => {
    for (const index of [0, 19, 38]) {
      const approval = AFTER_WAR_GUNDAM_X_EPISODE_APPROVALS[index];
      await expect(verifyOfficialYouTubeOEmbed(approval, async () => oEmbed(index))).resolves.toEqual({
        title: approval.video.title,
        author: GUNDAM_INFO_PUBLISHER.label,
      });
      await expect(verifyOfficialYouTubeOEmbed(approval, async () => {
        const payload = await oEmbed(index).json() as Record<string, unknown>;
        return Response.json({ ...payload, author_name: 'Unrelated uploader' });
      })).rejects.toThrow('YOUTUBE_PUBLISHER_OR_IDENTITY_MISMATCH');
    }
  });

  it('applies all 39 mappings idempotently and resolves representative episodes', () => {
    const db = database();
    const first = AFTER_WAR_GUNDAM_X_EPISODE_APPROVALS.map((approval) =>
      applyOfficialYouTubeApproval(db, approval, '2026-09-15T18:45:00.000Z'));
    const second = AFTER_WAR_GUNDAM_X_EPISODE_APPROVALS.map((approval) =>
      applyOfficialYouTubeApproval(db, approval, '2026-09-15T18:46:00.000Z'));

    expect(second.map((row) => row.mappingId)).toEqual(first.map((row) => row.mappingId));
    expect(db.prepare("SELECT COUNT(*) AS count FROM episode_provider_mappings WHERE provider_id='youtube-official'").get())
      .toEqual({ count: 39 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM native_resources WHERE provider_id='youtube-official'").get())
      .toEqual({ count: 39 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM verification_observations WHERE reason_code='OFFICIAL_YOUTUBE_REVIEWED'").get())
      .toEqual({ count: 39 });

    for (const index of [0, 19, 38]) {
      const approval = AFTER_WAR_GUNDAM_X_EPISODE_APPROVALS[index];
      expect(locateOfficialYouTubeEpisode(db, approval)).toEqual({
        titleId: first[index].titleId,
        episodeId: first[index].episodeId,
        versionId: first[index].versionId,
      });
      const mapping = getMapping(db, first[index].mappingId);
      const resource = db.prepare('SELECT * FROM native_resources WHERE mapping_id=?')
        .get(first[index].mappingId) as ApprovedNativeResource;
      expect(resolveOfficialYouTube(mapping, resource)).toMatchObject({
        kind: 'official-youtube',
        videoId: approval.video.id,
        publisher: GUNDAM_INFO_PUBLISHER,
        attribution: { url: approval.video.watchUrl },
      });
    }
  });
});
