import { AppError } from './errors.ts';
import type { IncomingHttpHeaders } from 'node:http';

const PUBLIC_SOURCE_HOSTS = new Set([
  'anikototv.to',
  'www.anikototv.to',
  'tvmaze.com',
  'www.tvmaze.com',
  'en.wikipedia.org',
]);

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

export function requireSafeMutation(
  headers: IncomingHttpHeaders,
  options: { requireJson: boolean },
): void {
  const fetchSite = headerValue(headers['sec-fetch-site']).toLowerCase();
  if (fetchSite && fetchSite !== 'same-origin') {
    throw new AppError(403, 'UNAUTHORIZED', 'Cross-origin mutation requests are not accepted.');
  }

  const origin = headerValue(headers.origin);
  if (origin) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new AppError(403, 'UNAUTHORIZED', 'Mutation request origin is invalid.');
    }
    const requestHost = headerValue(headers.host).toLowerCase();
    let requestHostname = '';
    try {
      requestHostname = new URL(`http://${requestHost}`).hostname.toLowerCase();
    } catch {
      throw new AppError(403, 'UNAUTHORIZED', 'Mutation request host is invalid.');
    }
    const exactOrigin = parsed.host.toLowerCase() === requestHost;
    const configured = (process.env.SOLANIME_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const allowedOrigin = configured.includes(parsed.origin);
    if (
      origin !== parsed.origin ||
      !['http:', 'https:'].includes(parsed.protocol) ||
      (!exactOrigin && !allowedOrigin)
    ) {
      throw new AppError(403, 'UNAUTHORIZED', 'Cross-origin mutation requests are not accepted.');
    }
  }

  const contentType = headerValue(headers['content-type']).trim();
  const contentLength = Number(headerValue(headers['content-length']) || 0);
  const hasBody =
    Boolean(headers['transfer-encoding']) || (Number.isFinite(contentLength) && contentLength > 0);
  if ((options.requireJson || hasBody) && !/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new AppError(415, 'BAD_REQUEST', 'Mutation request bodies must use application/json.');
  }
}

export function validatePublicSourceUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new AppError(400, 'BAD_REQUEST', 'Source URL is invalid.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new AppError(
      400,
      'BAD_REQUEST',
      'Only credential-free HTTPS source URLs on the public allowlist are accepted.',
    );
  }
  if (!PUBLIC_SOURCE_HOSTS.has(url.hostname.toLowerCase())) {
    throw new AppError(400, 'BAD_REQUEST', 'Source hostname is not allowlisted.');
  }
  return url;
}

export function validateEmbedUrl(input: string, exactHosts: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new AppError(422, 'INVALID_PROVIDER_RESOURCE', 'Provider embed URL is invalid.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !exactHosts.includes(url.hostname.toLowerCase())
  ) {
    throw new AppError(
      422,
      'INVALID_PROVIDER_RESOURCE',
      'Provider embed URL does not match the adapter allowlist.',
    );
  }
  if (url.pathname.length > 2048 || url.search.length > 2048) {
    throw new AppError(422, 'INVALID_PROVIDER_RESOURCE', 'Provider embed URL is too long.');
  }
  return url;
}

export function redactUrl(input: string): string {
  try {
    const url = new URL(input);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '[invalid-url]';
  }
}
