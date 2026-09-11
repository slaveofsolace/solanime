import { useCallback, useEffect, useState } from 'react';
import type { EpisodeComment, Preferences, TitleSummary, WatchedEpisode, WatchHistoryEntry } from '../types';

const PREFIX = 'sol-anime:';

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeStored<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // The application remains usable when storage is disabled or full.
  }
}

export function usePersistentState<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => readStored(key, fallback));
  useEffect(() => writeStored(key, value), [key, value]);
  return [value, setValue] as const;
}

export function useWatchlist() {
  const [items, setItems] = usePersistentState<TitleSummary[]>('watchlist-records', []);
  const ids = items.map((item) => item.id);
  const toggle = useCallback((id: string, record?: TitleSummary) => {
    setItems((current) => current.some((item) => item.id === id)
      ? current.filter((item) => item.id !== id)
      : record ? [record, ...current] : current);
  }, [setItems]);
  return { ids, items, toggle, has: (id: string) => ids.includes(id) };
}

export function useHistory() {
  const [entries, setEntries] = usePersistentState<WatchHistoryEntry[]>('history', []);
  const remember = useCallback((entry: WatchHistoryEntry) => {
    setEntries((current) => [entry, ...current.filter((item) => !(
      item.episodeId === entry.episodeId && item.language === entry.language
    ))].slice(0, 100));
  }, [setEntries]);
  const clear = useCallback(() => setEntries([]), [setEntries]);
  const remove = useCallback((episodeId: string, language: string) => {
    setEntries((current) => current.filter((item) => !(item.episodeId === episodeId && item.language === language)));
  }, [setEntries]);
  return { entries, remember, remove, clear };
}

export function useWatchedEpisodes() {
  const [entries, setEntries] = usePersistentState<WatchedEpisode[]>('watched-episodes', []);
  const isWatched = useCallback((episodeId: string, language: string) => entries.some((item) => item.episodeId === episodeId && item.language === language), [entries]);
  const toggle = useCallback((episodeId: string, language: string) => {
    setEntries((current) => current.some((item) => item.episodeId === episodeId && item.language === language)
      ? current.filter((item) => !(item.episodeId === episodeId && item.language === language))
      : [{ episodeId, language, watchedAt: new Date().toISOString() }, ...current]);
  }, [setEntries]);
  return { entries, isWatched, toggle };
}

export function useEpisodeComments() {
  const [entries, setEntries] = usePersistentState<EpisodeComment[]>('episode-comments', []);
  const add = useCallback((episodeId: string, author: string, body: string) => {
    const cleanBody = body.trim().slice(0, 1000);
    if (!cleanBody) return;
    const cleanAuthor = author.trim().slice(0, 40) || 'Guest';
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setEntries((current) => [{ id, episodeId, author: cleanAuthor, body: cleanBody, createdAt: new Date().toISOString() }, ...current].slice(0, 500));
  }, [setEntries]);
  const remove = useCallback((id: string) => setEntries((current) => current.filter((item) => item.id !== id)), [setEntries]);
  const forEpisode = useCallback((episodeId: string) => entries.filter((item) => item.episodeId === episodeId), [entries]);
  return { entries, add, remove, forEpisode };
}

export const defaultPreferences: Preferences = {
  preferredLanguage: 'sub',
  autoplayNext: false,
  rememberProgress: true,
  theme: 'dark',
};

export function usePreferences() {
  return usePersistentState<Preferences>('preferences', defaultPreferences);
}

export function readProgress(episodeId: string, language: string, sourceScope: string): number {
  return readStored<number>(`progress:${episodeId}:${language}:${sourceScope}`, 0);
}

export function writeProgress(episodeId: string, language: string, sourceScope: string, seconds: number): void {
  writeStored(`progress:${episodeId}:${language}:${sourceScope}`, seconds);
}
