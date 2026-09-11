import { AppError } from '../errors.ts';
import { validatePublicSourceUrl } from '../security.ts';
import type { AvailabilityState, CatalogueSnapshot, SnapshotTitle } from '../types.ts';

const AVAILABILITY = new Set<AvailabilityState>([
  'observed',
  'available',
  'unavailable',
  'blocked',
  'stale',
  'unknown',
]);
const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function requiredString(value: unknown, field: string, max = 2048): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new AppError(
      422,
      'UPSTREAM_CHANGED',
      `Snapshot field ${field} must be a non-empty string of at most ${max} characters.`,
    );
  }
  return value.trim();
}

function optionalString(value: unknown, field: string, max = 20_000): string | null | undefined {
  if (value === undefined || value === null) return value as null | undefined;
  if (typeof value !== 'string' || value.length > max)
    throw new AppError(422, 'UPSTREAM_CHANGED', `Snapshot field ${field} is invalid.`);
  return value.trim() || null;
}

function availability(value: unknown, field: string): AvailabilityState | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !AVAILABILITY.has(value as AvailabilityState))
    throw new AppError(
      422,
      'UPSTREAM_CHANGED',
      `Snapshot field ${field} has an unknown availability state.`,
    );
  return value as AvailabilityState;
}

function httpsUrl(value: unknown, field: string): string | null | undefined {
  const text = optionalString(value, field, 4096);
  if (!text) return text;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new AppError(422, 'UPSTREAM_CHANGED', `Snapshot field ${field} is not a valid URL.`);
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new AppError(
      422,
      'UPSTREAM_CHANGED',
      `Snapshot field ${field} must be a credential-free HTTPS URL.`,
    );
  return url.toString();
}

function validateTitle(raw: unknown, index: number): SnapshotTitle {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new AppError(422, 'UPSTREAM_CHANGED', `titles[${index}] must be an object.`);
  const item = raw as Record<string, unknown>;
  const title: SnapshotTitle = {
    sourceId: requiredString(item.sourceId, `titles[${index}].sourceId`, 512),
    slug: requiredString(item.slug, `titles[${index}].slug`, 512),
    canonicalUrl: validatePublicSourceUrl(
      requiredString(item.canonicalUrl, `titles[${index}].canonicalUrl`, 4096),
    ).toString(),
    name: requiredString(item.name, `titles[${index}].name`, 1024),
    description: optionalString(item.description, `titles[${index}].description`),
    format: optionalString(item.format, `titles[${index}].format`, 64),
    releaseYear:
      item.releaseYear == null ? (item.releaseYear as null | undefined) : Number(item.releaseYear),
    status: optionalString(item.status, `titles[${index}].status`, 64),
    artworkUrl: httpsUrl(item.artworkUrl, `titles[${index}].artworkUrl`),
    artworkOrigin: optionalString(item.artworkOrigin, `titles[${index}].artworkOrigin`, 256),
    artworkReuseStatus:
      optionalString(item.artworkReuseStatus, `titles[${index}].artworkReuseStatus`, 64) ??
      undefined,
    availability: availability(item.availability, `titles[${index}].availability`),
    aliases: [],
    genres: [],
    related: [],
    episodes: [],
  };
  if (
    title.releaseYear != null &&
    (!Number.isInteger(title.releaseYear) || title.releaseYear < 1900 || title.releaseYear > 2200)
  )
    throw new AppError(422, 'UPSTREAM_CHANGED', `titles[${index}].releaseYear is invalid.`);

  const aliases = item.aliases ?? [];
  if (!Array.isArray(aliases))
    throw new AppError(422, 'UPSTREAM_CHANGED', `titles[${index}].aliases must be an array.`);
  title.aliases = aliases.map((rawAlias, aliasIndex) => {
    if (!rawAlias || typeof rawAlias !== 'object' || Array.isArray(rawAlias))
      throw new AppError(
        422,
        'UPSTREAM_CHANGED',
        `titles[${index}].aliases[${aliasIndex}] is invalid.`,
      );
    const alias = rawAlias as Record<string, unknown>;
    return {
      name: requiredString(alias.name, `alias.name`, 1024),
      language: optionalString(alias.language, 'alias.language', 32),
      type: optionalString(alias.type, 'alias.type', 64) ?? undefined,
    };
  });
  const genres = item.genres ?? [];
  if (!Array.isArray(genres))
    throw new AppError(422, 'UPSTREAM_CHANGED', `titles[${index}].genres must be an array.`);
  title.genres = genres.map((genre) => requiredString(genre, 'genre', 128));
  const related = item.related ?? [];
  if (!Array.isArray(related))
    throw new AppError(422, 'UPSTREAM_CHANGED', `titles[${index}].related must be an array.`);
  title.related = related.map((rawRelation) => {
    if (!rawRelation || typeof rawRelation !== 'object' || Array.isArray(rawRelation))
      throw new AppError(422, 'UPSTREAM_CHANGED', 'related title is invalid.');
    const relation = rawRelation as Record<string, unknown>;
    return {
      sourceId: requiredString(relation.sourceId, 'related.sourceId', 512),
      relationshipType: requiredString(relation.relationshipType, 'related.relationshipType', 64),
      label: optionalString(relation.label, 'related.label', 1024),
      sourceUrl: httpsUrl(relation.sourceUrl, 'related.sourceUrl'),
    };
  });
  if (!Array.isArray(item.episodes))
    throw new AppError(422, 'UPSTREAM_CHANGED', `titles[${index}].episodes must be an array.`);
  title.episodes = item.episodes.map((rawEpisode, episodeIndex) => {
    if (!rawEpisode || typeof rawEpisode !== 'object' || Array.isArray(rawEpisode))
      throw new AppError(422, 'UPSTREAM_CHANGED', `episode is invalid.`);
    const episode = rawEpisode as Record<string, unknown>;
    if (!Array.isArray(episode.versions))
      throw new AppError(422, 'UPSTREAM_CHANGED', `episode.versions must be an array.`);
    return {
      sourceId: requiredString(episode.sourceId, 'episode.sourceId', 512),
      number: requiredString(episode.number, 'episode.number', 128),
      numberSort:
        episode.numberSort == null
          ? (episode.numberSort as null | undefined)
          : Number(episode.numberSort),
      label: optionalString(episode.label, 'episode.label', 1024),
      slug: requiredString(episode.slug, 'episode.slug', 512),
      canonicalUrl: validatePublicSourceUrl(
        requiredString(episode.canonicalUrl, 'episode.canonicalUrl', 4096),
      ).toString(),
      episodeType: optionalString(episode.episodeType, 'episode.episodeType', 64) ?? undefined,
      availability: availability(episode.availability, 'episode.availability'),
      versions: episode.versions.map((rawVersion) => {
        if (!rawVersion || typeof rawVersion !== 'object' || Array.isArray(rawVersion))
          throw new AppError(422, 'UPSTREAM_CHANGED', 'episode version is invalid.');
        const version = rawVersion as Record<string, unknown>;
        if (version.providers != null && !Array.isArray(version.providers))
          throw new AppError(422, 'UPSTREAM_CHANGED', 'version.providers must be an array.');
        return {
          sourceId: requiredString(version.sourceId, 'version.sourceId', 512),
          language: requiredString(version.language, 'version.language', 32).toLowerCase(),
          label: optionalString(version.label, 'version.label', 128),
          audioLanguage: optionalString(version.audioLanguage, 'version.audioLanguage', 32),
          subtitleLanguage: optionalString(
            version.subtitleLanguage,
            'version.subtitleLanguage',
            32,
          ),
          availability: availability(version.availability, 'version.availability'),
          providers: ((version.providers ?? []) as unknown[]).map((rawProvider) => {
            if (!rawProvider || typeof rawProvider !== 'object' || Array.isArray(rawProvider))
              throw new AppError(422, 'UPSTREAM_CHANGED', 'provider mapping is invalid.');
            const provider = rawProvider as Record<string, unknown>;
            const providerId = requiredString(provider.providerId, 'provider.providerId', 64);
            if (!PROVIDER_ID.test(providerId))
              throw new AppError(422, 'UPSTREAM_CHANGED', `Invalid provider id: ${providerId}`);
            return {
              sourceMappingId: requiredString(
                provider.sourceMappingId,
                'provider.sourceMappingId',
                512,
              ),
              providerId,
              providerResourceId: optionalString(
                provider.providerResourceId,
                'provider.providerResourceId',
                2048,
              ),
              canonicalEmbedUrl: httpsUrl(provider.canonicalEmbedUrl, 'provider.canonicalEmbedUrl'),
              availability: availability(provider.availability, 'provider.availability'),
              unavailableReason: optionalString(
                provider.unavailableReason,
                'provider.unavailableReason',
                2048,
              ),
              mappingOrigin:
                provider.mappingOrigin === 'external_mapper'
                  ? ('external_mapper' as const)
                  : ('native' as const),
              publicExportAllowed: provider.publicExportAllowed === true,
            };
          }),
        };
      }),
    };
  });
  return title;
}

export function validateSnapshot(raw: unknown): CatalogueSnapshot {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new AppError(422, 'UPSTREAM_CHANGED', 'Snapshot root must be an object.');
  const value = raw as Record<string, unknown>;
  if (value.schemaVersion !== 1 || value.source !== 'anikoto' || !Array.isArray(value.titles))
    throw new AppError(
      422,
      'UPSTREAM_CHANGED',
      'Snapshot schemaVersion/source/titles does not match version 1.',
    );
  const observedAt = requiredString(value.observedAt, 'observedAt', 64);
  if (Number.isNaN(Date.parse(observedAt)))
    throw new AppError(422, 'UPSTREAM_CHANGED', 'observedAt is not an ISO date.');
  return {
    schemaVersion: 1,
    source: 'anikoto',
    observedAt: new Date(observedAt).toISOString(),
    denominator: value.denominator as CatalogueSnapshot['denominator'],
    titles: value.titles.map(validateTitle),
  };
}
