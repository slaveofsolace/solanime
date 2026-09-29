import type { WatchHistoryEntry } from '../types';

export function viewingPercent(entry: Pick<WatchHistoryEntry, 'position' | 'duration'>) {
  if (!Number.isFinite(entry.position) || !Number.isFinite(entry.duration) || !entry.duration) return 0;
  return Math.max(0, Math.min(100, (entry.position ?? 0) / entry.duration * 100));
}

/** Consolidate before filtering: completing episode 9 must not revive episode 1. */
export function latestBySeries(entries: readonly WatchHistoryEntry[]) {
  const latest = new Map<string, WatchHistoryEntry>();
  for (const entry of entries) {
    if (!Number.isFinite(Date.parse(entry.watchedAt))) continue;
    const previous = latest.get(entry.titleId);
    if (!previous || Date.parse(entry.watchedAt) > Date.parse(previous.watchedAt)) latest.set(entry.titleId, entry);
  }
  return [...latest.values()].sort((a, b) => Date.parse(b.watchedAt) - Date.parse(a.watchedAt));
}
export function continueWatching(entries: readonly WatchHistoryEntry[]) {
  return latestBySeries(entries).filter(entry => !entry.continueHidden && viewingPercent(entry) < 95);
}
