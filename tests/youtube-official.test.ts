import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.ts';
import { migrate, openDatabase, type SqliteDatabase } from '../server/db.ts';
import {
  applyOfficialYouTubeApproval,
  locateOfficialYouTubeEpisode,
  REMOW_EPISODE_APPROVALS,
  verifyOfficialYouTubeOEmbed,
} from '../server/ingestion/youtubeOfficial.ts';
import { importSnapshot } from '../server/ingestion/snapshot.ts';
import { getMapping } from '../server/catalogue.ts';
import {
  OFFICIAL_YOUTUBE_EMBED_BASIS,
  OFFICIAL_YOUTUBE_EMBED_HOST,
  REMOW_PUBLISHER,
  resolveOfficialYouTube,
  sanitizeOfficialYouTubeResolution,
} from '../server/providers/youtubeOfficial.ts';
import type { ApprovedNativeResource } from '../server/providers/native.ts';
import type { PlaybackResolution } from '../src/types.ts';
import {
  isOfficialYouTubeResolution,
  officialYouTubeEmbedUrl,
  officialYouTubeError,
} from '../src/lib/youtubeOfficialPolicy.ts';

const databases: SqliteDatabase[] = [];
const servers: Array<{ close: () => Promise<void> }> = [];
const approval = REMOW_EPISODE_APPROVALS[0];

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
      name: 'B-Project: Netsuretsu*Love Call',
      episodes: [{
        sourceId: approval.catalogue.episodeSourceId,
        number: approval.catalogue.episodeNumber,
        slug: '1',
        canonicalUrl: `https://anikototv.to/watch/${approval.catalogue.titleSlug}/1`,
        versions: [{
          sourceId: approval.catalogue.versionSourceId,
          language: approval.catalogue.language,
          providers: [],
        }],
      }],
    }],
  });
  return db;
}

function oEmbed(value: Record<string, unknown> = {}): Response {
  return Response.json({
    type: 'video',
    provider_name: 'YouTube',
    title: approval.video.title,
    author_name: REMOW_PUBLISHER.label,
    author_url: REMOW_PUBLISHER.handleUrl,
    html: `<iframe src="https://www.youtube.com/embed/${approval.video.id}"></iframe>`,
    ...value,
  });
}

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const db of databases.splice(0)) db.close();
});

describe('official YouTube approval and resolution', () => {
  it('crosswalks only the exact catalogue title, episode and version identifiers', () => {
    const db = database();
    expect(locateOfficialYouTubeEpisode(db, approval)).toMatchObject({
      titleId: expect.any(Number),
      episodeId: expect.any(Number),
      versionId: expect.any(Number),
    });
    expect(() => locateOfficialYouTubeEpisode(db, {
      ...approval,
      catalogue: { ...approval.catalogue, episodeSourceId: 'similar-title-episode' },
    })).toThrow('CATALOGUE_IDENTITY_NOT_FOUND');
    expect(() => locateOfficialYouTubeEpisode(db, {
      ...approval,
      video: { ...approval.video, channelId: 'UC0000000000000000000000' },
    })).toThrow('INVALID_OFFICIAL_YOUTUBE_APPROVAL');
  });

  it('uses bounded public oEmbed only as an exact identity check', async () => {
    const requests: string[] = [];
    const fetcher = async (input: string | URL | Request) => {
      requests.push(String(input));
      return oEmbed();
    };
    await expect(verifyOfficialYouTubeOEmbed(approval, fetcher)).resolves.toEqual({
      title: approval.video.title,
      author: REMOW_PUBLISHER.label,
    });
    expect(requests[0]).toContain(encodeURIComponent(approval.video.watchUrl));
    await expect(verifyOfficialYouTubeOEmbed(approval, async () => oEmbed({
      author_name: 'Unrelated uploader',
    }))).rejects.toThrow('YOUTUBE_PUBLISHER_OR_IDENTITY_MISMATCH');
    await expect(verifyOfficialYouTubeOEmbed(approval, async () => new Response(
      new Uint8Array(65 * 1024),
      { headers: { 'content-type': 'application/json', 'content-length': String(65 * 1024) } },
    ))).rejects.toThrow('YOUTUBE_OEMBED_TOO_LARGE');
  });

  it('applies one idempotent allowlisted mapping and fails closed on an identity conflict', () => {
    const db = database();
    const first = applyOfficialYouTubeApproval(db, approval, '2026-09-13T17:00:00.000Z');
    const second = applyOfficialYouTubeApproval(db, approval, '2026-09-13T17:01:00.000Z');
    expect(second.mappingId).toBe(first.mappingId);
    expect(db.prepare("SELECT COUNT(*) AS count FROM episode_provider_mappings WHERE provider_id='youtube-official'").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM native_resources WHERE provider_id='youtube-official'").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM verification_observations WHERE reason_code='OFFICIAL_YOUTUBE_REVIEWED'").get()).toEqual({ count: 1 });

    const mapping = getMapping(db, first.mappingId);
    const resource = db.prepare('SELECT * FROM native_resources WHERE mapping_id=?').get(first.mappingId) as ApprovedNativeResource;
    const resolved = resolveOfficialYouTube(mapping, resource);
    expect(resolved).toMatchObject({
      kind: 'official-youtube',
      providerId: 'youtube-official',
      videoId: approval.video.id,
      allowedEmbedHosts: [OFFICIAL_YOUTUBE_EMBED_HOST],
      publisher: REMOW_PUBLISHER,
      attribution: { license: OFFICIAL_YOUTUBE_EMBED_BASIS },
    });
    expect(resolved).not.toHaveProperty('url');
    expect(resolved).not.toHaveProperty('embedUrl');

    const accepted = sanitizeOfficialYouTubeResolution(mapping, {
      mappingId: mapping.mappingId,
      providerId: mapping.providerId,
      kind: 'official-youtube',
      playbackType: 'iframe',
      delivery: 'provider',
      status: 'resolved',
      videoId: approval.video.id,
      allowedEmbedHosts: [OFFICIAL_YOUTUBE_EMBED_HOST],
      publisher: REMOW_PUBLISHER,
    });
    expect(accepted.status).toBe('resolved');
    expect(accepted.attribution).toEqual({
      label: `${REMOW_PUBLISHER.label} · YouTube`,
      url: approval.video.watchUrl,
      license: OFFICIAL_YOUTUBE_EMBED_BASIS,
    });
    expect(sanitizeOfficialYouTubeResolution(mapping, {
      ...accepted,
      allowedEmbedHosts: ['youtube.example.invalid'],
    })).toMatchObject({
      kind: 'unsupported',
      status: 'unsupported',
      error: { code: 'OFFICIAL_EMBED_POLICY_REJECTED' },
    });

    db.prepare("UPDATE native_resources SET resource_id='different00' WHERE mapping_id=?").run(first.mappingId);
    expect(() => applyOfficialYouTubeApproval(db, approval)).toThrow(
      'OFFICIAL_YOUTUBE_RESOURCE_IDENTITY_CONFLICT',
    );
  });

  it('constructs only the privacy-enhanced embed and maps explicit YouTube errors', () => {
    const resolution: PlaybackResolution = {
      kind: 'official-youtube',
      mappingId: '55',
      providerId: 'youtube-official',
      language: 'sub',
      playbackType: 'iframe',
      status: 'resolved',
      delivery: 'provider',
      videoId: approval.video.id,
      allowedEmbedHosts: [OFFICIAL_YOUTUBE_EMBED_HOST],
      publisher: REMOW_PUBLISHER,
    };
    expect(isOfficialYouTubeResolution(resolution)).toBe(true);
    const embed = new URL(officialYouTubeEmbedUrl(resolution, 'https://solanime.pages.dev')!);
    expect(embed.origin).toBe('https://www.youtube-nocookie.com');
    expect(embed.pathname).toBe(`/embed/${approval.video.id}`);
    expect(embed.searchParams.get('origin')).toBe('https://solanime.pages.dev');
    expect(embed.searchParams.get('enablejsapi')).toBe('1');
    expect(officialYouTubeEmbedUrl({ ...resolution, videoId: '../redirect' }, 'https://solanime.pages.dev')).toBeNull();
    expect(officialYouTubeEmbedUrl({
      ...resolution,
      publisher: { ...resolution.publisher!, label: 'Spoofed publisher' },
    }, 'https://solanime.pages.dev')).toBeNull();
    expect(officialYouTubeEmbedUrl(resolution, 'data:text/html,unsafe')).toBeNull();
    expect(officialYouTubeError(150).code).toBe('YOUTUBE_EMBED_DISABLED');
    expect(officialYouTubeError(153).code).toBe('YOUTUBE_REFERRER_REJECTED');
  });

  it('advertises and resolves the approved mapping through the real local API contract', async () => {
    const db = database();
    const applied = applyOfficialYouTubeApproval(db, approval);
    const identity = locateOfficialYouTubeEpisode(db, approval);
    const server = createApp(db);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    servers.push({ close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) });

    const list = await fetch(`${origin}/api/episodes/${identity.episodeId}/providers?language=sub`)
      .then((response) => response.json<{ providers: Array<Record<string, unknown>> }>());
    expect(list.providers).toEqual([expect.objectContaining({
      mappingId: String(applied.mappingId),
      providerId: 'youtube-official',
      kind: 'official-youtube',
      playbackType: 'iframe',
      supported: true,
      status: 'available',
    })]);

    const response = await fetch(`${origin}/api/providers/${applied.mappingId}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ language: 'sub' }),
    });
    expect(response.status).toBe(200);
    const resolved = await response.json<Record<string, unknown>>();
    expect(resolved).toMatchObject({
      kind: 'official-youtube',
      mappingId: String(applied.mappingId),
      providerId: 'youtube-official',
      playbackType: 'iframe',
      delivery: 'provider',
      status: 'resolved',
      videoId: approval.video.id,
      allowedEmbedHosts: [OFFICIAL_YOUTUBE_EMBED_HOST],
      publisher: REMOW_PUBLISHER,
    });
    expect(resolved).not.toHaveProperty('url');
    expect(resolved).not.toHaveProperty('embedUrl');
  });
});
