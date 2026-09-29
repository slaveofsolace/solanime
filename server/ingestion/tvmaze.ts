import { load } from 'cheerio';
import { setTimeout as delay } from 'node:timers/promises';
import type { SqliteDatabase } from '../db.ts';
import { AppError } from '../errors.ts';
import type { CatalogueSnapshot, SnapshotEpisode, SnapshotTitle } from '../types.ts';
import { importSnapshot, type ImportResult } from './snapshot.ts';

const TVMAZE_API = 'https://api.tvmaze.com';
const SOURCE = 'tvmaze' as const;
const ANIMATION_GENRES = new Set(['animation', 'anime']);

type TvMazeImage = { medium?: string | null; original?: string | null } | null;

export interface TvMazeShow {
  id: number;
  url: string;
  name: string;
  type?: string | null;
  language?: string | null;
  genres?: string[];
  status?: string | null;
  premiered?: string | null;
  summary?: string | null;
  image?: TvMazeImage;
}

export interface TvMazeEpisode {
  id: number;
  url: string;
  name?: string | null;
  season?: number | null;
  number?: number | null;
  type?: string | null;
  airdate?: string | null;
  runtime?: number | null;
  image?: TvMazeImage;
}

export interface TvMazeSyncOptions {
  startPage?: number;
  pageLimit?: number;
  requestIntervalMs?: number;
  retries?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  onPage?: (progress: TvMazeSyncProgress) => void;
}

export interface TvMazeSyncProgress {
  page: number;
  nextPage: number;
  pagesImported: number;
  titlesImported: number;
  episodesImported: number;
  skippedAnimationTitles: number;
}

export interface TvMazeSyncResult extends TvMazeSyncProgress {
  status: 'paused' | 'complete';
}

function requiredId(value: unknown, field: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1)
    throw new AppError(422, 'UPSTREAM_CHANGED', `TVmaze ${field} is invalid.`);
  return number;
}

function requiredText(value: unknown, field: string, max = 2048): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new AppError(422, 'UPSTREAM_CHANGED', `TVmaze ${field} is invalid.`);
  return value.trim();
}

function httpsUrl(value: unknown, field: string): string {
  const text = requiredText(value, field, 4096);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new AppError(422, 'UPSTREAM_CHANGED', `TVmaze ${field} is not a URL.`);
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new AppError(422, 'UPSTREAM_CHANGED', `TVmaze ${field} must be a public HTTPS URL.`);
  return url.toString();
}

function optionalImage(image: TvMazeImage | undefined): string | null {
  const value = image?.original ?? image?.medium;
  if (!value) return null;
  return httpsUrl(value, 'image');
}

function plainSummary(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (value.length > 100_000)
    throw new AppError(422, 'UPSTREAM_CHANGED', 'TVmaze summary is unexpectedly large.');
  const text = load(`<body>${value}</body>`)('body').text().replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 20_000) : null;
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

export function isNonAnimeTvShow(show: TvMazeShow): boolean {
  const genres = Array.isArray(show.genres) ? show.genres : [];
  return !genres.some((genre) => ANIMATION_GENRES.has(String(genre).trim().toLowerCase()));
}

function episodeSort(episode: TvMazeEpisode): number {
  if (Number.isSafeInteger(episode.season) && Number.isSafeInteger(episode.number))
    return Number(episode.season) * 10_000 + Number(episode.number);
  return 1_000_000_000 + requiredId(episode.id, 'episode id');
}

function episodeNumber(episode: TvMazeEpisode): string {
  if (Number.isSafeInteger(episode.season) && Number.isSafeInteger(episode.number))
    return `S${episode.season} E${episode.number}`;
  return episode.type === 'significant_special' || episode.type === 'insignificant_special'
    ? 'Special'
    : String(requiredId(episode.id, 'episode id'));
}

export function tvMazeTitle(show: TvMazeShow, rawEpisodes: TvMazeEpisode[]): SnapshotTitle {
  const showId = requiredId(show.id, 'show id');
  const name = requiredText(show.name, 'show name', 1024);
  const canonicalUrl = httpsUrl(show.url, 'show URL');
  if (!Array.isArray(rawEpisodes))
    throw new AppError(422, 'UPSTREAM_CHANGED', 'TVmaze episodes must be an array.');
  const episodes = [...rawEpisodes].sort((a, b) => episodeSort(a) - episodeSort(b));
  const landscape = [...episodes].reverse().map((episode) => optionalImage(episode.image)).find(Boolean);
  const premiered = typeof show.premiered === 'string' ? show.premiered : null;
  const releaseYear = premiered && /^\d{4}-\d{2}-\d{2}$/.test(premiered)
    ? Number(premiered.slice(0, 4))
    : null;

  return {
    sourceId: String(showId),
    slug: `${slugify(name)}-tvmaze-${showId}`,
    canonicalUrl,
    name,
    description: plainSummary(show.summary),
    format: 'TV',
    releaseYear,
    status: typeof show.status === 'string' && show.status.trim() ? show.status.trim() : null,
    artworkUrl: landscape ?? optionalImage(show.image),
    artworkOrigin: landscape ? 'TVmaze episode image' : 'TVmaze show image',
    artworkReuseStatus: 'cc-by-sa',
    availability: 'observed',
    genres: (Array.isArray(show.genres) ? show.genres : []).map((genre) =>
      requiredText(genre, 'genre', 128),
    ),
    aliases: [],
    related: [],
    episodes: episodes.map<SnapshotEpisode>((episode) => {
      const id = requiredId(episode.id, 'episode id');
      const number = episodeNumber(episode);
      const episodeUrl = httpsUrl(episode.url, 'episode URL');
      const label = typeof episode.name === 'string' && episode.name.trim()
        ? episode.name.trim().slice(0, 1024)
        : null;
      return {
        sourceId: String(id),
        number,
        numberSort: episodeSort(episode),
        label,
        thumbnailUrl: optionalImage(episode.image),
        thumbnailOrigin: optionalImage(episode.image) ? episodeUrl : null,
        thumbnailReuseStatus: optionalImage(episode.image) ? 'cc-by-sa' : null,
        durationSeconds: Number.isSafeInteger(episode.runtime) && Number(episode.runtime) > 0 && Number(episode.runtime) <= 1440
          ? Number(episode.runtime) * 60 : null,
        seasonNumber: Number.isSafeInteger(episode.season) && Number(episode.season) >= 0 && Number(episode.season) <= 10000
          ? Number(episode.season) : null,
        slug: `${slugify(label ?? number)}-tvmaze-${id}`,
        canonicalUrl: episodeUrl,
        episodeType: episode.number == null ? 'special' : 'regular',
        availability: 'observed',
        versions: [
          {
            sourceId: `${id}:original`,
            language: 'original',
            label: show.language?.trim() || 'Original',
            audioLanguage: show.language?.trim().toLowerCase() || null,
            subtitleLanguage: null,
            availability: 'observed',
            providers: [],
          },
        ],
      };
    }),
  };
}

function retryAfterMs(response: Response, attempt: number): number {
  const header = response.headers.get('retry-after');
  if (header && /^\d+$/.test(header)) return Math.min(Number(header) * 1000, 30_000);
  return Math.min(750 * 2 ** attempt, 8_000);
}

function pacedFetcher(fetchImpl: typeof fetch, intervalMs: number, retries: number, signal?: AbortSignal) {
  let nextStart = 0;
  let queue = Promise.resolve();
  const reserve = () => {
    const pending = queue.then(async () => {
      signal?.throwIfAborted();
      const wait = Math.max(0, nextStart - Date.now());
      nextStart = Math.max(Date.now(), nextStart) + intervalMs;
      if (wait) await delay(wait, undefined, { signal });
    });
    queue = pending.catch(() => {});
    return pending;
  };
  return async (url: string): Promise<unknown> => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      await reserve();
      const response = await fetchImpl(url, {
        headers: { accept: 'application/json', 'user-agent': 'Solanime-school-catalogue-sync/0.7' },
        redirect: 'error',
        signal,
      });
      if (response.ok) {
        const body = await response.json().catch(() => null);
        if (body == null) throw new AppError(422, 'UPSTREAM_CHANGED', 'TVmaze returned malformed JSON.');
        return body;
      }
      if (response.status === 404) return null;
      if ((response.status === 429 || response.status >= 500) && attempt < retries) {
        await delay(retryAfterMs(response, attempt), undefined, { signal });
        continue;
      }
      throw new AppError(
        response.status === 429 ? 429 : 502,
        response.status === 429 ? 'UNAVAILABLE' : 'UPSTREAM_CHANGED',
        `TVmaze request failed with HTTP ${response.status}.`,
        { status: response.status, url },
      );
    }
    throw new AppError(502, 'UNAVAILABLE', 'TVmaze retry budget was exhausted.');
  };
}

function syncState(db: SqliteDatabase) {
  return db.prepare(
    'SELECT next_page AS nextPage,status,pages_imported AS pagesImported,titles_imported AS titlesImported,episodes_imported AS episodesImported FROM external_catalogue_sync WHERE source=?',
  ).get(SOURCE) as
    | { nextPage: number; status: string; pagesImported: number; titlesImported: number; episodesImported: number }
    | undefined;
}

export async function syncTvMaze(db: SqliteDatabase, options: TvMazeSyncOptions = {}): Promise<TvMazeSyncResult> {
  const pageLimit = options.pageLimit ?? 1;
  const intervalMs = options.requestIntervalMs ?? 550;
  const retries = options.retries ?? 3;
  if (!Number.isSafeInteger(pageLimit) || pageLimit < 1 || pageLimit > 1000)
    throw new Error('TVmaze pageLimit must be between 1 and 1000.');
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 50 || intervalMs > 60_000)
    throw new Error('TVmaze requestIntervalMs must be between 50 and 60000.');
  if (!Number.isSafeInteger(retries) || retries < 0 || retries > 8)
    throw new Error('TVmaze retries must be between 0 and 8.');

  const previous = syncState(db);
  let page = options.startPage ?? previous?.nextPage ?? 0;
  let pagesImported = previous?.pagesImported ?? 0;
  let titlesImported = previous?.titlesImported ?? 0;
  let episodesImported = previous?.episodesImported ?? 0;
  let skippedAnimationTitles = 0;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO external_catalogue_sync(source,next_page,status,pages_imported,titles_imported,episodes_imported,updated_at)
     VALUES (?,?,'running',?,?,?,?)
     ON CONFLICT(source) DO UPDATE SET next_page=excluded.next_page,status='running',last_error_code=NULL,last_error_message=NULL,updated_at=excluded.updated_at`,
  ).run(SOURCE, page, pagesImported, titlesImported, episodesImported, now);

  const read = pacedFetcher(options.fetchImpl ?? fetch, intervalMs, retries, options.signal);
  try {
    for (let imported = 0; imported < pageLimit; imported++) {
      options.signal?.throwIfAborted();
      const rawIndex = await read(`${TVMAZE_API}/shows?page=${page}`);
      if (rawIndex === null) {
        db.prepare("UPDATE external_catalogue_sync SET status='complete',updated_at=? WHERE source=?")
          .run(new Date().toISOString(), SOURCE);
        return { status: 'complete', page, nextPage: page, pagesImported, titlesImported, episodesImported, skippedAnimationTitles };
      }
      if (!Array.isArray(rawIndex))
        throw new AppError(422, 'UPSTREAM_CHANGED', 'TVmaze show index is not an array.');
      const accepted = (rawIndex as TvMazeShow[]).filter((show) => {
        requiredId(show?.id, 'show id');
        const include = isNonAnimeTvShow(show);
        if (!include) skippedAnimationTitles++;
        return include;
      });
      const titles = await Promise.all(
        accepted.map(async (show) => {
          const episodes = await read(`${TVMAZE_API}/shows/${requiredId(show.id, 'show id')}/episodes?specials=1`);
          if (!Array.isArray(episodes))
            throw new AppError(422, 'UPSTREAM_CHANGED', 'TVmaze episode inventory is not an array.');
          return tvMazeTitle(show, episodes as TvMazeEpisode[]);
        }),
      );
      const snapshot: CatalogueSnapshot = {
        schemaVersion: 1,
        source: SOURCE,
        observedAt: new Date().toISOString(),
        denominator: { scope: `TVmaze non-animation show index page ${page}` },
        titles,
      };
      const result: ImportResult = importSnapshot(db, snapshot);
      page++;
      pagesImported++;
      titlesImported += result.titles;
      episodesImported += result.episodes;
      const updated = new Date().toISOString();
      db.prepare(
        `UPDATE external_catalogue_sync SET next_page=?,status='running',pages_imported=?,titles_imported=?,episodes_imported=?,last_successful_import_at=?,updated_at=? WHERE source=?`,
      ).run(page, pagesImported, titlesImported, episodesImported, updated, updated, SOURCE);
      options.onPage?.({ page: page - 1, nextPage: page, pagesImported, titlesImported, episodesImported, skippedAnimationTitles });
    }
    db.prepare("UPDATE external_catalogue_sync SET status='paused',updated_at=? WHERE source=?")
      .run(new Date().toISOString(), SOURCE);
    return { status: 'paused', page: page - 1, nextPage: page, pagesImported, titlesImported, episodesImported, skippedAnimationTitles };
  } catch (error) {
    const code = error instanceof AppError ? error.code : error instanceof DOMException ? error.name : 'UNEXPECTED';
    const message = error instanceof Error ? error.message.slice(0, 2000) : 'Unknown TVmaze sync error.';
    db.prepare(
      "UPDATE external_catalogue_sync SET status='failed',last_error_code=?,last_error_message=?,updated_at=? WHERE source=?",
    ).run(code, message, new Date().toISOString(), SOURCE);
    throw error;
  }
}
