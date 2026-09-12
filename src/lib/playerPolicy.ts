export const PLAYER_SANDBOX = 'allow-scripts allow-same-origin';
export const PLAYER_PERMISSIONS =
  "autoplay; fullscreen; encrypted-media; picture-in-picture; camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'";
/** Only reviewed cross-origin embed URLs are accepted. Sandbox mode is an explicit preference. */
export function playbackUrl(input: string, kind: string, base: string): string | null {
  if (!input) return null;
  try {
    const url = new URL(input, base);
    if (url.username || url.password) return null;
    if (kind === 'iframe')
      return url.protocol === 'https:' &&
        url.hostname === 'megaplay.buzz' &&
        url.port === '' &&
        /^\/stream\//.test(url.pathname)
        ? url.href
        : null;
    return url.protocol === 'https:' ||
      (['http:', 'https:'].includes(url.protocol) && url.origin === new URL(base).origin)
      ? url.href
      : null;
  } catch {
    return null;
  }
}
