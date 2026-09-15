import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrate, openDatabase, type SqliteDatabase } from '../server/db.ts';
import {
  applyOfficialYouTubeApproval,
  locateOfficialYouTubeEpisode,
  verifyOfficialYouTubeOEmbed,
  type OfficialYouTubeEpisodeApproval,
} from '../server/ingestion/youtubeOfficial.ts';
import {
  BEYBLADE_BURST_EVOLUTION_OFFICIAL_APPROVAL_ROWS,
  BEYBLADE_BURST_EVOLUTION_OFFICIAL_EPISODE_APPROVALS,
  BEYBLADE_BURST_OFFICIAL_APPROVAL_ROWS,
  BEYBLADE_BURST_OFFICIAL_EPISODE_APPROVALS,
  BEYBLADE_BURST_TURBO_OFFICIAL_APPROVAL_ROWS,
  BEYBLADE_BURST_TURBO_OFFICIAL_EPISODE_APPROVALS,
  BEYBLADE_ENGLISH_OFFICIAL_PUBLISHER,
  BEYBLADE_METAL_FUSION_OFFICIAL_APPROVAL_ROWS,
  BEYBLADE_METAL_FUSION_OFFICIAL_EPISODE_APPROVALS,
  BEYBLADE_METAL_MASTERS_OFFICIAL_APPROVAL_ROWS,
  BEYBLADE_METAL_MASTERS_OFFICIAL_EPISODE_APPROVALS,
  BEYBLADE_OFFICIAL_YOUTUBE_CATALOGUE_IDENTITIES,
  BEYBLADE_OFFICIAL_YOUTUBE_EPISODE_APPROVALS,
  BEYBLADE_X_OFFICIAL_APPROVAL_ROWS,
  BEYBLADE_X_OFFICIAL_EPISODE_APPROVALS,
} from '../server/ingestion/youtubeOfficialBeybladeApprovals.ts';

const databases: SqliteDatabase[] = [];
const observedAt = '2026-09-15T19:30:00.000Z';

function exactCatalogueDatabase(): SqliteDatabase {
  const db = openDatabase(':memory:');
  databases.push(db);
  migrate(db);
  const insertedTitles = new Set<number>();
  for (const approval of BEYBLADE_OFFICIAL_YOUTUBE_EPISODE_APPROVALS) {
    const identity = BEYBLADE_OFFICIAL_YOUTUBE_CATALOGUE_IDENTITIES.find(
      (candidate) => candidate.approvalId === approval.id,
    );
    if (!identity) throw new Error(`Missing identity for ${approval.id}`);
    if (!insertedTitles.has(identity.expectedTitleId)) {
      db.prepare(`INSERT INTO titles(id,source,source_id,slug,canonical_url,name,
        availability_state,first_seen_at,last_seen_at,last_successful_import_at,created_at,updated_at)
        VALUES(?,?,?,?,?,?, 'available',?,?,?,?,?)`).run(
          identity.expectedTitleId,
          approval.catalogue.source,
          approval.catalogue.titleSourceId,
          approval.catalogue.titleSlug,
          `https://anikototv.to/watch/${approval.catalogue.titleSlug}`,
          approval.catalogue.titleSlug,
          observedAt,
          observedAt,
          observedAt,
          observedAt,
          observedAt,
        );
      insertedTitles.add(identity.expectedTitleId);
    }
    db.prepare(`INSERT INTO episodes(id,title_id,source_id,number_text,number_sort,label,slug,
      canonical_url,episode_type,availability_state,first_seen_at,last_seen_at,
      last_successful_import_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,'regular','available',?,?,?,?,?)`).run(
        identity.expectedEpisodeId,
        identity.expectedTitleId,
        approval.catalogue.episodeSourceId,
        approval.catalogue.episodeNumber,
        Number(approval.catalogue.episodeNumber),
        `Episode ${approval.catalogue.episodeNumber}`,
        `episode-${approval.catalogue.episodeNumber}`,
        `https://anikototv.to/watch/${approval.catalogue.titleSlug}/${approval.catalogue.episodeNumber}`,
        observedAt,
        observedAt,
        observedAt,
        observedAt,
        observedAt,
      );
    db.prepare(`INSERT INTO episode_versions(id,episode_id,source_id,language,version_label,
      audio_language,availability_state,first_seen_at,last_seen_at,last_successful_import_at)
      VALUES(?,?,?,'dub','English dub','English','available',?,?,?)`).run(
        identity.expectedVersionId,
        identity.expectedEpisodeId,
        approval.catalogue.versionSourceId,
        observedAt,
        observedAt,
        observedAt,
      );
  }
  return db;
}

function representative<T>(rows: readonly T[]): T[] {
  return [rows[0], rows[Math.floor(rows.length / 2)], rows[rows.length - 1]];
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) db.close();
});

describe('BEYBLADE official YouTube approval registry', () => {
  it('contains only the 252 exact English-dub episode mappings from the strict review', () => {
    const series = [
      [BEYBLADE_X_OFFICIAL_APPROVAL_ROWS, BEYBLADE_X_OFFICIAL_EPISODE_APPROVALS, 95],
      [BEYBLADE_BURST_TURBO_OFFICIAL_APPROVAL_ROWS, BEYBLADE_BURST_TURBO_OFFICIAL_EPISODE_APPROVALS, 49],
      [BEYBLADE_BURST_OFFICIAL_APPROVAL_ROWS, BEYBLADE_BURST_OFFICIAL_EPISODE_APPROVALS, 5],
      [BEYBLADE_METAL_FUSION_OFFICIAL_APPROVAL_ROWS, BEYBLADE_METAL_FUSION_OFFICIAL_EPISODE_APPROVALS, 28],
      [BEYBLADE_METAL_MASTERS_OFFICIAL_APPROVAL_ROWS, BEYBLADE_METAL_MASTERS_OFFICIAL_EPISODE_APPROVALS, 25],
      [BEYBLADE_BURST_EVOLUTION_OFFICIAL_APPROVAL_ROWS, BEYBLADE_BURST_EVOLUTION_OFFICIAL_EPISODE_APPROVALS, 50],
    ] as const;

    expect(BEYBLADE_OFFICIAL_YOUTUBE_EPISODE_APPROVALS).toHaveLength(252);
    expect(BEYBLADE_OFFICIAL_YOUTUBE_CATALOGUE_IDENTITIES).toHaveLength(252);
    for (const [rows, approvals, expectedCount] of series) {
      expect(rows).toHaveLength(expectedCount);
      expect(approvals).toHaveLength(expectedCount);
      for (const [index, approval] of approvals.entries()) {
        const row = rows[index];
        expect(approval.catalogue).toMatchObject({
          source: 'anikoto',
          episodeNumber: row[0],
          episodeSourceId: row[1],
          versionSourceId: row[3],
          language: 'dub',
        });
        expect(BEYBLADE_OFFICIAL_YOUTUBE_CATALOGUE_IDENTITIES.find(
          (identity) => identity.approvalId === approval.id,
        )).toEqual({
          approvalId: approval.id,
          expectedTitleId: expect.any(Number),
          expectedEpisodeId: row[2],
          expectedVersionId: row[4],
        });
        expect(approval.video).toMatchObject({
          id: row[5],
          title: row[6],
          channelId: BEYBLADE_ENGLISH_OFFICIAL_PUBLISHER.channelId,
        });
        expect(approval.observedAt).toBe(row[7]);
      }
    }
    expect(new Set(BEYBLADE_OFFICIAL_YOUTUBE_EPISODE_APPROVALS.map((row) => row.id))).toHaveLength(252);
    expect(new Set(BEYBLADE_OFFICIAL_YOUTUBE_EPISODE_APPROVALS.map((row) => row.video.id))).toHaveLength(252);
    expect(new Set(BEYBLADE_OFFICIAL_YOUTUBE_EPISODE_APPROVALS.map(
      (row) => `${row.catalogue.titleSourceId}:${row.catalogue.versionSourceId}`,
    ))).toHaveLength(252);
    expect(BEYBLADE_OFFICIAL_YOUTUBE_EPISODE_APPROVALS.some((row) =>
      /beyblade-official-(?:burst-(?:quaddrive|quadstrike|surge|rise)|v-force|g-revolution|metal-fury|shogun-steel)-/i
        .test(row.id),
    )).toBe(false);
  });

  it('matches every stable catalogue identity and its immutable numeric audit identity', () => {
    const db = exactCatalogueDatabase();
    for (const approval of BEYBLADE_OFFICIAL_YOUTUBE_EPISODE_APPROVALS) {
      const expected = BEYBLADE_OFFICIAL_YOUTUBE_CATALOGUE_IDENTITIES.find(
        (identity) => identity.approvalId === approval.id,
      );
      expect(expected).toBeDefined();
      expect(locateOfficialYouTubeEpisode(db, approval)).toEqual({
        titleId: expected?.expectedTitleId,
        episodeId: expected?.expectedEpisodeId,
        versionId: expected?.expectedVersionId,
      });
    }
  });

  it('idempotently applies exact rows and rejects catalogue identity drift', () => {
    const db = exactCatalogueDatabase();
    for (const approval of BEYBLADE_OFFICIAL_YOUTUBE_EPISODE_APPROVALS) {
      applyOfficialYouTubeApproval(db, approval, '2026-09-15T20:00:00.000Z');
      applyOfficialYouTubeApproval(db, approval, '2026-09-15T20:01:00.000Z');
    }
    expect(db.prepare("SELECT COUNT(*) AS count FROM episode_provider_mappings WHERE provider_id='youtube-official'").get())
      .toEqual({ count: 252 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM native_resources WHERE provider_id='youtube-official' AND enabled=1").get())
      .toEqual({ count: 252 });

    const exact = BEYBLADE_X_OFFICIAL_EPISODE_APPROVALS[0];
    const drifts: OfficialYouTubeEpisodeApproval[] = [
      { ...exact, catalogue: { ...exact.catalogue, titleSourceId: 'wrong-title' } },
      { ...exact, catalogue: { ...exact.catalogue, titleSlug: `${exact.catalogue.titleSlug}-drift` } },
      { ...exact, catalogue: { ...exact.catalogue, episodeSourceId: 'wrong-episode' } },
      { ...exact, catalogue: { ...exact.catalogue, episodeNumber: '999' } },
      { ...exact, catalogue: { ...exact.catalogue, versionSourceId: `${exact.catalogue.episodeSourceId}:sub` } },
      { ...exact, catalogue: { ...exact.catalogue, language: 'sub' } },
    ];
    for (const drifted of drifts) {
      expect(() => applyOfficialYouTubeApproval(db, drifted, '2026-09-15T20:02:00.000Z'))
        .toThrow(`CATALOGUE_IDENTITY_NOT_FOUND:${exact.id}`);
    }
  });

  it('accepts exact official oEmbed identity and rejects video or publisher drift', async () => {
    const samples = [
      ...representative(BEYBLADE_X_OFFICIAL_EPISODE_APPROVALS),
      ...representative(BEYBLADE_BURST_TURBO_OFFICIAL_EPISODE_APPROVALS),
      ...representative(BEYBLADE_BURST_OFFICIAL_EPISODE_APPROVALS),
      ...representative(BEYBLADE_METAL_FUSION_OFFICIAL_EPISODE_APPROVALS),
      ...representative(BEYBLADE_METAL_MASTERS_OFFICIAL_EPISODE_APPROVALS),
      ...representative(BEYBLADE_BURST_EVOLUTION_OFFICIAL_EPISODE_APPROVALS),
    ];
    for (const approval of samples) {
      const fetcher = vi.fn(async () => Response.json({
        type: 'video',
        provider_name: 'YouTube',
        title: approval.video.title,
        author_name: BEYBLADE_ENGLISH_OFFICIAL_PUBLISHER.label,
        author_url: BEYBLADE_ENGLISH_OFFICIAL_PUBLISHER.handleUrl,
        html: `<iframe src="https://www.youtube.com/embed/${approval.video.id}"></iframe>`,
      }));
      await expect(verifyOfficialYouTubeOEmbed(approval, fetcher)).resolves.toEqual({
        title: approval.video.title,
        author: BEYBLADE_ENGLISH_OFFICIAL_PUBLISHER.label,
      });
    }

    const approval = BEYBLADE_X_OFFICIAL_EPISODE_APPROVALS[0];
    await expect(verifyOfficialYouTubeOEmbed(approval, async () => Response.json({
      type: 'video',
      provider_name: 'YouTube',
      title: `${approval.video.title} drift`,
      author_name: BEYBLADE_ENGLISH_OFFICIAL_PUBLISHER.label,
      author_url: BEYBLADE_ENGLISH_OFFICIAL_PUBLISHER.handleUrl,
      html: `<iframe src="https://www.youtube.com/embed/${approval.video.id}"></iframe>`,
    }))).rejects.toThrow('YOUTUBE_PUBLISHER_OR_IDENTITY_MISMATCH');
    await expect(verifyOfficialYouTubeOEmbed(approval, async () => Response.json({
      type: 'video',
      provider_name: 'YouTube',
      title: approval.video.title,
      author_name: 'Different uploader',
      author_url: 'https://www.youtube.com/@DifferentUploader',
      html: `<iframe src="https://www.youtube.com/embed/${approval.video.id}"></iframe>`,
    }))).rejects.toThrow('YOUTUBE_PUBLISHER_OR_IDENTITY_MISMATCH');
  });
});
