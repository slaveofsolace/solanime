import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  extractSeriesIdentitySegments,
  isEpisodePackOrRange,
  loadOfficialYouTubeCatalogue,
  normalizeAnimeTitle,
  type OfficialYouTubeReviewCandidate,
} from '../server/ingestion/youtubeOfficialDiscovery.ts';
import { OFFICIAL_YOUTUBE_EPISODE_APPROVALS } from '../server/ingestion/youtubeOfficial.ts';

type PublisherKey = 'TMS_PUBLISHER' | 'REMOW_PUBLISHER';

interface SeriesDefinition {
  exportName: string;
  idPrefix: string;
  sourceId: string;
  titleSourceId: string;
  language: 'sub' | 'dub';
  publisher: PublisherKey;
  publisherIdentityUrl: string;
  titleIdentityUrl: string;
}

const definitions: readonly SeriesDefinition[] = [
  { exportName: 'TMS_SONIC_X_DUB_EPISODE_APPROVALS', idPrefix: 'tms-sonic-x-dub', sourceId: 'tms-anime-official', titleSourceId: '3848', language: 'dub', publisher: 'TMS_PUBLISHER', publisherIdentityUrl: 'https://tmsanime.com/anime-on-tms-official-channel', titleIdentityUrl: 'https://tmsanime.com/anime-on-tms-official-channel' },
  { exportName: 'TMS_SONIC_X_SUB_EPISODE_APPROVALS', idPrefix: 'tms-sonic-x-sub', sourceId: 'tms-anime-official', titleSourceId: '3848', language: 'sub', publisher: 'TMS_PUBLISHER', publisherIdentityUrl: 'https://tmsanime.com/anime-on-tms-official-channel', titleIdentityUrl: 'https://tmsanime.com/anime-on-tms-official-channel' },
  { exportName: 'TMS_ROSE_OF_VERSAILLES_EPISODE_APPROVALS', idPrefix: 'tms-rose-of-versailles', sourceId: 'tms-anime-official', titleSourceId: '1409', language: 'sub', publisher: 'TMS_PUBLISHER', publisherIdentityUrl: 'https://tmsanime.com/anime-on-tms-official-channel', titleIdentityUrl: 'https://tmsanime.com/anime-on-tms-official-channel' },
  { exportName: 'TMS_DEVIL_LADY_DUB_EPISODE_APPROVALS', idPrefix: 'tms-devil-lady-dub', sourceId: 'tms-anime-official', titleSourceId: '3684', language: 'dub', publisher: 'TMS_PUBLISHER', publisherIdentityUrl: 'https://tmsanime.com/anime-on-tms-official-channel', titleIdentityUrl: 'https://tmsanime.com/anime-on-tms-official-channel' },
  { exportName: 'TMS_MAGIC_KNIGHT_RAYEARTH_DUB_EPISODE_APPROVALS', idPrefix: 'tms-magic-knight-rayearth-dub', sourceId: 'tms-anime-official', titleSourceId: '141', language: 'dub', publisher: 'TMS_PUBLISHER', publisherIdentityUrl: 'https://tmsanime.com/anime-on-tms-official-channel', titleIdentityUrl: 'https://tmsanime.com/anime-on-tms-official-channel' },
  { exportName: 'TMS_CYBERSIX_DUB_EPISODE_APPROVALS', idPrefix: 'tms-cybersix-dub', sourceId: 'tms-anime-official', titleSourceId: '1748', language: 'dub', publisher: 'TMS_PUBLISHER', publisherIdentityUrl: 'https://tmsanime.com/anime-on-tms-official-channel', titleIdentityUrl: 'https://tmsanime.com/anime-on-tms-official-channel' },
  { exportName: 'TMS_TOMORROWS_JOE_EPISODE_APPROVALS', idPrefix: 'tms-tomorrows-joe', sourceId: 'tms-anime-official', titleSourceId: '1280', language: 'sub', publisher: 'TMS_PUBLISHER', publisherIdentityUrl: 'https://tmsanime.com/anime-on-tms-official-channel', titleIdentityUrl: 'https://tmsanime.com/anime-on-tms-official-channel' },
  { exportName: 'TMS_NOBODYS_BOY_REMI_EPISODE_APPROVALS', idPrefix: 'tms-nobodys-boy-remi', sourceId: 'tms-anime-official', titleSourceId: '854', language: 'sub', publisher: 'TMS_PUBLISHER', publisherIdentityUrl: 'https://tmsanime.com/anime-on-tms-official-channel', titleIdentityUrl: 'https://tmsanime.com/anime-on-tms-official-channel' },
  { exportName: 'TMS_DR_STONE_DUB_EPISODE_APPROVALS', idPrefix: 'tms-dr-stone-dub', sourceId: 'tms-anime-official', titleSourceId: '1432', language: 'dub', publisher: 'TMS_PUBLISHER', publisherIdentityUrl: 'https://tmsanime.com/anime-on-tms-official-channel', titleIdentityUrl: 'https://tmsanime.com/anime-on-tms-official-channel' },
  { exportName: 'REMOW_WATANARE_EPISODE_APPROVALS', idPrefix: 'remow-watanare', sourceId: 'remow-its-anime', titleSourceId: '7955', language: 'sub', publisher: 'REMOW_PUBLISHER', publisherIdentityUrl: 'https://www.remow.com/en/service/', titleIdentityUrl: 'https://www.remow.com/en/service/' },
  { exportName: 'REMOW_HELL_TEACHER_NUBE_EPISODE_APPROVALS', idPrefix: 'remow-hell-teacher-nube', sourceId: 'remow-its-anime', titleSourceId: '7915', language: 'sub', publisher: 'REMOW_PUBLISHER', publisherIdentityUrl: 'https://www.remow.com/en/service/', titleIdentityUrl: 'https://www.remow.com/en/service/' },
  { exportName: 'REMOW_STEPMOTHER_STEPSISTERS_EPISODE_APPROVALS', idPrefix: 'remow-stepmother-stepsisters', sourceId: 'remow-its-anime', titleSourceId: '8946', language: 'sub', publisher: 'REMOW_PUBLISHER', publisherIdentityUrl: 'https://www.remow.com/en/service/', titleIdentityUrl: 'https://www.remow.com/en/service/' },
  { exportName: 'REMOW_MY_DEER_FRIEND_NOKOTAN_EPISODE_APPROVALS', idPrefix: 'remow-my-deer-friend-nokotan', sourceId: 'remow-its-anime', titleSourceId: '6268', language: 'sub', publisher: 'REMOW_PUBLISHER', publisherIdentityUrl: 'https://www.remow.com/en/service/', titleIdentityUrl: 'https://www.remow.com/en/service/' },
  { exportName: 'REMOW_HAIGAKURA_EPISODE_APPROVALS', idPrefix: 'remow-haigakura', sourceId: 'remow-its-anime', titleSourceId: '39', language: 'sub', publisher: 'REMOW_PUBLISHER', publisherIdentityUrl: 'https://www.remow.com/en/service/', titleIdentityUrl: 'https://www.remow.com/en/service/' },
  { exportName: 'REMOW_TASOKARE_HOTEL_EPISODE_APPROVALS', idPrefix: 'remow-tasokare-hotel', sourceId: 'remow-its-anime', titleSourceId: '7448', language: 'sub', publisher: 'REMOW_PUBLISHER', publisherIdentityUrl: 'https://www.remow.com/en/service/', titleIdentityUrl: 'https://www.remow.com/en/service/' },
  { exportName: 'REMOW_YOUR_FORMA_EPISODE_APPROVALS', idPrefix: 'remow-your-forma', sourceId: 'remow-its-anime', titleSourceId: '7563', language: 'sub', publisher: 'REMOW_PUBLISHER', publisherIdentityUrl: 'https://www.remow.com/en/service/', titleIdentityUrl: 'https://www.remow.com/en/service/' },
  { exportName: 'REMOW_TOUGEN_ANKI_DUB_EPISODE_APPROVALS', idPrefix: 'remow-tougen-anki-dub', sourceId: 'remow-its-anime', titleSourceId: '7971', language: 'dub', publisher: 'REMOW_PUBLISHER', publisherIdentityUrl: 'https://www.remow.com/en/service/', titleIdentityUrl: 'https://www.remow.com/en/service/' },
  { exportName: 'REMOW_KILL_BLUE_EPISODE_APPROVALS', idPrefix: 'remow-kill-blue', sourceId: 'remow-its-anime', titleSourceId: '8725', language: 'sub', publisher: 'REMOW_PUBLISHER', publisherIdentityUrl: 'https://www.remow.com/en/service/', titleIdentityUrl: 'https://www.remow.com/en/service/' },
] as const;

const [candidatePath, databasePath, outputPath] = process.argv.slice(2).map((value) => value ? resolve(value) : value);
if (!candidatePath || !databasePath || !outputPath)
  throw new Error('USAGE: generate-official-youtube-third-wave.ts <candidates> <catalogue> <output>');

const candidates = JSON.parse(readFileSync(candidatePath, 'utf8')) as OfficialYouTubeReviewCandidate[];
const database = new DatabaseSync(databasePath, { readOnly: true });
const catalogue = loadOfficialYouTubeCatalogue(database);
database.close();
const catalogueBySourceId = new Map(catalogue.map((title) => [title.sourceId, title]));
// The combined runtime registry also imports this generator's output. Exclude
// the definitions owned by this file so rerunning the generator reproduces the
// same registry instead of treating its own rows as pre-existing approvals.
const ownedApprovalPrefixes = definitions.map((definition) => `${definition.idPrefix}-episode-`);
const priorApprovals = OFFICIAL_YOUTUBE_EPISODE_APPROVALS.filter((approval) =>
  !ownedApprovalPrefixes.some((prefix) => approval.id.startsWith(prefix)));
const alreadyApprovedVideos = new Set(priorApprovals.map((approval) => approval.video.id));
const alreadyApprovedTargets = new Set(priorApprovals.map((approval) => approval.catalogue.versionSourceId));

const generated: Array<{ definition: SeriesDefinition; titleSlug: string; rows: string[] }> = [];
const acceptedVideos = new Set<string>();
const acceptedTargets = new Set<string>();

for (const definition of definitions) {
  const title = catalogueBySourceId.get(definition.titleSourceId);
  if (!title) throw new Error(`TITLE_NOT_FOUND:${definition.titleSourceId}`);
  const rows = candidates
    .filter((candidate) => candidate.sourceId === definition.sourceId)
    .filter((candidate) => candidate.match?.titleSourceId === definition.titleSourceId && candidate.match.language === definition.language)
    .filter((candidate) => candidate.decision === 'manual-review' && candidate.fullEpisodeCandidate)
    .filter((candidate) => candidate.parsedEpisode?.kind === 'regular' && Number.isSafeInteger(candidate.parsedEpisode.number))
    .filter((candidate) => candidate.probe?.availability === 'playable' && candidate.probe.playableInEmbed === true)
    .filter((candidate) => candidate.probe?.availableCountries.includes('US') === true)
    .filter((candidate) => !isEpisodePackOrRange(candidate.video.title))
    .filter((candidate) => {
      const identitySegments = extractSeriesIdentitySegments(candidate.video.title).map(normalizeAnimeTitle);
      return title.aliases.some((alias) => {
        const normalizedAlias = normalizeAnimeTitle(alias);
        return normalizedAlias.length >= 4 && identitySegments.some((segment) => segment.includes(normalizedAlias));
      });
    })
    .sort((left, right) => Number(left.parsedEpisode!.number) - Number(right.parsedEpisode!.number) || left.video.videoId.localeCompare(right.video.videoId));

  const emitted: string[] = [];
  for (const candidate of rows) {
    const match = candidate.match!;
    if (!match.episodeSourceId || !match.versionSourceId || !match.episodeId || !match.versionId)
      throw new Error(`INCOMPLETE_CROSSWALK:${candidate.candidateId}`);
    if (alreadyApprovedVideos.has(candidate.video.videoId) || alreadyApprovedTargets.has(match.versionSourceId)) continue;
    if (acceptedVideos.has(candidate.video.videoId)) throw new Error(`DUPLICATE_VIDEO:${candidate.video.videoId}`);
    if (acceptedTargets.has(match.versionSourceId)) throw new Error(`DUPLICATE_TARGET:${match.versionSourceId}`);
    acceptedVideos.add(candidate.video.videoId);
    acceptedTargets.add(match.versionSourceId);
    emitted.push(`  [${JSON.stringify(String(candidate.parsedEpisode!.number))}, ${JSON.stringify(match.episodeSourceId)}, ${JSON.stringify(candidate.video.videoId)}, ${JSON.stringify(candidate.video.title)}, ${JSON.stringify(candidate.probe!.observedAt)}],`);
  }
  if (emitted.length) generated.push({ definition, titleSlug: title.slug, rows: emitted });
}

const lines = [
  "import type { OfficialYouTubeEpisodeApproval } from './youtubeOfficial.ts';",
  "import { REMOW_PUBLISHER, TMS_PUBLISHER } from '../../shared/youtubeOfficialPublishers.ts';",
  '',
  '// Generated from the immutable v5 official-publisher review. The generator',
  '// requires a unique catalogue crosswalk, exact series identity in a title-bearing',
  '// segment, US availability, standard embed support, and one complete episode.',
  "type ThirdWaveRow = readonly [episodeNumber: string, episodeSourceId: string, videoId: string, videoTitle: string, observedAt: string];",
  "type Definition = Readonly<{ idPrefix: string; titleSourceId: string; titleSlug: string; language: 'sub' | 'dub'; publisher: typeof REMOW_PUBLISHER | typeof TMS_PUBLISHER; publisherIdentityUrl: string; titleIdentityUrl: string }>;",
  '',
  'function buildApprovals(definition: Definition, rows: readonly ThirdWaveRow[]): readonly OfficialYouTubeEpisodeApproval[] {',
  '  return Object.freeze(rows.map(([episodeNumber, episodeSourceId, videoId, videoTitle, observedAt]) => ({',
  '    id: `${definition.idPrefix}-episode-${episodeNumber}`,',
  "    catalogue: { source: 'anikoto' as const, titleSourceId: definition.titleSourceId, titleSlug: definition.titleSlug, episodeSourceId, episodeNumber, versionSourceId: `${episodeSourceId}:${definition.language}`, language: definition.language },",
  '    video: { id: videoId, title: videoTitle, watchUrl: `https://www.youtube.com/watch?v=${videoId}`, channelId: definition.publisher.channelId, channelUrl: definition.publisher.channelUrl, handleUrl: definition.publisher.handleUrl },',
  '    publisherIdentityUrl: definition.publisherIdentityUrl,',
  '    titleIdentityUrl: definition.titleIdentityUrl,',
  '    episodeIdentityUrl: `https://www.youtube.com/watch?v=${videoId}`,',
  '    observedAt,',
  '  })));',
  '}',
  '',
];

for (const item of generated) {
  const rowName = `${item.definition.exportName.replace(/_EPISODE_APPROVALS$/, '')}_ROWS`;
  lines.push(`const ${rowName} = [`, ...item.rows, '] as const satisfies readonly ThirdWaveRow[];', '');
  lines.push(`export const ${item.definition.exportName} = buildApprovals({`);
  lines.push(`  idPrefix: ${JSON.stringify(item.definition.idPrefix)},`);
  lines.push(`  titleSourceId: ${JSON.stringify(item.definition.titleSourceId)},`);
  lines.push(`  titleSlug: ${JSON.stringify(item.titleSlug)},`);
  lines.push(`  language: ${JSON.stringify(item.definition.language)},`);
  lines.push(`  publisher: ${item.definition.publisher},`);
  lines.push(`  publisherIdentityUrl: ${JSON.stringify(item.definition.publisherIdentityUrl)},`);
  lines.push(`  titleIdentityUrl: ${JSON.stringify(item.definition.titleIdentityUrl)},`);
  lines.push(`}, ${rowName});`, '');
}

lines.push('export const THIRD_WAVE_OFFICIAL_YOUTUBE_EPISODE_APPROVALS = Object.freeze([',
  ...generated.map((item) => `  ...${item.definition.exportName},`),
  ']);');

writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ outputPath, series: generated.length, approvals: acceptedVideos.size }, null, 2)}\n`);
