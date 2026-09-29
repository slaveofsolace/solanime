import type { Episode, WatchHistoryEntry } from '../types';
import { latestBySeries, viewingPercent } from './continueWatching';

type WatchEntry = {
  episode: Episode;
  language: string;
  label: 'Start watching' | 'Continue watching' | 'Watch again' | 'Open first episode';
};

/** One series-level entry point for spotlight, preview, and title actions. */
export function chooseWatchEntry(
  titleId: string,
  episodes: readonly Episode[],
  history: readonly WatchHistoryEntry[],
  preferredLanguage: string,
): WatchEntry | null {
  const recent = latestBySeries(history).find((entry) => entry.titleId === titleId);
  if (recent) {
    const matching = episodes.filter((episode) =>
      episode.versions.some((version) => version.language === recent.language),
    );
    const index = matching.findIndex((episode) => episode.id === recent.episodeId);
    if (index >= 0) {
      const completed = viewingPercent(recent) >= 95;
      const next = completed ? matching[index + 1] : undefined;
      return {
        episode: next ?? matching[index],
        language: recent.language,
        label: completed && !next ? 'Watch again' : 'Continue watching',
      };
    }
  }

  const first = episodes[0];
  if (!first) return null;
  const version = first.versions.find((item) => item.language === preferredLanguage)
    ?? first.versions.find((item) => item.providerCount > 0)
    ?? first.versions[0];
  if (!version) return null;
  return {
    episode: first,
    language: version.language,
    label: version.providerCount > 0 ? 'Start watching' : 'Open first episode',
  };
}

export function watchEntryPath(slug: string, entry: WatchEntry): string {
  return `/watch/${encodeURIComponent(slug)}/${encodeURIComponent(entry.episode.id)}?language=${encodeURIComponent(entry.language)}`;
}
