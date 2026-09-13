export const DAILYMOTION_PUBLIC_API_ORIGIN = 'https://api.dailymotion.com' as const;
export const DAILYMOTION_OEMBED_ORIGIN = 'https://www.dailymotion.com' as const;
export const DAILYMOTION_EMBED_ORIGIN = 'https://geo.dailymotion.com' as const;
export const DAILYMOTION_MAX_RESPONSE_BYTES = 64 * 1024;

const VIDEO_ID = /^x[a-z0-9]{5,15}$/;
const OWNER_ID = /^x[a-z0-9]{5,15}$/;
const ISO_COUNTRY = /^[a-z]{2}$/;

export interface DailymotionPublicEmbedCandidate {
  videoId: string;
  expectedTitle?: string;
  minimumDurationSeconds: number;
  publisher: {
    ownerId: string;
    name: string;
    profileUrl: string;
  };
}

export interface DailymotionGeoPolicy {
  mode: 'allow' | 'deny';
  countries: string[];
  worldwide: boolean;
}

/**
 * A bounded observation of Dailymotion's documented public embed contract.
 * This proves platform/uploader identity and technical embeddability only. It
 * is not a copyright or catalogue crosswalk approval.
 */
export interface VerifiedDailymotionPublicEmbed {
  kind: 'dailymotion-public-embed-candidate';
  videoId: string;
  watchUrl: string;
  title: string;
  durationSeconds: number;
  publisher: DailymotionPublicEmbedCandidate['publisher'];
  geoPolicy: DailymotionGeoPolicy;
  embedOrigin: typeof DAILYMOTION_EMBED_ORIGIN;
  embedPath: '/player.html';
}

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function exactHttps(value: unknown, expected: string): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    const target = new URL(expected);
    return (
      url.protocol === 'https:' &&
      target.protocol === 'https:' &&
      url.href === target.href &&
      !url.username &&
      !url.password &&
      !url.port
    );
  } catch {
    return false;
  }
}

async function boundedJson(
  response: Response,
  label: string,
): Promise<Record<string, unknown>> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`${label}_HTTP_${response.status}`);
  }
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    await response.body?.cancel();
    throw new Error(`${label}_INVALID_CONTENT_TYPE`);
  }
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > DAILYMOTION_MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error(`${label}_TOO_LARGE`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error(`${label}_INVALID_SCHEMA`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > DAILYMOTION_MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error(`${label}_TOO_LARGE`);
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error(`${label}_INVALID_JSON`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label}_INVALID_SCHEMA`);
  return value as Record<string, unknown>;
}

export function normalizeDailymotionGeoPolicy(value: unknown): DailymotionGeoPolicy {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
    throw new Error('DAILYMOTION_INVALID_GEO_POLICY');
  const entries = (value as string[]).map((entry) => entry.trim().toLowerCase());
  let mode: 'allow' | 'deny' = 'allow';
  if (entries[0] === 'allow' || entries[0] === 'deny') mode = entries.shift() as 'allow' | 'deny';
  if (entries.some((country) => !ISO_COUNTRY.test(country)))
    throw new Error('DAILYMOTION_INVALID_GEO_POLICY');
  return {
    mode,
    countries: entries,
    worldwide: entries.length === 0,
  };
}

function verifiedEmbedPath(html: unknown, videoId: string): '/player.html' {
  if (typeof html !== 'string' || (html.match(/<iframe\b/gi) ?? []).length !== 1)
    throw new Error('DAILYMOTION_INVALID_OEMBED_HTML');
  const source = /<iframe\b[^>]*\bsrc=(?:"([^"]+)"|'([^']+)')[^>]*>/i.exec(html)?.slice(1).find(Boolean);
  if (!source) throw new Error('DAILYMOTION_INVALID_OEMBED_HTML');
  let url: URL;
  try {
    url = new URL(source.replaceAll('&amp;', '&'));
  } catch {
    throw new Error('DAILYMOTION_INVALID_OEMBED_HTML');
  }
  if (
    url.origin !== DAILYMOTION_EMBED_ORIGIN ||
    url.pathname !== '/player.html' ||
    url.username ||
    url.password ||
    url.port ||
    url.searchParams.getAll('video').length !== 1 ||
    url.searchParams.get('video') !== videoId ||
    url.searchParams.has('playlist')
  )
    throw new Error('DAILYMOTION_INVALID_OEMBED_HTML');
  return '/player.html';
}

function validateCandidate(candidate: DailymotionPublicEmbedCandidate): void {
  if (!VIDEO_ID.test(candidate.videoId)) throw new Error('DAILYMOTION_INVALID_VIDEO_ID');
  if (!OWNER_ID.test(candidate.publisher.ownerId)) throw new Error('DAILYMOTION_INVALID_OWNER_ID');
  if (!candidate.publisher.name.trim() || candidate.publisher.name.length > 200)
    throw new Error('DAILYMOTION_INVALID_PUBLISHER');
  if (
    !Number.isInteger(candidate.minimumDurationSeconds) ||
    candidate.minimumDurationSeconds < 1 ||
    candidate.minimumDurationSeconds > 24 * 60 * 60
  )
    throw new Error('DAILYMOTION_INVALID_DURATION_FLOOR');
  let profile: URL;
  try {
    profile = new URL(candidate.publisher.profileUrl);
  } catch {
    throw new Error('DAILYMOTION_INVALID_PUBLISHER_PROFILE');
  }
  const profileParts = profile.pathname.split('/').filter(Boolean);
  const expectedProfile = `${DAILYMOTION_OEMBED_ORIGIN}/${profileParts[0] ?? ''}`;
  if (profileParts.length !== 1 || !exactHttps(candidate.publisher.profileUrl, expectedProfile))
    throw new Error('DAILYMOTION_INVALID_PUBLISHER_PROFILE');
}

export async function verifyDailymotionPublicEmbed(
  candidate: DailymotionPublicEmbedCandidate,
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
): Promise<VerifiedDailymotionPublicEmbed> {
  validateCandidate(candidate);
  const watchUrl = `${DAILYMOTION_OEMBED_ORIGIN}/video/${candidate.videoId}`;
  const metadataUrl = new URL(`/video/${candidate.videoId}`, DAILYMOTION_PUBLIC_API_ORIGIN);
  metadataUrl.searchParams.set(
    'fields',
    'id,title,duration,allow_embed,url,published,status,owner,owner.screenname,owner.url,geoblocking',
  );
  const metadata = await boundedJson(
    await fetcher(metadataUrl, {
      redirect: 'manual',
      headers: { accept: 'application/json' },
      signal,
    }),
    'DAILYMOTION_METADATA',
  );
  if (
    metadata.id !== candidate.videoId ||
    !exactHttps(metadata.url, watchUrl) ||
    metadata.owner !== candidate.publisher.ownerId ||
    metadata['owner.screenname'] !== candidate.publisher.name ||
    !exactHttps(metadata['owner.url'], candidate.publisher.profileUrl) ||
    typeof metadata.title !== 'string' ||
    !metadata.title.trim()
  )
    throw new Error('DAILYMOTION_METADATA_IDENTITY_MISMATCH');
  if (candidate.expectedTitle !== undefined && metadata.title !== candidate.expectedTitle)
    throw new Error('DAILYMOTION_TITLE_MISMATCH');
  if (metadata.allow_embed !== true) throw new Error('DAILYMOTION_EMBED_DISABLED');
  if (metadata.published !== true || metadata.status !== 'published')
    throw new Error('DAILYMOTION_NOT_PUBLISHED');
  if (!Number.isInteger(metadata.duration) || (metadata.duration as number) < 1)
    throw new Error('DAILYMOTION_INVALID_DURATION');
  if ((metadata.duration as number) < candidate.minimumDurationSeconds)
    throw new Error('DAILYMOTION_DURATION_TOO_SHORT');
  const geoPolicy = normalizeDailymotionGeoPolicy(metadata.geoblocking);

  const oEmbedUrl = new URL('/services/oembed', DAILYMOTION_OEMBED_ORIGIN);
  oEmbedUrl.searchParams.set('url', watchUrl);
  oEmbedUrl.searchParams.set('format', 'json');
  oEmbedUrl.searchParams.set('maxwidth', '640');
  oEmbedUrl.searchParams.set('maxheight', '360');
  const oEmbed = await boundedJson(
    await fetcher(oEmbedUrl, {
      redirect: 'manual',
      headers: { accept: 'application/json' },
      signal,
    }),
    'DAILYMOTION_OEMBED',
  );
  if (
    oEmbed.type !== 'video' ||
    oEmbed.version !== '1.0' ||
    oEmbed.provider_name !== 'Dailymotion' ||
    !exactHttps(oEmbed.provider_url, DAILYMOTION_OEMBED_ORIGIN) ||
    oEmbed.title !== metadata.title ||
    oEmbed.author_name !== candidate.publisher.name ||
    !exactHttps(oEmbed.author_url, candidate.publisher.profileUrl)
  )
    throw new Error('DAILYMOTION_OEMBED_IDENTITY_MISMATCH');
  const embedPath = verifiedEmbedPath(oEmbed.html, candidate.videoId);

  return {
    kind: 'dailymotion-public-embed-candidate',
    videoId: candidate.videoId,
    watchUrl,
    title: metadata.title,
    durationSeconds: metadata.duration as number,
    publisher: candidate.publisher,
    geoPolicy,
    embedOrigin: DAILYMOTION_EMBED_ORIGIN,
    embedPath,
  };
}
