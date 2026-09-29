import type { ProviderChoice } from '../types';

const playbackPriority: Record<NonNullable<ProviderChoice['kind']>, number> = {
  native: 0,
  'official-youtube': 1,
  embed: 2,
  unsupported: 3,
};

/** Keep explicit server links intact; choose safer integrations first only by default. */
export function prioritizePlaybackSources<T extends Pick<ProviderChoice, 'kind'>>(providers: T[]): T[] {
  return providers
    .map((provider, index) => ({ provider, index }))
    .sort((a, b) =>
      (playbackPriority[a.provider.kind ?? 'unsupported'] - playbackPriority[b.provider.kind ?? 'unsupported']) ||
      a.index - b.index,
    )
    .map(({ provider }) => provider);
}
