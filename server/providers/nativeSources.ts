import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectRoot } from '../db.ts';
import type { StoredProviderMapping, ProviderResolution } from './contract.ts';
export type NativeSource = {
  mappingId: number;
  language: string;
  type: 'direct' | 'hls' | 'dash';
  url: string;
  allowedHosts: string[];
  expiresAt?: string;
  attribution?: string;
  authorization: { basis: 'owned' | 'licensed' | 'provider-permission'; reference: string };
  captions?: import('../../shared/playback').CaptionSource[];
};
/** Operator-registered media resources, not an arbitrary URL fetcher or embed extractor. */
export function validateNativeSources(value: unknown): NativeSource[] {
  if (!Array.isArray(value) || value.length > 100000)
    throw Error('Native sources must be an array of at most 100000 entries.');
  const ids = new Set<number>();
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') throw Error('Invalid native source entry.');
    const s = entry as NativeSource;
    if (
      !Number.isSafeInteger(s.mappingId) ||
      s.mappingId <= 0 ||
      ids.has(s.mappingId) ||
      !['direct', 'hls', 'dash'].includes(s.type) ||
      !/^[a-z-]{2,20}$/.test(s.language)
    )
      throw Error('Invalid or duplicate native mapping.');
    if (
      !s.authorization ||
      !['owned', 'licensed', 'provider-permission'].includes(s.authorization.basis) ||
      typeof s.authorization.reference !== 'string' ||
      s.authorization.reference.trim().length < 4 ||
      s.authorization.reference.length > 2000
    )
      throw Error('Native sources require documented ownership, license or provider permission.');
    const url = new URL(s.url);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      /^localhost$|^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\.|^\[/.test(
        url.hostname,
      )
    )
      throw Error('Native media requires a public credential-free HTTPS URL.');
    if (
      !Array.isArray(s.allowedHosts) ||
      s.allowedHosts.length > 32 ||
      !s.allowedHosts.every(
        (h) =>
          typeof h === 'string' && /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(h),
      ) ||
      !s.allowedHosts.includes(url.hostname)
    )
      throw Error(
        'Native sources require explicit media hostnames, including the main source host.',
      );
    if (s.expiresAt && !Number.isFinite(Date.parse(s.expiresAt)))
      throw Error('Invalid media expiry.');
    if (s.captions && (!Array.isArray(s.captions) || s.captions.length > 30))
      throw Error('Invalid caption list.');
    const captions = (s.captions ?? []).map((track) => {
      const trackUrl = new URL(track.url);
      if (
        trackUrl.protocol !== 'https:' ||
        trackUrl.username ||
        trackUrl.password ||
        trackUrl.port ||
        trackUrl.hash ||
        !s.allowedHosts.includes(trackUrl.hostname) ||
        typeof track.label !== 'string' ||
        !track.label.trim() ||
        track.label.length > 80 ||
        !/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(track.language)
      )
        throw Error('Caption resources must use an approved host and a language label.');
      return {
        url: trackUrl.href,
        label: track.label,
        language: track.language,
        default: track.default === true,
      };
    });
    ids.add(s.mappingId);
    return {
      mappingId: s.mappingId,
      language: s.language,
      type: s.type,
      url: url.href,
      allowedHosts: [...new Set(s.allowedHosts)],
      expiresAt: s.expiresAt,
      attribution: s.attribution,
      authorization: { basis: s.authorization.basis, reference: s.authorization.reference.trim() },
      captions,
    };
  });
}
export function nativeSourceResolver(input?: NativeSource[]) {
  const path = process.env.SOLANIME_NATIVE_SOURCES;
  let entries = input;
  if (!entries && path) {
    const absolute = resolve(projectRoot, path);
    if (statSync(absolute).size > 16 * 1024 * 1024)
      throw Error('Native source configuration is too large.');
    entries = JSON.parse(readFileSync(absolute, 'utf8'));
  }
  const index = new Map(validateNativeSources(entries ?? []).map((s) => [s.mappingId, s]));
  return (mapping: StoredProviderMapping): ProviderResolution | null => {
    const source = index.get(mapping.mappingId);
    if (!source) return null;
    if (
      mapping.language !== source.language ||
      (source.expiresAt && Date.parse(source.expiresAt) <= Date.now())
    )
      return {
        mappingId: mapping.mappingId,
        providerId: mapping.providerId,
        playbackType: source.type,
        status: 'unavailable',
        error: {
          code: 'NATIVE_SOURCE_EXPIRED',
          message:
            'The registered native source is expired or does not match this language version.',
        },
      };
    return {
      mappingId: mapping.mappingId,
      providerId: mapping.providerId,
      playbackType: source.type,
      status: 'resolved',
      url: source.url,
      expiresAt: source.expiresAt,
      allowedMediaHosts: source.allowedHosts,
      delivery: 'native',
      captions: source.captions,
    };
  };
}
