export const CATALOGUE_SCOPES = ['all', 'anime', 'tv', 'movies'] as const;

export type CatalogueScope = (typeof CATALOGUE_SCOPES)[number];

export function isCatalogueScope(value: unknown): value is CatalogueScope {
  return typeof value === 'string' && CATALOGUE_SCOPES.includes(value as CatalogueScope);
}

export function sourcesForCatalogueScope(scope: CatalogueScope): readonly string[] {
  switch (scope) {
    case 'anime':
      return ['anikoto'];
    case 'tv':
      return ['tvmaze', 'wikipedia-tv'];
    case 'movies':
      return ['wikipedia-movie'];
    case 'all':
      return [];
  }
}
