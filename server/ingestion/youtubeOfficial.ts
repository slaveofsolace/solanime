import type { DatabaseSync } from 'node:sqlite';
import {
  OFFICIAL_YOUTUBE_EMBED_HOST,
  OFFICIAL_YOUTUBE_EMBED_BASIS,
  OFFICIAL_YOUTUBE_PROVIDER_ID,
  REMOW_PUBLISHER,
} from '../providers/youtubeOfficial.ts';

export interface OfficialYouTubeEpisodeApproval {
  id: string;
  catalogue: {
    source: 'anikoto';
    titleSourceId: string;
    titleSlug: string;
    episodeSourceId: string;
    episodeNumber: string;
    versionSourceId: string;
    language: string;
  };
  video: {
    id: string;
    title: string;
    watchUrl: string;
    channelId: string;
    channelUrl: string;
    handleUrl: string;
  };
  publisherIdentityUrl: string;
  titleIdentityUrl: string;
  episodeIdentityUrl: string;
  observedAt: string;
}

// Manually reviewed crosswalk. This is a publisher-hosted embed, not a copied
// media file and not a title-name fuzzy match.
export const REMOW_EPISODE_APPROVALS: readonly OfficialYouTubeEpisodeApproval[] = [
  {
    id: 'remow-b-project-passion-love-call-episode-1',
    catalogue: {
      source: 'anikoto',
      titleSourceId: '6771',
      titleSlug: 'b-project-netsuretsu-love-call-27sfl',
      episodeSourceId: '104039',
      episodeNumber: '1',
      versionSourceId: '104039:sub',
      language: 'sub',
    },
    video: {
      id: '_3Gcm-iGAQk',
      title: "Full Episode 01 | B-PROJECT Passion*Love Call | It's Anime [Multi-Subs]",
      watchUrl: 'https://www.youtube.com/watch?v=_3Gcm-iGAQk',
      channelId: REMOW_PUBLISHER.channelId,
      channelUrl: REMOW_PUBLISHER.channelUrl,
      handleUrl: REMOW_PUBLISHER.handleUrl,
    },
    publisherIdentityUrl: 'https://www.remow.com/en/service/',
    titleIdentityUrl: 'https://www.bpro-anime.com/',
    episodeIdentityUrl: 'https://www.bpro-anime.com/story/episode1/',
    observedAt: '2026-09-13T16:00:00.000Z',
  },
] as const;

type OEmbed = {
  type?: unknown;
  provider_name?: unknown;
  title?: unknown;
  author_name?: unknown;
  author_url?: unknown;
  html?: unknown;
};

function validateApproval(approval: OfficialYouTubeEpisodeApproval): void {
  if (
    approval.catalogue.source !== 'anikoto' ||
    approval.video.channelId !== REMOW_PUBLISHER.channelId ||
    approval.video.channelUrl !== REMOW_PUBLISHER.channelUrl ||
    approval.video.handleUrl !== REMOW_PUBLISHER.handleUrl ||
    approval.video.watchUrl !== `https://www.youtube.com/watch?v=${approval.video.id}` ||
    approval.publisherIdentityUrl !== 'https://www.remow.com/en/service/' ||
    !/^[A-Za-z0-9_-]{11}$/.test(approval.video.id) ||
    !Number.isFinite(Date.parse(approval.observedAt))
  )
    throw new Error('INVALID_OFFICIAL_YOUTUBE_APPROVAL');
}

async function boundedText(response: Response, maxBytes: number): Promise<string> {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxBytes) {
    await response.body?.cancel();
    throw new Error('YOUTUBE_OEMBED_TOO_LARGE');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('YOUTUBE_OEMBED_SCHEMA_CHANGED');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error('YOUTUBE_OEMBED_TOO_LARGE');
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function verifyOfficialYouTubeOEmbed(
  approval: OfficialYouTubeEpisodeApproval,
  fetcher: typeof fetch = fetch,
): Promise<{ title: string; author: string }> {
  validateApproval(approval);
  const endpoint = new URL('https://www.youtube.com/oembed');
  endpoint.searchParams.set('url', approval.video.watchUrl);
  endpoint.searchParams.set('format', 'json');
  const response = await fetcher(endpoint, {
    redirect: 'manual',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
    await response.body?.cancel();
    throw new Error(response.status === 404 ? 'YOUTUBE_VIDEO_UNAVAILABLE' : 'YOUTUBE_OEMBED_UNAVAILABLE');
  }
  const text = await boundedText(response, 64 * 1024);
  let value: OEmbed;
  try {
    value = JSON.parse(text) as OEmbed;
  } catch {
    throw new Error('YOUTUBE_OEMBED_SCHEMA_CHANGED');
  }
  if (
    value.type !== 'video' ||
    value.provider_name !== 'YouTube' ||
    value.title !== approval.video.title ||
    value.author_name !== REMOW_PUBLISHER.label ||
    value.author_url !== REMOW_PUBLISHER.handleUrl ||
    typeof value.html !== 'string' ||
    !value.html.includes(`/embed/${approval.video.id}`)
  )
    throw new Error('YOUTUBE_PUBLISHER_OR_IDENTITY_MISMATCH');
  return { title: value.title, author: value.author_name };
}

export function locateOfficialYouTubeEpisode(
  db: DatabaseSync,
  approval: OfficialYouTubeEpisodeApproval,
): { titleId: number; episodeId: number; versionId: number } {
  validateApproval(approval);
  const row = db.prepare(`SELECT t.id AS titleId,e.id AS episodeId,v.id AS versionId
    FROM titles t JOIN episodes e ON e.title_id=t.id JOIN episode_versions v ON v.episode_id=e.id
    WHERE t.source=? AND t.source_id=? AND t.slug=? AND e.source_id=? AND e.number_text=?
      AND v.source_id=? AND v.language=?`).get(
      approval.catalogue.source,
      approval.catalogue.titleSourceId,
      approval.catalogue.titleSlug,
      approval.catalogue.episodeSourceId,
      approval.catalogue.episodeNumber,
      approval.catalogue.versionSourceId,
      approval.catalogue.language,
    ) as { titleId: number; episodeId: number; versionId: number } | undefined;
  if (!row)
    throw new Error(`CATALOGUE_IDENTITY_NOT_FOUND:${approval.id}`);
  return row;
}

export function applyOfficialYouTubeApproval(
  db: DatabaseSync,
  approval: OfficialYouTubeEpisodeApproval,
  appliedAt = new Date().toISOString(),
): { titleId: number; episodeId: number; versionId: number; mappingId: number } {
  validateApproval(approval);
  if (!Number.isFinite(Date.parse(appliedAt))) throw new Error('INVALID_APPROVAL_TIME');
  const identity = locateOfficialYouTubeEpisode(db, approval);
  db.exec('BEGIN IMMEDIATE');
  try {
    const capabilities = JSON.stringify({
      embed: true,
      seek: true,
      volume: true,
      fullscreen: true,
      subtitles: true,
      qualitySelection: true,
      progressEvents: true,
    });
    db.prepare(`INSERT INTO providers(id,label,identity_state,playback_type,adapter_state,hostname,
      capabilities_json,observed_limitation,evidence_class,first_seen_at,last_seen_at,updated_at)
      VALUES(?,?,'confirmed','iframe','implemented',?,?,?,'direct_observation',?,?,?)
      ON CONFLICT(id) DO UPDATE SET label=excluded.label,identity_state=excluded.identity_state,
      playback_type=excluded.playback_type,adapter_state=excluded.adapter_state,
      hostname=excluded.hostname,capabilities_json=excluded.capabilities_json,
      observed_limitation=excluded.observed_limitation,last_seen_at=excluded.last_seen_at,
      updated_at=excluded.updated_at`).run(
        OFFICIAL_YOUTUBE_PROVIDER_ID,
        'YouTube · Official publisher',
        OFFICIAL_YOUTUBE_EMBED_HOST,
        capabilities,
        'Only manually reviewed full episodes on explicitly allowlisted publisher channels. Availability and region rules remain controlled by YouTube and the uploader.',
        approval.observedAt,
        approval.observedAt,
        appliedAt,
      );
    for (const alias of ['YouTube', REMOW_PUBLISHER.label, 'REMOW'])
      db.prepare("INSERT INTO provider_aliases(provider_id,alias,alias_type) VALUES(?,?,'verified_publisher') ON CONFLICT(provider_id,alias) DO NOTHING")
        .run(OFFICIAL_YOUTUBE_PROVIDER_ID, alias);
    for (const connection of [
      ['www.youtube.com', '/watch', 'official_watch_page'],
      ['www.youtube.com', '/oembed', 'public_identity_metadata'],
      ['www.youtube.com', '/iframe_api', 'official_player_api'],
      [OFFICIAL_YOUTUBE_EMBED_HOST, '/embed/', 'privacy_enhanced_player'],
      ['www.remow.com', '/en/service/', 'publisher_channel_evidence'],
    ] as const)
      db.prepare(`INSERT INTO provider_connections(provider_id,hostname,path_pattern,relationship,
        evidence_state,observation_scope,first_seen_at,last_seen_at)
        VALUES(?,?,?,?,'observed',?,?,?)
        ON CONFLICT(provider_id,hostname,path_pattern,relationship) DO UPDATE SET
        observation_scope=excluded.observation_scope,last_seen_at=excluded.last_seen_at`).run(
          OFFICIAL_YOUTUBE_PROVIDER_ID,
          connection[0],
          connection[1],
          connection[2],
          `${approval.video.title}; publisher ${REMOW_PUBLISHER.channelId}; standard YouTube embed only.`,
          approval.observedAt,
          approval.observedAt,
        );
    db.prepare(`INSERT INTO episode_provider_mappings(version_id,provider_id,source_mapping_id,
      provider_resource_id,mapping_origin,public_export_allowed,availability_state,first_seen_at,
      last_seen_at,last_successful_import_at,updated_at)
      VALUES(?,?,?,?,'external_mapper',1,'available',?,?,?,?)
      ON CONFLICT(version_id,provider_id,source_mapping_id) DO UPDATE SET
      provider_resource_id=excluded.provider_resource_id,availability_state='available',
      last_seen_at=excluded.last_seen_at,last_successful_import_at=excluded.last_successful_import_at,
      updated_at=excluded.updated_at`).run(
        identity.versionId,
        OFFICIAL_YOUTUBE_PROVIDER_ID,
        `youtube:${approval.video.id}`,
        approval.video.id,
        approval.observedAt,
        approval.observedAt,
        appliedAt,
        appliedAt,
      );
    const mapping = db.prepare(`SELECT id FROM episode_provider_mappings
      WHERE version_id=? AND provider_id=? AND source_mapping_id=?`).get(
        identity.versionId,
        OFFICIAL_YOUTUBE_PROVIDER_ID,
        `youtube:${approval.video.id}`,
      ) as { id: number };
    db.prepare(`INSERT INTO native_resources(mapping_id,provider_id,resource_id,language,edition,
      license,rights_evidence_url,identity_evidence_url,approved_at,enabled)
      VALUES(?,?,?,?,?,?,?,?,?,1)
      ON CONFLICT(mapping_id) DO UPDATE SET edition=excluded.edition,license=excluded.license,
      rights_evidence_url=excluded.rights_evidence_url,
      identity_evidence_url=excluded.identity_evidence_url,approved_at=excluded.approved_at,enabled=1
      WHERE native_resources.provider_id=excluded.provider_id
        AND native_resources.resource_id=excluded.resource_id
        AND native_resources.language=excluded.language`).run(
          mapping.id,
          OFFICIAL_YOUTUBE_PROVIDER_ID,
          approval.video.id,
          approval.catalogue.language,
          approval.video.title,
          OFFICIAL_YOUTUBE_EMBED_BASIS,
          approval.video.watchUrl,
          REMOW_PUBLISHER.channelUrl,
          appliedAt,
        );
    const approved = db.prepare(`SELECT provider_id,resource_id,language,license,
      rights_evidence_url,identity_evidence_url,enabled FROM native_resources WHERE mapping_id=?`)
      .get(mapping.id) as {
        provider_id: string;
        resource_id: string;
        language: string;
        license: string;
        rights_evidence_url: string;
        identity_evidence_url: string;
        enabled: number;
      } | undefined;
    if (
      !approved ||
      approved.provider_id !== OFFICIAL_YOUTUBE_PROVIDER_ID ||
      approved.resource_id !== approval.video.id ||
      approved.language !== approval.catalogue.language ||
      approved.license !== OFFICIAL_YOUTUBE_EMBED_BASIS ||
      approved.rights_evidence_url !== approval.video.watchUrl ||
      approved.identity_evidence_url !== REMOW_PUBLISHER.channelUrl ||
      approved.enabled !== 1
    )
      throw new Error('OFFICIAL_YOUTUBE_RESOURCE_IDENTITY_CONFLICT');
    const details = JSON.stringify({
      approvalId: approval.id,
      titleId: identity.titleId,
      episodeId: identity.episodeId,
      versionId: identity.versionId,
      mappingId: mapping.id,
      videoId: approval.video.id,
      channelId: approval.video.channelId,
      matching: 'manual_reviewed_crosswalk',
      publisherIdentityUrl: approval.publisherIdentityUrl,
      titleIdentityUrl: approval.titleIdentityUrl,
      episodeIdentityUrl: approval.episodeIdentityUrl,
      playbackVerified: false,
    });
    if (!db.prepare("SELECT 1 FROM verification_observations WHERE entity_type='mapping' AND entity_id=? AND reason_code='OFFICIAL_YOUTUBE_REVIEWED'").get(String(mapping.id)))
      db.prepare(`INSERT INTO verification_observations(entity_type,entity_id,stage,result,
        reason_code,evidence_class,details_json,observed_at)
        VALUES('mapping',?,'adapter_implemented','approved','OFFICIAL_YOUTUBE_REVIEWED',
        'direct_observation',?,?)`).run(String(mapping.id), details, appliedAt);
    db.exec('COMMIT');
    return { ...identity, mappingId: mapping.id };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
