import { setTimeout as delay } from 'node:timers/promises';
import type { SqliteDatabase } from '../db.ts';
import { AppError } from '../errors.ts';
import type { CatalogueSnapshot, SnapshotTitle } from '../types.ts';
import { importSnapshot } from './snapshot.ts';

const API_ENDPOINT = 'https://en.wikipedia.org/w/api.php';
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
// Anonymous MediaWiki `prop=extracts` responses complete at most 20 generated
// pages at once. Keeping the generator batch within that boundary prevents a
// single catalogue batch from being split into partial property responses that
// cannot be committed as a complete title snapshot.
const MAX_COMPLETE_GENERATOR_BATCH = 20;
const COMMONS_HOST = 'upload.wikimedia.org';
const QID = /^Q[1-9]\d*$/;
const GENRES = [
  'action',
  'adventure',
  'animation',
  'comedy',
  'crime',
  'documentary',
  'drama',
  'family',
  'fantasy',
  'historical',
  'horror',
  'musical',
  'mystery',
  'romance',
  'science fiction',
  'sports',
  'thriller',
  'war',
  'western',
] as const;

export type WikipediaMedia = 'movie' | 'tv';
type WikipediaSource = 'wikipedia-movie' | 'wikipedia-tv';

interface WikipediaImage {
  source?: string;
  width?: number;
  height?: number;
}

export interface WikipediaPage {
  pageid?: number;
  ns?: number;
  title?: string;
  extract?: string;
  pageprops?: {
    wikibase_item?: string;
    'wikibase-shortdesc'?: string;
  };
  original?: WikipediaImage;
  thumbnail?: WikipediaImage;
  categories?: Array<{ ns?: number; title?: string }>;
}

interface WikipediaResponse {
  batchcomplete?: boolean;
  continue?: { gcmcontinue?: string; continue?: string };
  query?: { pages?: WikipediaPage[] };
  error?: { code?: string; info?: string };
}

export interface ParsedWikipediaPage {
  titles: SnapshotTitle[];
  nextContinue: WikipediaContinuation | null;
  returnedPages: number;
  skippedMissingStableId: number;
  skippedAnime: number;
}

export interface WikipediaContinuation {
  gcmcontinue: string;
  continue: string;
}

export interface WikipediaSyncOptions {
  media?: WikipediaMedia;
  year?: number;
  batchLimit?: number;
  pageSize?: number;
  requestIntervalMs?: number;
  retries?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  onBatch?: (progress: WikipediaSyncProgress) => void;
}

export interface WikipediaSyncProgress {
  media: WikipediaMedia;
  year: number;
  batchesImported: number;
  titlesImported: number;
  skippedMissingStableId: number;
  skippedAnime: number;
  hasMore: boolean;
}

export interface WikipediaSyncResult extends WikipediaSyncProgress {
  status: 'paused' | 'complete';
}

function sourceKey(media: WikipediaMedia, year: number): string {
  return `wikipedia:${media}:${year}`;
}

function snapshotSource(media: WikipediaMedia): WikipediaSource {
  return media === 'movie' ? 'wikipedia-movie' : 'wikipedia-tv';
}

function category(media: WikipediaMedia, year: number): string {
  return media === 'movie'
    ? `Category:${year} films`
    : `Category:${year} television series debuts`;
}

function requiredText(value: unknown, field: string, max = 2048): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new AppError(422, 'UPSTREAM_CHANGED', `Wikipedia ${field} is invalid.`);
  return value.trim();
}

function pageUrl(title: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'untitled'
  );
}

function publicImage(value: WikipediaImage | undefined): { url: string; role: string } | null {
  if (!value?.source) return null;
  let url: URL;
  try {
    url = new URL(value.source);
  } catch {
    throw new AppError(422, 'UPSTREAM_CHANGED', 'Wikipedia page image is not a URL.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.hostname.toLowerCase() !== COMMONS_HOST
  )
    throw new AppError(
      422,
      'UPSTREAM_CHANGED',
      'Wikipedia page image must be a credential-free Wikimedia upload URL.',
    );
  const width = Number(value.width);
  const height = Number(value.height);
  const role = Number.isFinite(width) && Number.isFinite(height)
    ? height > width
      ? 'portrait poster candidate'
      : 'landscape backdrop candidate'
    : 'representative image of unknown role';
  return { url: url.toString(), role };
}

function categoriesFor(page: WikipediaPage): string[] {
  if (page.categories === undefined) return [];
  if (!Array.isArray(page.categories))
    throw new AppError(422, 'UPSTREAM_CHANGED', 'Wikipedia page categories are invalid.');
  return page.categories.map((entry) => requiredText(entry?.title, 'category title', 512));
}

function genresFrom(text: string): string[] {
  const normalized = text.toLowerCase();
  return GENRES.filter((genre) => new RegExp(`\\b${genre.replace(' ', '\\s+')}\\b`, 'i').test(normalized))
    .map((genre) => genre.replace(/\b\w/g, (character) => character.toUpperCase()));
}

export function buildWikipediaUrl(
  media: WikipediaMedia,
  year: number,
  pageSize: number,
  continuation?: WikipediaContinuation | null,
): string {
  if (media !== 'movie' && media !== 'tv') throw new Error('Wikipedia media must be movie or tv.');
  if (!Number.isSafeInteger(year) || year < 1900 || year > 2200)
    throw new Error('Wikipedia year must be between 1900 and 2200.');
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_COMPLETE_GENERATOR_BATCH)
    throw new Error(`Wikipedia pageSize must be between 1 and ${MAX_COMPLETE_GENERATOR_BATCH}.`);
  const url = new URL(API_ENDPOINT);
  const parameters: Record<string, string> = {
    action: 'query',
    generator: 'categorymembers',
    gcmtitle: category(media, year),
    gcmnamespace: '0',
    gcmlimit: String(pageSize),
    gcmsort: 'sortkey',
    gcmdir: 'ascending',
    prop: 'pageprops|extracts|pageimages|categories',
    exintro: '1',
    explaintext: '1',
    exsentences: '3',
    piprop: 'thumbnail|original',
    pithumbsize: '1000',
    pilicense: 'any',
    clshow: '!hidden',
    cllimit: 'max',
    format: 'json',
    formatversion: '2',
  };
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  if (continuation) {
    url.searchParams.set('gcmcontinue', continuation.gcmcontinue);
    url.searchParams.set('continue', continuation.continue);
  }
  return url.toString();
}

export function parseWikipediaResponse(
  raw: unknown,
  options: { media: WikipediaMedia; year: number },
): ParsedWikipediaPage {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new AppError(422, 'UPSTREAM_CHANGED', 'Wikipedia response is not an object.');
  const response = raw as WikipediaResponse;
  if (response.error)
    throw new AppError(
      422,
      'UPSTREAM_CHANGED',
      `Wikipedia API error: ${requiredText(response.error.code, 'error code', 128)}.`,
    );
  const pages = response.query?.pages ?? [];
  if (!Array.isArray(pages))
    throw new AppError(422, 'UPSTREAM_CHANGED', 'Wikipedia query.pages is not an array.');
  if (pages.length > 50)
    throw new AppError(422, 'UPSTREAM_CHANGED', 'Wikipedia returned too many pages for one batch.');

  const titles: SnapshotTitle[] = [];
  let skippedMissingStableId = 0;
  let skippedAnime = 0;
  for (const page of pages) {
    if (!page || typeof page !== 'object' || Array.isArray(page) || page.ns !== 0)
      throw new AppError(422, 'UPSTREAM_CHANGED', 'Wikipedia returned an invalid article page.');
    const qid = page.pageprops?.wikibase_item;
    if (typeof qid !== 'string' || !QID.test(qid)) {
      skippedMissingStableId++;
      continue;
    }
    const name = requiredText(page.title, 'article title', 1024);
    const articleCategories = categoriesFor(page);
    const shortDescription = page.pageprops?.['wikibase-shortdesc'] ?? '';
    const classification = `${shortDescription}\n${articleCategories.join('\n')}`;
    if (/\banime\b/i.test(classification)) {
      skippedAnime++;
      continue;
    }
    const image = publicImage(page.original ?? page.thumbnail);
    titles.push({
      sourceId: qid,
      slug: `${slugify(name)}-wikipedia-${qid.toLowerCase()}`,
      canonicalUrl: pageUrl(name),
      name,
      description:
        typeof page.extract === 'string' && page.extract.trim()
          ? page.extract.replace(/\s+/g, ' ').trim().slice(0, 20_000)
          : null,
      format: options.media === 'movie' ? 'Movie' : 'TV',
      releaseYear: options.year,
      status: articleCategories.some((value) => /Category:Upcoming\b/i.test(value))
        ? 'Upcoming'
        : null,
      artworkUrl: image?.url ?? null,
      artworkOrigin: image
        ? `English Wikipedia page image (${image.role}); file-specific reuse not established`
        : null,
      artworkReuseStatus: 'unknown',
      availability: 'observed',
      genres: genresFrom(classification),
      aliases: [],
      related: [],
      episodes: [],
    });
  }

  let nextContinue: WikipediaContinuation | null = null;
  if (response.continue !== undefined) {
    const continuationKeys = Object.keys(response.continue).sort();
    const gcmcontinue = response.continue.gcmcontinue;
    const genericContinue = response.continue.continue;
    if (
      response.batchcomplete !== true ||
      continuationKeys.length !== 2 ||
      continuationKeys[0] !== 'continue' ||
      continuationKeys[1] !== 'gcmcontinue' ||
      typeof gcmcontinue !== 'string' ||
      !gcmcontinue.trim() ||
      typeof genericContinue !== 'string' ||
      !genericContinue.trim()
    ) {
      const continuationSummary = continuationKeys.join(', ') || 'none';
      throw new AppError(
        422,
        'UPSTREAM_CHANGED',
        `Wikipedia returned an incomplete property batch (${continuationSummary}); no partial title snapshot was imported.`,
      );
    }
    nextContinue = { gcmcontinue, continue: genericContinue };
  }
  return {
    titles,
    nextContinue: nextContinue ?? null,
    returnedPages: pages.length,
    skippedMissingStableId,
    skippedAnime,
  };
}

function retryAfterMs(response: Response, attempt: number): number {
  const header = response.headers.get('retry-after');
  if (header && /^\d+$/.test(header)) return Math.min(Number(header) * 1000, 60_000);
  return Math.min(1_000 * 2 ** attempt, 10_000);
}

function pacedFetcher(fetchImpl: typeof fetch, intervalMs: number, retries: number, signal?: AbortSignal) {
  let nextStart = 0;
  return async (url: string): Promise<unknown> => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      signal?.throwIfAborted();
      const wait = Math.max(0, nextStart - Date.now());
      nextStart = Math.max(Date.now(), nextStart) + intervalMs;
      if (wait) await delay(wait, undefined, { signal });
      const response = await fetchImpl(url, {
        headers: {
          accept: 'application/json',
          'user-agent': 'Solanime-metadata-import/0.7 (bounded public Wikipedia category import)',
        },
        redirect: 'error',
        signal,
      });
      if (response.ok) {
        const declared = Number(response.headers.get('content-length') || 0);
        if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES)
          throw new AppError(422, 'UPSTREAM_CHANGED', 'Wikipedia response exceeds the import size limit.');
        const text = await response.text();
        if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES)
          throw new AppError(422, 'UPSTREAM_CHANGED', 'Wikipedia response exceeds the import size limit.');
        try {
          return JSON.parse(text);
        } catch {
          throw new AppError(422, 'UPSTREAM_CHANGED', 'Wikipedia returned malformed JSON.');
        }
      }
      if ((response.status === 429 || response.status >= 500) && attempt < retries) {
        await delay(retryAfterMs(response, attempt), undefined, { signal });
        continue;
      }
      throw new AppError(
        response.status === 429 ? 429 : 502,
        response.status === 429 ? 'UNAVAILABLE' : 'UPSTREAM_CHANGED',
        `Wikipedia request failed with HTTP ${response.status}.`,
        { status: response.status, url: API_ENDPOINT },
      );
    }
    throw new AppError(502, 'UNAVAILABLE', 'Wikipedia retry budget was exhausted.');
  };
}

function syncState(db: SqliteDatabase, key: string) {
  return db.prepare(
    'SELECT status,pages_imported AS batchesImported,titles_imported AS titlesImported,checkpoint_json AS checkpointJson FROM external_catalogue_sync WHERE source=?',
  ).get(key) as
    | { status: string; batchesImported: number; titlesImported: number; checkpointJson: string }
    | undefined;
}

function checkpoint(raw: string | undefined): WikipediaContinuation | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { gcmcontinue?: unknown; continue?: unknown };
    if (value.gcmcontinue === undefined || value.gcmcontinue === null) return null;
    if (typeof value.gcmcontinue !== 'string' || !value.gcmcontinue)
      throw new Error('invalid continuation');
    if (value.continue !== undefined && (typeof value.continue !== 'string' || !value.continue))
      throw new Error('invalid generic continuation');
    return { gcmcontinue: value.gcmcontinue, continue: value.continue ?? 'gcmcontinue||' };
  } catch {
    throw new AppError(422, 'UPSTREAM_CHANGED', 'Saved Wikipedia checkpoint is invalid.');
  }
}

export async function syncWikipedia(
  db: SqliteDatabase,
  options: WikipediaSyncOptions = {},
): Promise<WikipediaSyncResult> {
  const media = options.media ?? 'movie';
  const year = options.year ?? new Date().getUTCFullYear();
  const batchLimit = options.batchLimit ?? 1;
  const pageSize = options.pageSize ?? MAX_COMPLETE_GENERATOR_BATCH;
  const intervalMs = options.requestIntervalMs ?? 1_000;
  const retries = options.retries ?? 3;
  buildWikipediaUrl(media, year, pageSize);
  if (!Number.isSafeInteger(batchLimit) || batchLimit < 1 || batchLimit > 1000)
    throw new Error('Wikipedia batchLimit must be between 1 and 1000.');
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 100 || intervalMs > 60_000)
    throw new Error('Wikipedia requestIntervalMs must be between 100 and 60000.');
  if (!Number.isSafeInteger(retries) || retries < 0 || retries > 8)
    throw new Error('Wikipedia retries must be between 0 and 8.');

  const key = sourceKey(media, year);
  const previous = syncState(db, key);
  let nextContinue = checkpoint(previous?.checkpointJson);
  let batchesImported = previous?.batchesImported ?? 0;
  let titlesImported = previous?.titlesImported ?? 0;
  let skippedMissingStableId = 0;
  let skippedAnime = 0;
  db.prepare(
    `INSERT INTO external_catalogue_sync(source,next_page,status,pages_imported,titles_imported,episodes_imported,checkpoint_json,updated_at)
     VALUES (?,0,'running',?,?,0,?,?)
     ON CONFLICT(source) DO UPDATE SET status='running',last_error_code=NULL,last_error_message=NULL,updated_at=excluded.updated_at`,
  ).run(key, batchesImported, titlesImported, JSON.stringify(nextContinue ?? {}), new Date().toISOString());

  const read = pacedFetcher(options.fetchImpl ?? fetch, intervalMs, retries, options.signal);
  try {
    for (let imported = 0; imported < batchLimit; imported++) {
      options.signal?.throwIfAborted();
      const parsed = parseWikipediaResponse(
        await read(buildWikipediaUrl(media, year, pageSize, nextContinue)),
        { media, year },
      );
      const observedAt = new Date().toISOString();
      const snapshot: CatalogueSnapshot = {
        schemaVersion: 1,
        source: snapshotSource(media),
        observedAt,
        denominator: {
          scope: `English Wikipedia ${category(media, year)} public article members; one continuation batch of at most ${pageSize}`,
        },
        titles: parsed.titles,
      };
      const result = importSnapshot(db, snapshot);
      nextContinue = parsed.nextContinue;
      batchesImported++;
      titlesImported += result.titles;
      skippedMissingStableId += parsed.skippedMissingStableId;
      skippedAnime += parsed.skippedAnime;
      const updated = new Date().toISOString();
      const status = nextContinue ? 'running' : 'complete';
      db.prepare(
        `UPDATE external_catalogue_sync SET status=?,pages_imported=?,titles_imported=?,episodes_imported=0,checkpoint_json=?,last_successful_import_at=?,updated_at=? WHERE source=?`,
      ).run(status, batchesImported, titlesImported, JSON.stringify(nextContinue ?? {}), updated, updated, key);
      const progress = {
        media,
        year,
        batchesImported,
        titlesImported,
        skippedMissingStableId,
        skippedAnime,
        hasMore: Boolean(nextContinue),
      };
      options.onBatch?.(progress);
      if (!nextContinue) return { status: 'complete', ...progress };
    }
    db.prepare("UPDATE external_catalogue_sync SET status='paused',updated_at=? WHERE source=?")
      .run(new Date().toISOString(), key);
    return {
      status: 'paused',
      media,
      year,
      batchesImported,
      titlesImported,
      skippedMissingStableId,
      skippedAnime,
      hasMore: true,
    };
  } catch (error) {
    const code = error instanceof AppError ? error.code : error instanceof DOMException ? error.name : 'UNEXPECTED';
    const message = error instanceof Error ? error.message.slice(0, 2000) : 'Unknown Wikipedia sync error.';
    db.prepare(
      'UPDATE external_catalogue_sync SET status=\'failed\',last_error_code=?,last_error_message=?,updated_at=? WHERE source=?',
    ).run(code, message, new Date().toISOString(), key);
    throw error;
  }
}
