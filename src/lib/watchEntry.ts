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
  /** Episodes the viewer marked watched count as finished, like a completed history entry. */
  isWatched: (episodeId: string, language: string) => boolean = () => false,
): WatchEntry | null {
  const recent = latestBySeries(history).find((entry) => entry.titleId === titleId);
  if (recent) {
    const matching = episodes.filter((episode) =>
      episode.versions.some((version) => version.language === recent.language),
    );
    const index = matching.findIndex((episode) => episode.id === recent.episodeId);
    if (index >= 0) {
      const completed = viewingPercent(recent) >= 95 || isWatched(recent.episodeId, recent.language);
      // Skip ahead past any later episodes already marked watched.
      const next = completed
        ? matching.slice(index + 1).find((episode) => !isWatched(episode.id, recent.language))
        : undefined;
      return {
        episode: next ?? matching[index],
        language: recent.language,
        label: completed && !next ? 'Watch again' : 'Continue watching',
      };
    }
  }

  const opening = episodes[0];
  if (!opening) return null;
  const version = opening.versions.find((item) => item.language === preferredLanguage)
    ?? opening.versions.find((item) => item.providerCount > 0)
    ?? opening.versions[0];
  if (!version) return null;
  // Without history, start at the first episode not already marked watched.
  const unwatched = episodes.find((episode) =>
    episode.versions.some((item) => item.language === version.language) && !isWatched(episode.id, version.language));
  const first = unwatched ?? opening;
  const marked = first !== opening;
  return {
    episode: first,
    language: version.language,
    label: marked ? 'Continue watching' : version.providerCount > 0 ? 'Start watching' : 'Open first episode',
  };
}

export function watchEntryPath(slug: string, entry: WatchEntry): string {
  return `/watch/${encodeURIComponent(slug)}/${encodeURIComponent(entry.episode.id)}?language=${encodeURIComponent(entry.language)}`;
}
