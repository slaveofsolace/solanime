import { isMediaKind } from '../../shared/playback';
/** Only media returned through the native contract may reach the video element. */
export function playbackUrl(input: string, kind: string, base: string): string | null {
  if (!input || !isMediaKind(kind)) return null;
  try {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      url = new URL(input, base);
    }
    if (url.username || url.password || url.hash) return null;
    return url.protocol === 'https:' ||
      (url.protocol === 'http:' && url.origin === new URL(base).origin)
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function mediaIsSupported(
  resolution: { kind?: string; delivery?: string; playbackType: string; url?: string | null },
  base: string,
): boolean {
  return (
    (resolution.kind === undefined || resolution.kind === 'native') &&
    resolution.delivery === 'native' &&
    !!playbackUrl(resolution.url ?? '', resolution.playbackType, base)
  );
}
export function mediaCrossOrigin(resolution: {
  mediaCrossOrigin?: string;
  playbackType: string;
  captions?: unknown[];
}): 'anonymous' | undefined {
  return resolution.mediaCrossOrigin === 'none' &&
    resolution.playbackType === 'direct' &&
    (resolution.captions?.length ?? 0) === 0
    ? undefined
    : 'anonymous';
}
