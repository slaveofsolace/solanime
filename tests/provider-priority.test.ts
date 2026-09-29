import { describe, expect, it } from 'vitest';
import { prioritizePlaybackSources } from '../src/lib/providerPriority';

describe('default provider priority', () => {
  it('selects direct and official sources ahead of uncontained embeds', () => {
    const ordered = prioritizePlaybackSources([
      { kind: 'embed' as const, id: 'hd-1' },
      { kind: 'official-youtube' as const, id: 'publisher' },
      { kind: 'embed' as const, id: 'hd-2' },
      { kind: 'native' as const, id: 'direct' },
    ]);
    expect(ordered.map((source) => source.id)).toEqual(['direct', 'publisher', 'hd-1', 'hd-2']);
  });

  it('preserves the original order among sources of the same class', () => {
    const ordered = prioritizePlaybackSources([
      { kind: 'embed' as const, id: 'hd-1' },
      { kind: 'embed' as const, id: 'vidstream-2' },
      { kind: 'embed' as const, id: 'hd-2' },
    ]);
    expect(ordered.map((source) => source.id)).toEqual(['hd-1', 'vidstream-2', 'hd-2']);
  });
});
