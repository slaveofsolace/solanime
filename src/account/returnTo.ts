/** Only local application routes may be used as authentication return targets. */
export function safeReturnTo(value: string | null | undefined, fallback = '/') {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/.test(value)) return fallback;
  try {
    const url = new URL(value, 'https://solanime.invalid');
    if (url.origin !== 'https://solanime.invalid' || /^\/(login|register|recover|profiles)(\/|$)/.test(url.pathname)) return fallback;
    return url.pathname + url.search + url.hash;
  } catch { return fallback; }
}

export function withReturnTo(path: string, destination: string) {
  return `${path}?returnTo=${encodeURIComponent(safeReturnTo(destination))}`;
}
