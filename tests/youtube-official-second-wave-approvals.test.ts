import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrate, openDatabase, type SqliteDatabase } from '../server/db.ts';
import {
  applyOfficialYouTubeApproval,
  locateOfficialYouTubeEpisode,
  verifyOfficialYouTubeOEmbed,
  type OfficialYouTubeEpisodeApproval,
} from '../server/ingestion/youtubeOfficial.ts';
import {
  REMOW_BOOGIEPOP_PHANTOM_APPROVAL_ROWS,
  REMOW_BOOGIEPOP_PHANTOM_EPISODE_APPROVALS,
  SECOND_WAVE_OFFICIAL_YOUTUBE_CATALOGUE_IDENTITIES,
  SECOND_WAVE_OFFICIAL_YOUTUBE_EPISODE_APPROVALS,
  TMS_ACTUALLY_I_AM_APPROVAL_ROWS,
  TMS_ACTUALLY_I_AM_EPISODE_APPROVALS,
  TMS_BRAVE_10_APPROVAL_ROWS,
  TMS_BRAVE_10_EPISODE_APPROVALS,
  TMS_GOD_MAZINGER_APPROVAL_ROWS,
  TMS_GOD_MAZINGER_EPISODE_APPROVALS,
  TMS_NEW_TETSUJIN_28_APPROVAL_ROWS,
  TMS_NEW_TETSUJIN_28_EPISODE_APPROVALS,
  TMS_WE_RENT_TSUKUMOGAMI_APPROVAL_ROWS,
  TMS_WE_RENT_TSUKUMOGAMI_EPISODE_APPROVALS,
} from '../server/ingestion/youtubeOfficialSecondWaveApprovals.ts';
import { importSnapshot } from '../server/ingestion/snapshot.ts';
import {
  officialYouTubePublisherPolicyForChannel,
  REMOW_PUBLISHER,
  TMS_PUBLISHER,
} from '../shared/youtubeOfficialPublishers.ts';

const databases: SqliteDatabase[] = [];

function exactCatalogueDatabase(): SqliteDatabase {
  const db = openDatabase(':memory:');
  databases.push(db);
  migrate(db);
  const byTitle = new Map<string, OfficialYouTubeEpisodeApproval[]>();
  for (const approval of SECOND_WAVE_OFFICIAL_YOUTUBE_EPISODE_APPROVALS) {
    const key = `${approval.catalogue.titleSourceId}:${approval.catalogue.titleSlug}`;
    const approvals = byTitle.get(key) ?? [];
    approvals.push(approval);
    byTitle.set(key, approvals);
  }
  importSnapshot(db, {
    schemaVersion: 1,
    source: 'anikoto',
    observedAt: '2026-09-15T19:00:00.000Z',
    titles: [...byTitle.values()].map((approvals) => {
      const first = approvals[0];
      return {
        sourceId: first.catalogue.titleSourceId,
        slug: first.catalogue.titleSlug,
        canonicalUrl: `https://anikototv.to/watch/${first.catalogue.titleSlug}`,
        name: first.catalogue.titleSlug,
        episodes: approvals.map((approval) => ({
          sourceId: approval.catalogue.episodeSourceId,
          number: approval.catalogue.episodeNumber,
          slug: `episode-${approval.catalogue.episodeNumber}`,
          canonicalUrl: `https://anikototv.to/watch/${approval.catalogue.titleSlug}/${approval.catalogue.episodeNumber}`,
          versions: [{
            sourceId: approval.catalogue.versionSourceId,
            language: approval.catalogue.language,
            providers: [],
          }],
        })),
      };
    }),
  });
  return db;
}

function representative<T>(rows: readonly T[]): T[] {
  return [rows[0], rows[Math.floor(rows.length / 2)], rows[rows.length - 1]];
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe('second-wave official YouTube approval registry', () => {
  it('contains only the 98 exact v3 sub proposals with their audited catalogue identities', () => {
    const series = [
      [TMS_NEW_TETSUJIN_28_APPROVAL_ROWS, TMS_NEW_TETSUJIN_28_EPISODE_APPROVALS, 26],
      [TMS_GOD_MAZINGER_APPROVAL_ROWS, TMS_GOD_MAZINGER_EPISODE_APPROVALS, 23],
      [TMS_ACTUALLY_I_AM_APPROVAL_ROWS, TMS_ACTUALLY_I_AM_EPISODE_APPROVALS, 13],
      [TMS_WE_RENT_TSUKUMOGAMI_APPROVAL_ROWS, TMS_WE_RENT_TSUKUMOGAMI_EPISODE_APPROVALS, 12],
      [TMS_BRAVE_10_APPROVAL_ROWS, TMS_BRAVE_10_EPISODE_APPROVALS, 12],
      [REMOW_BOOGIEPOP_PHANTOM_APPROVAL_ROWS, REMOW_BOOGIEPOP_PHANTOM_EPISODE_APPROVALS, 12],
    ] as const;
    expect(SECOND_WAVE_OFFICIAL_YOUTUBE_EPISODE_APPROVALS).toHaveLength(98);
    expect(SECOND_WAVE_OFFICIAL_YOUTUBE_CATALOGUE_IDENTITIES).toHaveLength(98);
    for (const [rows, approvals, expected] of series) {
      expect(rows).toHaveLength(expected);
      expect(approvals).toHaveLength(expected);
      expect(approvals.map((approval) => Number(approval.catalogue.episodeNumber)))
        .toEqual(Array.from({ length: expected }, (_, index) => index + 1));
      for (const [index, approval] of approvals.entries()) {
        const row = rows[index];
        expect(approval.catalogue).toMatchObject({
          source: 'anikoto',
          episodeSourceId: row[1],
          episodeNumber: row[0],
          versionSourceId: row[3],
          language: 'sub',
        });
        expect(SECOND_WAVE_OFFICIAL_YOUTUBE_CATALOGUE_IDENTITIES.find((identity) => identity.approvalId === approval.id))
          .toEqual({ approvalId: approval.id, expectedTitleId: expect.any(Number), expectedEpisodeId: row[2], expectedVersionId: row[4] });
        expect(approval.video).toMatchObject({ id: row[5], title: row[6] });
        expect(approval.observedAt).toBe(row[7]);
      }
    }
    expect(new Set(SECOND_WAVE_OFFICIAL_YOUTUBE_EPISODE_APPROVALS.map((approval) => approval.id))).toHaveLength(98);
    expect(new Set(SECOND_WAVE_OFFICIAL_YOUTUBE_EPISODE_APPROVALS.map((approval) => approval.video.id))).toHaveLength(98);
    expect(new Set(SECOND_WAVE_OFFICIAL_YOUTUBE_EPISODE_APPROVALS.map((approval) => `${approval.catalogue.titleSourceId}:${approval.catalogue.versionSourceId}`))).toHaveLength(98);
    expect(TMS_NEW_TETSUJIN_28_EPISODE_APPROVALS.at(-1)?.catalogue.episodeNumber).toBe('26');
    expect(SECOND_WAVE_OFFICIAL_YOUTUBE_EPISODE_APPROVALS.some((approval) => /sonic|devil lady|sherlock|cybersix|lost canvas|gutsy frog/i.test(`${approval.id} ${approval.video.title}`))).toBe(false);
  });

  it('uses only the existing exact TMS and REMOW publisher policies', async () => {
    expect(officialYouTubePublisherPolicyForChannel(TMS_PUBLISHER.channelId)?.publisher).toEqual(TMS_PUBLISHER);
    expect(officialYouTubePublisherPolicyForChannel(REMOW_PUBLISHER.channelId)?.publisher).toEqual(REMOW_PUBLISHER);
    const samples = [
      ...representative(TMS_NEW_TETSUJIN_28_EPISODE_APPROVALS),
      ...representative(TMS_GOD_MAZINGER_EPISODE_APPROVALS),
      ...representative(TMS_ACTUALLY_I_AM_EPISODE_APPROVALS),
      ...representative(TMS_WE_RENT_TSUKUMOGAMI_EPISODE_APPROVALS),
      ...representative(TMS_BRAVE_10_EPISODE_APPROVALS),
      ...representative(REMOW_BOOGIEPOP_PHANTOM_EPISODE_APPROVALS),
    ];
    for (const approval of samples) {
      const publisher = approval.video.channelId === TMS_PUBLISHER.channelId ? TMS_PUBLISHER : REMOW_PUBLISHER;
      const fetcher = vi.fn(async () => Response.json({
        type: 'video',
        provider_name: 'YouTube',
        title: approval.video.title,
        author_name: publisher.label,
        author_url: publisher.handleUrl,
        html: `<iframe src="https://www.youtube.com/embed/${approval.video.id}"></iframe>`,
      }));
      await expect(verifyOfficialYouTubeOEmbed(approval, fetcher)).resolves.toEqual({
        title: approval.video.title,
        author: publisher.label,
      });
    }
    const drifted = {
      ...TMS_NEW_TETSUJIN_28_EPISODE_APPROVALS[0],
      video: { ...TMS_NEW_TETSUJIN_28_EPISODE_APPROVALS[0].video, title: 'Different upload' },
    };
    await expect(verifyOfficialYouTubeOEmbed(drifted, async () => Response.json({
      type: 'video',
      provider_name: 'YouTube',
      title: TMS_NEW_TETSUJIN_28_EPISODE_APPROVALS[0].video.title,
      author_name: TMS_PUBLISHER.label,
      author_url: TMS_PUBLISHER.handleUrl,
      html: `<iframe src="https://www.youtube.com/embed/${drifted.video.id}"></iframe>`,
    }))).rejects.toThrow('YOUTUBE_PUBLISHER_OR_IDENTITY_MISMATCH');
  });

  it('locates and idempotently applies every exact row while all identity drifts fail closed', () => {
    const db = exactCatalogueDatabase();
    for (const approval of SECOND_WAVE_OFFICIAL_YOUTUBE_EPISODE_APPROVALS) {
      expect(locateOfficialYouTubeEpisode(db, approval)).toEqual({
        titleId: expect.any(Number),
        episodeId: expect.any(Number),
        versionId: expect.any(Number),
      });
      applyOfficialYouTubeApproval(db, approval, '2026-09-15T19:30:00.000Z');
      applyOfficialYouTubeApproval(db, approval, '2026-09-15T19:31:00.000Z');
      const drifted = {
        ...approval,
        catalogue: { ...approval.catalogue, versionSourceId: `${approval.catalogue.episodeSourceId}:dub` },
      };
      expect(() => applyOfficialYouTubeApproval(db, drifted, '2026-09-15T19:32:00.000Z'))
        .toThrow(`CATALOGUE_IDENTITY_NOT_FOUND:${approval.id}`);
    }
    expect(db.prepare("SELECT COUNT(*) AS count FROM episode_provider_mappings WHERE provider_id='youtube-official'").get()).toEqual({ count: 98 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM native_resources WHERE provider_id='youtube-official' AND enabled=1").get()).toEqual({ count: 98 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM verification_observations WHERE reason_code='OFFICIAL_YOUTUBE_REVIEWED'").get()).toEqual({ count: 98 });
  });
});
