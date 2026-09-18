import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  isEpisodePackOrRange,
  loadOfficialYouTubeCatalogue,
  type OfficialYouTubeReviewCandidate,
} from '../server/ingestion/youtubeOfficialDiscovery.ts';
import { OFFICIAL_YOUTUBE_EPISODE_APPROVALS } from '../server/ingestion/youtubeOfficial.ts';

type PublisherKey =
  | 'BEYBLADE_FRENCH_PUBLISHER'
  | 'BEYBLADE_GERMAN_PUBLISHER'
  | 'BEYBLADE_SPANISH_PUBLISHER'
  | 'BEYBLADE_DUTCH_PUBLISHER'
  | 'BEYBLADE_PORTUGUESE_BRAZIL_PUBLISHER'
  | 'BEYBLADE_ITALIAN_PUBLISHER';

interface EditionDefinition {
  exportName: string;
  idPrefix: string;
  sourceId: string;
  editionLabel: string;
  publisher: PublisherKey;
}

const definitions: readonly EditionDefinition[] = [
  { exportName: 'BEYBLADE_FRENCH_EPISODE_APPROVALS', idPrefix: 'beyblade-french', sourceId: 'beyblade-french', editionLabel: 'Français', publisher: 'BEYBLADE_FRENCH_PUBLISHER' },
  { exportName: 'BEYBLADE_GERMAN_EPISODE_APPROVALS', idPrefix: 'beyblade-german', sourceId: 'beyblade-german', editionLabel: 'Deutsch', publisher: 'BEYBLADE_GERMAN_PUBLISHER' },
  { exportName: 'BEYBLADE_SPANISH_EPISODE_APPROVALS', idPrefix: 'beyblade-spanish', sourceId: 'beyblade-spanish', editionLabel: 'Español latino', publisher: 'BEYBLADE_SPANISH_PUBLISHER' },
  { exportName: 'BEYBLADE_DUTCH_EPISODE_APPROVALS', idPrefix: 'beyblade-dutch', sourceId: 'beyblade-dutch', editionLabel: 'Nederlands', publisher: 'BEYBLADE_DUTCH_PUBLISHER' },
  { exportName: 'BEYBLADE_PORTUGUESE_BRAZIL_EPISODE_APPROVALS', idPrefix: 'beyblade-portuguese-brazil', sourceId: 'beyblade-portuguese-brazil', editionLabel: 'Português (Brasil)', publisher: 'BEYBLADE_PORTUGUESE_BRAZIL_PUBLISHER' },
  { exportName: 'BEYBLADE_ITALIAN_EPISODE_APPROVALS', idPrefix: 'beyblade-italian', sourceId: 'beyblade-italian', editionLabel: 'Italiano', publisher: 'BEYBLADE_ITALIAN_PUBLISHER' },
] as const;

const [candidatePath, databasePath, outputPath] = process.argv.slice(2).map((value) => value ? resolve(value) : value);
if (!candidatePath || !databasePath || !outputPath)
  throw new Error('USAGE: generate-official-youtube-beyblade-editions.ts <candidates> <catalogue> <output>');

const candidates = JSON.parse(readFileSync(candidatePath, 'utf8')) as OfficialYouTubeReviewCandidate[];
const database = new DatabaseSync(databasePath, { readOnly: true });
const catalogue = loadOfficialYouTubeCatalogue(database);
database.close();
const titles = new Map(catalogue.map((title) => [title.sourceId, title]));
const ownedPrefixes = definitions.map((definition) => `${definition.idPrefix}-`);
const priorApprovals = OFFICIAL_YOUTUBE_EPISODE_APPROVALS.filter((approval) =>
  !ownedPrefixes.some((prefix) => approval.id.startsWith(prefix)));
const priorVideos = new Set(priorApprovals.map((approval) => approval.video.id));
const emittedVideos = new Set<string>();
const generated: Array<{ definition: EditionDefinition; rows: string[] }> = [];

for (const definition of definitions) {
  const eligible = candidates
    .filter((candidate) => candidate.sourceId === definition.sourceId)
    .filter((candidate) => candidate.decision === 'manual-review' && candidate.fullEpisodeCandidate)
    .filter((candidate) => candidate.match?.language === 'dub' && candidate.match.method === 'exact-alias')
    .filter((candidate) => candidate.match?.titleSourceId && candidate.match.episodeSourceId && candidate.match.versionSourceId && candidate.match.episodeId && candidate.match.versionId)
    .filter((candidate) => candidate.parsedEpisode?.kind === 'regular' && Number.isSafeInteger(candidate.parsedEpisode.number))
    .filter((candidate) => candidate.probe?.availability === 'playable' && candidate.probe.playableInEmbed === true)
    .filter((candidate) => candidate.probe?.availableCountries.includes('US') === true)
    .filter((candidate) => !isEpisodePackOrRange(candidate.video.title))
    .filter((candidate) => !priorVideos.has(candidate.video.videoId));

  const targetCounts = new Map<string, number>();
  for (const candidate of eligible) {
    const target = candidate.match!.versionSourceId!;
    targetCounts.set(target, (targetCounts.get(target) ?? 0) + 1);
  }

  const rows: string[] = [];
  for (const candidate of eligible
    .filter((item) => targetCounts.get(item.match!.versionSourceId!) === 1)
    .sort((left, right) => left.match!.titleSourceId.localeCompare(right.match!.titleSourceId)
      || Number(left.parsedEpisode!.number) - Number(right.parsedEpisode!.number)
      || left.video.videoId.localeCompare(right.video.videoId))) {
    const match = candidate.match!;
    const title = titles.get(match.titleSourceId);
    const episode = title?.episodes.find((item) => item.sourceId === match.episodeSourceId);
    if (!title || !episode) throw new Error(`CATALOGUE_CROSSWALK_MISSING:${candidate.candidateId}`);
    if (emittedVideos.has(candidate.video.videoId)) throw new Error(`DUPLICATE_VIDEO:${candidate.video.videoId}`);
    emittedVideos.add(candidate.video.videoId);
    rows.push(`  [${JSON.stringify(match.titleSourceId)}, ${JSON.stringify(title.slug)}, ${JSON.stringify(episode.numberText)}, ${JSON.stringify(match.episodeSourceId)}, ${JSON.stringify(match.versionSourceId)}, ${JSON.stringify(candidate.video.videoId)}, ${JSON.stringify(candidate.video.title)}, ${JSON.stringify(candidate.probe!.observedAt)}],`);
  }
  if (rows.length) generated.push({ definition, rows });
}

const lines = [
  "import type { OfficialYouTubeEpisodeApproval } from './youtubeOfficial.ts';",
  'import {',
  '  BEYBLADE_DUTCH_PUBLISHER,',
  '  BEYBLADE_FRENCH_PUBLISHER,',
  '  BEYBLADE_GERMAN_PUBLISHER,',
  '  BEYBLADE_ITALIAN_PUBLISHER,',
  '  BEYBLADE_PORTUGUESE_BRAZIL_PUBLISHER,',
  '  BEYBLADE_SPANISH_PUBLISHER,',
  "} from '../../shared/youtubeOfficialPublishers.ts';",
  '',
  '// Generated from the immutable public-publisher crawl. Rows require an exact',
  '// alias crosswalk, one unambiguous video per locale/version target, US',
  '// availability, standard embed support, and a single full episode.',
  "type EditionRow = readonly [titleSourceId: string, titleSlug: string, episodeNumber: string, episodeSourceId: string, versionSourceId: string, videoId: string, videoTitle: string, observedAt: string];",
  'type Definition = Readonly<{ idPrefix: string; editionLabel: string; publisher: Readonly<{ label: string; channelId: string; channelUrl: string; handleUrl: string }> }>;',
  'function buildApprovals(definition: Definition, rows: readonly EditionRow[]): readonly OfficialYouTubeEpisodeApproval[] {',
  '  return Object.freeze(rows.map(([titleSourceId, titleSlug, episodeNumber, episodeSourceId, versionSourceId, videoId, videoTitle, observedAt]) => ({',
  '    id: `${definition.idPrefix}-${titleSourceId}-episode-${episodeSourceId}`,',
  '    editionLabel: definition.editionLabel,',
  "    catalogue: { source: 'anikoto' as const, titleSourceId, titleSlug, episodeSourceId, episodeNumber, versionSourceId, language: 'dub' },",
  '    video: { id: videoId, title: videoTitle, watchUrl: `https://www.youtube.com/watch?v=${videoId}`, channelId: definition.publisher.channelId, channelUrl: definition.publisher.channelUrl, handleUrl: definition.publisher.handleUrl },',
  "    publisherIdentityUrl: 'https://beyblade.com/episodes/',",
  "    titleIdentityUrl: 'https://beyblade.com/episodes/',",
  '    episodeIdentityUrl: `https://www.youtube.com/watch?v=${videoId}`,',
  '    observedAt,',
  '  })));',
  '}',
  '',
];

for (const item of generated) {
  const rowsName = `${item.definition.exportName.replace(/_EPISODE_APPROVALS$/, '')}_ROWS`;
  lines.push(`const ${rowsName} = [`, ...item.rows, '] as const satisfies readonly EditionRow[];', '');
  lines.push(`export const ${item.definition.exportName} = buildApprovals({`);
  lines.push(`  idPrefix: ${JSON.stringify(item.definition.idPrefix)},`);
  lines.push(`  editionLabel: ${JSON.stringify(item.definition.editionLabel)},`);
  lines.push(`  publisher: ${item.definition.publisher},`);
  lines.push(`}, ${rowsName});`, '');
}

lines.push('export const BEYBLADE_MULTILINGUAL_OFFICIAL_YOUTUBE_EPISODE_APPROVALS = Object.freeze([',
  ...generated.map((item) => `  ...${item.definition.exportName},`),
  ']);');

writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ outputPath, editions: generated.length, approvals: emittedVideos.size }, null, 2)}\n`);
