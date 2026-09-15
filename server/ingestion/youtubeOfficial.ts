import type { DatabaseSync } from 'node:sqlite';
import {
  OFFICIAL_YOUTUBE_EMBED_HOST,
  OFFICIAL_YOUTUBE_EMBED_BASIS,
  OFFICIAL_YOUTUBE_PROVIDER_ID,
} from '../providers/youtubeOfficial.ts';
import {
  GUNDAM_INFO_PUBLISHER,
  NOZOMI_PUBLISHER,
  NOZOMI_PUBLISHER_IDENTITY_URL,
  officialYouTubePublisherPolicyForChannel,
  REMOW_PUBLISHER,
} from '../../shared/youtubeOfficialPublishers.ts';
import { EXPANDED_OFFICIAL_YOUTUBE_EPISODE_APPROVALS } from './youtubeOfficialExpandedApprovals.ts';
import { SECOND_WAVE_OFFICIAL_YOUTUBE_EPISODE_APPROVALS } from './youtubeOfficialSecondWaveApprovals.ts';
import { BEYBLADE_OFFICIAL_YOUTUBE_EPISODE_APPROVALS } from './youtubeOfficialBeybladeApprovals.ts';
import { NOZOMI_OFFICIAL_YOUTUBE_APPROVAL_CANDIDATES } from './youtubeOfficialNozomiApprovalRegistry.ts';

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

export const GUNDAM_INFO_EPISODE_APPROVALS: readonly OfficialYouTubeEpisodeApproval[] = [
  {
    id: 'gundam-info-reconguista-in-g-episode-1',
    catalogue: {
      source: 'anikoto',
      titleSourceId: '5301',
      titleSlug: 'gundam-reconguista-in-g-lcjdy',
      episodeSourceId: '82950',
      episodeNumber: '1',
      versionSourceId: '82950:sub',
      language: 'sub',
    },
    video: {
      id: 'TEp52IJvERA',
      title: 'Gundam Reconguista in G - Episode 1（EN,KR sub）',
      watchUrl: 'https://www.youtube.com/watch?v=TEp52IJvERA',
      channelId: GUNDAM_INFO_PUBLISHER.channelId,
      channelUrl: GUNDAM_INFO_PUBLISHER.channelUrl,
      handleUrl: GUNDAM_INFO_PUBLISHER.handleUrl,
    },
    publisherIdentityUrl: 'https://en.gundam-official.com/feature/gwoy/',
    titleIdentityUrl: 'https://en.gundam-official.com/feature/gwoy/',
    episodeIdentityUrl: 'https://en.gundam-official.com/feature/gwoy/',
    observedAt: '2026-09-13T23:22:06.629Z',
  },
] as const;

type AfterWarGundamXApprovalRow = readonly [
  episodeNumber: number,
  episodeSourceId: string,
  expectedEpisodeId: number,
  expectedVersionId: number,
  videoId: string,
  videoTitle: string,
  observedAt: string,
];

// Explicit manual crosswalk backed by Gundam's series-specific announcement
// and the immutable discovery review. The expected local IDs are review
// evidence; imports resolve the stable source IDs below and never fuzzy-match.
export const AFTER_WAR_GUNDAM_X_APPROVAL_ROWS: readonly AfterWarGundamXApprovalRow[] = [
  [1, '37531', 101860, 132527, 'TTnmp3_vAX4', 'After War Gundam X -Episode1(w/subtitles)', '2026-09-13T23:23:31.932Z'],
  [2, '37532', 101861, 132528, '-2DCBO0424I', 'After War Gundam X -Episode2(w/subtitles)', '2026-09-13T23:24:15.253Z'],
  [3, '37533', 101862, 132529, 'WyxgPlkK9LA', 'After War Gundam X -Episode3(w/subtitles)', '2026-09-13T23:23:29.289Z'],
  [4, '37534', 101863, 132530, 'qBfIql0lXRk', 'After War Gundam X -Episode4(w/subtitles)', '2026-09-13T23:24:13.954Z'],
  [5, '37535', 101864, 132531, 'utJc7KPvkl8', 'After War Gundam X -Episode5(w/subtitles)', '2026-09-13T23:21:38.522Z'],
  [6, '37536', 101865, 132532, '-ELJK0pqw5c', 'After War Gundam X -Episode6(w/subtitles)', '2026-09-13T23:24:01.743Z'],
  [7, '37537', 101866, 132533, '9QAeit4wA9Y', 'After War Gundam X -Episode7(w/subtitles)', '2026-09-13T23:22:02.503Z'],
  [8, '37538', 101867, 132534, 'JB3kL-KWhb8', 'After War Gundam X -Episode8(w/subtitles)', '2026-09-13T23:21:59.889Z'],
  [9, '37539', 101868, 132535, 'ENCobxWAfRA', 'After War Gundam X -Episode9(w/subtitles)', '2026-09-13T23:23:02.396Z'],
  [10, '37540', 101869, 132536, 'CR8uyAkKqtE', 'After War Gundam X -Episode10(w/subtitles)', '2026-09-13T23:24:38.201Z'],
  [11, '37541', 101870, 132537, '1XPnS-EgI3U', 'After War Gundam X -Episode11(w/sbtitles)', '2026-09-13T23:23:04.116Z'],
  [12, '37542', 101871, 132538, '_f8F35GKwyo', 'After War Gundam X -Episode12(w/sbtitles)', '2026-09-13T23:23:08.149Z'],
  [13, '37543', 101872, 132539, 'kZlQ3H-aP9g', 'After War Gundam X -Episode13(w/sbtitles)', '2026-09-13T23:22:34.292Z'],
  [14, '37544', 101873, 132540, 'olkt0pPYJiw', 'After War Gundam X -Episode14(w/sbtitles)', '2026-09-13T23:23:55.073Z'],
  [15, '37545', 101874, 132541, '9zM6BJ7kwnM', 'After War Gundam X -Episode15(w/sbtitles)', '2026-09-13T23:21:49.429Z'],
  [16, '37546', 101875, 132542, 'qQiT-6O8B1k', 'After War Gundam X -Episode16(w/sbtitles)', '2026-09-13T23:22:49.157Z'],
  [17, '37547', 101876, 132543, 'X_k9vdJ_Bng', 'After War Gundam X -Episode17(w/sbtitles)', '2026-09-13T23:24:42.360Z'],
  [18, '37548', 101877, 132544, 'perWWOAF-Ew', 'After War Gundam X -Episode18(w/sbtitles)', '2026-09-13T23:23:52.216Z'],
  [19, '37549', 101878, 132545, '8VbVqmwoWV0', 'After War Gundam X -Episode19(w/subtitles)', '2026-09-13T23:24:17.944Z'],
  [20, '37550', 101879, 132546, 'M92RqwckLbU', 'After War Gundam X -Episode20(w/subtitles)', '2026-09-13T23:24:25.683Z'],
  [21, '37551', 101880, 132547, 'n49nNUylYW4', 'After War Gundam X -Episode21(w/subtitles)', '2026-09-13T23:23:34.866Z'],
  [22, '37552', 101881, 132548, 'ryeco6JIY-M', 'After War Gundam X -Episode22(w/subtitles)', '2026-09-13T23:22:41.016Z'],
  [23, '37553', 101882, 132549, 'c0sZZqaqYy8', 'After War Gundam X -Episode23(w/subtitles)', '2026-09-13T23:22:36.993Z'],
  [24, '37554', 101883, 132550, 'hhQ96RK4_N4', 'After War Gundam X -Episode24(w/subtitles)', '2026-09-13T23:22:47.678Z'],
  [25, '37555', 101884, 132551, 'jxxjKBMazv8', 'After War Gundam X -Episode25(w/subtitles)', '2026-09-13T23:23:28.260Z'],
  [26, '37556', 101885, 132552, 'xPl2ODd_NkA', 'After War Gundam X -Episode26(w/subtitles)', '2026-09-13T23:23:53.684Z'],
  [27, '37557', 101886, 132553, '-4goI5FernA', 'After War Gundam X -Episode27(w/subtitles)', '2026-09-13T23:22:43.835Z'],
  [28, '37558', 101887, 132554, 'gDoOI6vYm7Q', 'After War Gundam X -Episode28(w/subtitles)', '2026-09-13T23:22:27.603Z'],
  [29, '37559', 101888, 132555, 'aMGux7W4ICE', 'After War Gundam X -Episode29(w/subtitles)', '2026-09-13T23:24:11.078Z'],
  [30, '37560', 101889, 132556, 'TygCo0FngbI', 'After War Gundam X -Episode30(w/subtitles)', '2026-09-13T23:24:36.550Z'],
  [31, '37561', 101890, 132557, '7uuFqRrOCJE', 'After War Gundam X -Episode31(w/subtitles)', '2026-09-13T23:21:34.393Z'],
  [32, '37562', 101891, 132558, 'AX8xYmcPXgs', 'After War Gundam X -Episode32(w/subtitles)', '2026-09-13T23:22:39.815Z'],
  [33, '37563', 101892, 132559, 'y22GbguAGO4', 'After War Gundam X -Episode33(w/subtitles)', '2026-09-13T23:22:05.372Z'],
  [34, '37564', 101893, 132560, 'gFo4RIWlb6A', 'After War Gundam X -Episode34(w/subtitles)', '2026-09-13T23:23:49.823Z'],
  [35, '37565', 101894, 132561, 'TLTWimXMn5k', 'After War Gundam X -Episode35(w/subtitles)', '2026-09-13T23:22:14.225Z'],
  [36, '37566', 101895, 132562, 'mUup9p0Bkgc', 'After War Gundam X -Episode36(w/subtitles)', '2026-09-13T23:24:43.661Z'],
  [37, '37567', 101896, 132563, 'Vd5jRhOB3ec', 'After War Gundam X -Episode37(w/subtitles)', '2026-09-13T23:21:57.169Z'],
  [38, '37568', 101897, 132564, 'AQU7u6LmXys', 'After War Gundam X -Episode38(w/subtitles)', '2026-09-13T23:21:41.078Z'],
  [39, '37569', 101898, 132565, 'CBfwAD0uWN4', 'After War Gundam X -Episode39(w/subtitles)', '2026-09-13T23:24:09.688Z'],
] as const;

const AFTER_WAR_GUNDAM_X_DISTRIBUTION_URL =
  'https://en.gundam-official.com/gundam-x/news/mh8xey7310egn849s70ifaon/';

export const AFTER_WAR_GUNDAM_X_EPISODE_APPROVALS: readonly OfficialYouTubeEpisodeApproval[] =
  AFTER_WAR_GUNDAM_X_APPROVAL_ROWS.map(([
    episodeNumber,
    episodeSourceId,
    _expectedEpisodeId,
    _expectedVersionId,
    videoId,
    videoTitle,
    observedAt,
  ]) => ({
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
      title: videoTitle,
      watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
      channelId: GUNDAM_INFO_PUBLISHER.channelId,
      channelUrl: GUNDAM_INFO_PUBLISHER.channelUrl,
      handleUrl: GUNDAM_INFO_PUBLISHER.handleUrl,
    },
    publisherIdentityUrl: 'https://en.gundam-official.com/feature/gwoy/',
    titleIdentityUrl: AFTER_WAR_GUNDAM_X_DISTRIBUTION_URL,
    episodeIdentityUrl: AFTER_WAR_GUNDAM_X_DISTRIBUTION_URL,
    observedAt,
  }));

export const NOZOMI_OFFICIAL_YOUTUBE_EPISODE_APPROVALS: readonly OfficialYouTubeEpisodeApproval[] =
  NOZOMI_OFFICIAL_YOUTUBE_APPROVAL_CANDIDATES.map((candidate) => ({
    id: candidate.approvalId,
    catalogue: {
      source: 'anikoto',
      titleSourceId: candidate.catalogue.titleSourceId,
      titleSlug: candidate.catalogue.titleSlug,
      episodeSourceId: candidate.catalogue.episodeSourceId,
      episodeNumber: candidate.catalogue.episodeNumber,
      versionSourceId: candidate.catalogue.versionSourceId,
      language: candidate.catalogue.language,
    },
    video: {
      id: candidate.video.id,
      title: candidate.video.title,
      watchUrl: candidate.video.watchUrl,
      channelId: NOZOMI_PUBLISHER.channelId,
      channelUrl: NOZOMI_PUBLISHER.channelUrl,
      handleUrl: NOZOMI_PUBLISHER.handleUrl,
    },
    publisherIdentityUrl: NOZOMI_PUBLISHER_IDENTITY_URL,
    titleIdentityUrl: candidate.video.watchUrl,
    episodeIdentityUrl: candidate.video.watchUrl,
    observedAt: candidate.evidence.oEmbedCheckedAt,
  }));

export const OFFICIAL_YOUTUBE_EPISODE_APPROVALS: readonly OfficialYouTubeEpisodeApproval[] = [
  ...REMOW_EPISODE_APPROVALS,
  ...GUNDAM_INFO_EPISODE_APPROVALS,
  ...AFTER_WAR_GUNDAM_X_EPISODE_APPROVALS,
  ...EXPANDED_OFFICIAL_YOUTUBE_EPISODE_APPROVALS,
  ...SECOND_WAVE_OFFICIAL_YOUTUBE_EPISODE_APPROVALS,
  ...BEYBLADE_OFFICIAL_YOUTUBE_EPISODE_APPROVALS,
  ...NOZOMI_OFFICIAL_YOUTUBE_EPISODE_APPROVALS,
];

type OEmbed = {
  type?: unknown;
  provider_name?: unknown;
  title?: unknown;
  author_name?: unknown;
  author_url?: unknown;
  html?: unknown;
};

function validateApproval(approval: OfficialYouTubeEpisodeApproval): void {
  const publisherPolicy = officialYouTubePublisherPolicyForChannel(approval.video.channelId);
  if (
    approval.catalogue.source !== 'anikoto' ||
    !publisherPolicy ||
    approval.video.channelUrl !== publisherPolicy.publisher.channelUrl ||
    approval.video.handleUrl !== publisherPolicy.publisher.handleUrl ||
    approval.video.watchUrl !== `https://www.youtube.com/watch?v=${approval.video.id}` ||
    approval.publisherIdentityUrl !== publisherPolicy.identityUrl ||
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
  const publisher = officialYouTubePublisherPolicyForChannel(approval.video.channelId)!.publisher;
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
    value.author_name !== publisher.label ||
    value.author_url !== publisher.handleUrl ||
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
  const publisherPolicy = officialYouTubePublisherPolicyForChannel(approval.video.channelId)!;
  const publisher = publisherPolicy.publisher;
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
    for (const alias of ['YouTube', publisher.label, ...publisherPolicy.aliases])
      db.prepare("INSERT INTO provider_aliases(provider_id,alias,alias_type) VALUES(?,?,'verified_publisher') ON CONFLICT(provider_id,alias) DO NOTHING")
        .run(OFFICIAL_YOUTUBE_PROVIDER_ID, alias);
    for (const connection of [
      ['www.youtube.com', '/watch', 'official_watch_page'],
      ['www.youtube.com', '/oembed', 'public_identity_metadata'],
      ['www.youtube.com', '/iframe_api', 'official_player_api'],
      [OFFICIAL_YOUTUBE_EMBED_HOST, '/embed/', 'privacy_enhanced_player'],
      [new URL(publisherPolicy.identityUrl).hostname, new URL(publisherPolicy.identityUrl).pathname, 'publisher_channel_evidence'],
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
          `${approval.video.title}; publisher ${publisher.channelId}; standard YouTube embed only.`,
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
          publisher.channelUrl,
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
      approved.identity_evidence_url !== publisher.channelUrl ||
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
