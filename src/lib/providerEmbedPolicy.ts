import type { PlaybackResolution } from '../types';

export const PROVIDER_EMBED_ORIGIN = 'https://megaplay.buzz';
export const PROVIDER_EMBED_SANDBOX = 'allow-scripts allow-same-origin allow-presentation';
export const PROVIDER_EMBED_ALLOW = 'autoplay; encrypted-media; fullscreen; picture-in-picture';

const PROVIDER_IDS = new Set(['vidstream-2', 'hd-1', 'hd-2']);
const EMBED_PATH = /^\/stream\/s-2\/([1-9]\d*)\/(sub|dub)\/?$/;

function matchesProviderSelector(url: URL, providerId: string): boolean {
  if (!url.search) return true;
  if (providerId === 'hd-1') return url.search === '?s=tcdn';
  if (providerId === 'hd-2') return url.search === '?s=bcdn';
  return false;
}

export type ProviderEmbedResolution = Omit<
  PlaybackResolution,
  'kind' | 'delivery' | 'playbackType' | 'embedUrl'
> & {
  kind: 'embed';
  delivery: 'provider';
  playbackType: 'iframe';
  embedUrl: string;
  language: string;
  allowedEmbedHosts: string[];
  expiresAt?: string | null;
};

export function providerEmbedUrl(
  input: PlaybackResolution | ProviderEmbedResolution,
  expectedLanguage?: string,
): string | null {
  const resolution = input as Partial<ProviderEmbedResolution>;
  if (
    resolution.kind !== 'embed' ||
    resolution.delivery !== 'provider' ||
    resolution.playbackType !== 'iframe' ||
    typeof resolution.embedUrl !== 'string' ||
    typeof resolution.providerId !== 'string' ||
    !PROVIDER_IDS.has(resolution.providerId) ||
    !Array.isArray(resolution.allowedEmbedHosts) ||
    !resolution.allowedEmbedHosts.includes('megaplay.buzz')
  ) {
    return null;
  }

  try {
    const url = new URL(resolution.embedUrl);
    const match = EMBED_PATH.exec(url.pathname);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'megaplay.buzz' ||
      url.port ||
      url.username ||
      url.password ||
      !matchesProviderSelector(url, resolution.providerId) ||
      url.hash ||
      !match
    ) {
      return null;
    }
    const language = expectedLanguage || resolution.language;
    if (!language || match[2] !== language.toLocaleLowerCase()) return null;
    if (resolution.expiresAt) {
      const expiresAt = Date.parse(resolution.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

export function isProviderEmbedResolution(
  input: PlaybackResolution,
  expectedLanguage?: string,
): input is PlaybackResolution & ProviderEmbedResolution {
  return providerEmbedUrl(input, expectedLanguage) !== null;
}
