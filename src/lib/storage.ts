import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  EpisodeComment,
  Preferences,
  TitleSummary,
  WatchedEpisode,
  WatchHistoryEntry,
} from '../types';
import { DEFAULT_ACCENT, normalizeAccent } from './theme';
import { useStorageScope } from '../account/storageScope';
const PREFIX = 'sol-anime:';
export const defaultPreferences: Preferences = {
  preferredLanguage: 'sub',
  autoplayNext: false,
  rememberProgress: true,
  theme: 'dark',
  accent: DEFAULT_ACCENT,
  embedMode: 'compatible',
  motion: 'system',
};
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string';
const fields = (value: unknown, names: string[]): value is RecordValue =>
  record(value) && names.every((name) => text(value[name]));
const optionalText = (value: unknown): string | null => (text(value) ? value : null);
function title(value: unknown): TitleSummary | null {
  if (!fields(value, ['id', 'slug', 'name'])) return null;
  return {
    id: value.id as string,
    slug: value.slug as string,
    name: value.name as string,
    imageUrl: optionalText(value.imageUrl),
    posterUrl: optionalText(value.posterUrl),
    synopsis: optionalText(value.synopsis),
    type: optionalText(value.type),
    status: optionalText(value.status),
    releaseYear:
      typeof value.releaseYear === 'number' && Number.isFinite(value.releaseYear)
        ? value.releaseYear
        : null,
    episodeCount:
      typeof value.episodeCount === 'number' && value.episodeCount >= 0
        ? value.episodeCount
        : undefined,
    genres: Array.isArray(value.genres)
      ? value.genres.flatMap((genre) =>
          text(genre) ? [genre] : record(genre) && text(genre.name) ? [genre.name] : [],
        )
      : [],
  };
}
/** Validate existing browser records without discarding unrelated storage. */
export function decodeStored<T>(key: string, value: unknown, fallback: T): T {
  if (key === 'preferences') {
    const data = record(value) ? value : {};
    return {
      ...defaultPreferences,
      preferredLanguage:
        text(data.preferredLanguage) && /^[a-z-]{2,20}$/.test(data.preferredLanguage)
          ? data.preferredLanguage
          : 'sub',
      autoplayNext: typeof data.autoplayNext === 'boolean' ? data.autoplayNext : false,
      rememberProgress: typeof data.rememberProgress === 'boolean' ? data.rememberProgress : true,
      theme: data.theme === 'light' ? 'light' : 'dark',
      accent: normalizeAccent(data.accent),
      embedMode: data.embedMode === 'restricted' ? 'restricted' : 'compatible',
      motion: data.motion === 'reduced' ? 'reduced' : 'system',
    } as T;
  }
  if (key.startsWith('progress:'))
    return (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0) as T;
  if (!Array.isArray(value)) return fallback;
  if (key === 'watchlist-records') {
    const seen = new Set<string>();
    return value
      .flatMap((entry) => {
        const item = title(entry);
        if (!item || seen.has(item.id)) return [];
        seen.add(item.id);
        return [item];
      })
      .slice(0, 1000) as T;
  }
  if (key === 'history')
    return value
      .filter((entry) =>
        fields(entry, [
          'titleId',
          'slug',
          'title',
          'episodeId',
          'episodeLabel',
          'language',
          'watchedAt',
        ]),
      )
      .map((entry) => ({
        ...entry,
        imageUrl: optionalText(entry.imageUrl),
        position:
          typeof entry.position === 'number' && Number.isFinite(entry.position) && entry.position >= 0
            ? entry.position
            : undefined,
        duration:
          typeof entry.duration === 'number' && Number.isFinite(entry.duration) && entry.duration > 0
            ? entry.duration
            : undefined,
      }))
      .slice(0, 100) as T;
  if (key === 'watched-episodes')
    return value
      .filter((entry) => fields(entry, ['episodeId', 'language', 'watchedAt']))
      .slice(0, 10000) as T;
  if (key === 'episode-comments')
    return value
      .filter((entry) => fields(entry, ['id', 'episodeId', 'author', 'body', 'createdAt']))
      .map((entry) => ({
        ...entry,
        author: (entry.author as string).slice(0, 40),
        body: (entry.body as string).slice(0, 1000),
      }))
      .slice(0, 500) as T;
  return fallback;
}
function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw ? decodeStored(key, JSON.parse(raw), fallback) : fallback;
  } catch {
    return fallback;
  }
}
function writeStored<T>(key: string, value: T): void {
  try {
    const serialized = JSON.stringify(value);
    if (window.localStorage.getItem(PREFIX + key) !== serialized)
      window.localStorage.setItem(PREFIX + key, serialized);
  } catch {
    /* Storage may be disabled or full; the current session remains usable. */
  }
}
export function usePersistentState<T>(key: string, fallback: T) {
  const scope = useStorageScope();
  const [value, setValue] = useState<T>(() =>
    scope ? decodeStored(key, scope.read(key), fallback) : readStored(key, fallback),
  );
  // Reading a profile must not enqueue writes of untouched defaults. Apart from
  // needless traffic, those writes could still be running when the user navigates.
  const persistedValue = useRef(JSON.stringify(value));
  useEffect(() => {
    const serialized = JSON.stringify(value);
    if (serialized === persistedValue.current) return;
    persistedValue.current = serialized;
    if (scope) scope.write(key, value);
    else writeStored(key, value);
  }, [key, value, scope]);
  useEffect(() => {
    if (scope) {
      const receive = () => {
        const incoming = decodeStored(key, scope.read(key), fallback);
        persistedValue.current = JSON.stringify(incoming);
        setValue(incoming);
      };
      receive();
      return scope.subscribe(key, receive);
    }
    const incoming = readStored(key, fallback);
    persistedValue.current = JSON.stringify(incoming);
    setValue(incoming);
    const onStorage = (event: StorageEvent) => {
      if (event.key === PREFIX + key || event.key === null) {
        const next = readStored(key, fallback);
        persistedValue.current = JSON.stringify(next);
        setValue(next);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key, scope]);
  return [value, setValue] as const;
}
export function useWatchlist() {
  const [items, setItems] = usePersistentState<TitleSummary[]>('watchlist-records', []);
  const ids = useMemo(() => items.map((item) => item.id), [items]);
  const has = useCallback((id: string) => ids.includes(id), [ids]);
  const toggle = useCallback(
    (id: string, item?: TitleSummary) => {
      setItems((current) =>
        current.some((entry) => entry.id === id)
          ? current.filter((entry) => entry.id !== id)
          : item
            ? [item, ...current].slice(0, 1000)
            : current,
      );
    },
    [setItems],
  );
  return useMemo(() => ({ ids, items, has, toggle }), [ids, items, has, toggle]);
}
export function useHistory() {
  const [entries, setEntries] = usePersistentState<WatchHistoryEntry[]>('history', []);
  const remember = useCallback(
    (entry: WatchHistoryEntry) => {
      setEntries((current) =>
        [
          entry,
          ...current.filter(
            (item) => !(item.episodeId === entry.episodeId && item.language === entry.language),
          ),
        ].slice(0, 100),
      );
    },
    [setEntries],
  );
  const clear = useCallback(() => setEntries([]), [setEntries]);
  const remove = useCallback(
    (episodeId: string, language: string) => {
      setEntries((current) =>
        current.filter((item) => !(item.episodeId === episodeId && item.language === language)),
      );
    },
    [setEntries],
  );
  return useMemo(() => ({ entries, remember, remove, clear }), [entries, remember, remove, clear]);
}
export function useWatchedEpisodes() {
  const [entries, setEntries] = usePersistentState<WatchedEpisode[]>('watched-episodes', []);
  const isWatched = useCallback(
    (episodeId: string, language: string) =>
      entries.some((item) => item.episodeId === episodeId && item.language === language),
    [entries],
  );
  const toggle = useCallback(
    (episodeId: string, language: string) => {
      setEntries((current) =>
        current.some((item) => item.episodeId === episodeId && item.language === language)
          ? current.filter((item) => !(item.episodeId === episodeId && item.language === language))
          : [{ episodeId, language, watchedAt: new Date().toISOString() }, ...current].slice(
              0,
              10000,
            ),
      );
    },
    [setEntries],
  );
  return useMemo(() => ({ entries, isWatched, toggle }), [entries, isWatched, toggle]);
}
export function useEpisodeComments() {
  const [entries, setEntries] = usePersistentState<EpisodeComment[]>('episode-comments', []);
  const add = useCallback(
    (episodeId: string, author: string, body: string) => {
      const cleanBody = body.trim().slice(0, 1000);
      if (!cleanBody) return;
      const id =
        globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setEntries((current) =>
        [
          {
            id,
            episodeId,
            author: author.trim().slice(0, 40) || 'You',
            body: cleanBody,
            createdAt: new Date().toISOString(),
          },
          ...current,
        ].slice(0, 500),
      );
    },
    [setEntries],
  );
  const remove = useCallback(
    (id: string) => setEntries((current) => current.filter((item) => item.id !== id)),
    [setEntries],
  );
  const forEpisode = useCallback(
    (episodeId: string) => entries.filter((item) => item.episodeId === episodeId),
    [entries],
  );
  return useMemo(() => ({ entries, add, remove, forEpisode }), [entries, add, remove, forEpisode]);
}
export function usePreferences() {
  return usePersistentState<Preferences>('preferences', defaultPreferences);
}
export function readProgress(episodeId: string, language: string, sourceScope: string): number {
  return readStored<number>(`progress:${episodeId}:${language}:${sourceScope}`, 0);
}
export function writeProgress(
  episodeId: string,
  language: string,
  sourceScope: string,
  seconds: number,
): void {
  if (Number.isFinite(seconds) && seconds >= 0)
    writeStored(`progress:${episodeId}:${language}:${sourceScope}`, seconds);
}
