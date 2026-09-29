import { useEffect, useMemo, useState } from 'react';
import type { WatchHistoryEntry } from '../types';
import { api } from './api';
import { latestBySeries, viewingPercent } from './continueWatching';
import { episodeName } from '../components/EpisodeBrowser';

type ContinueEntry = WatchHistoryEntry & { nextUp?: boolean; completedEpisodeId?: string };

/** Derived recommendations are never written as viewing history. Fetch only visible completed series. */
export function useContinueWatching(entries: readonly WatchHistoryEntry[]) {
  const latest = useMemo(() => latestBySeries(entries).filter(entry => !entry.continueHidden).slice(0, 8), [entries]);
  const key = JSON.stringify(latest);
  const [resolved, setResolved] = useState<{ key: string; items: ContinueEntry[] } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    void Promise.all(latest.map(async (entry): Promise<ContinueEntry | null> => {
      if (viewingPercent(entry) < 95) return entry;
      try {
        const detail = await api.title(entry.slug, abort.signal);
        const episodes = detail.episodes.filter(item => item.versions.some(version => version.language === entry.language));
        const index = episodes.findIndex(item => item.id === entry.episodeId);
        const next = index < 0 ? undefined : episodes[index + 1];
        if (!next) return null;
        return { ...entry, episodeId: next.id, episodeLabel: episodeName(next),
          position: undefined, duration: undefined, nextUp: true, completedEpisodeId: entry.episodeId };
      } catch { return null; }
    })).then(items => {
      if (!abort.signal.aborted) setResolved({ key, items: items.filter((item): item is ContinueEntry => item !== null) });
    });
    return () => abort.abort();
  }, [key]);
  return resolved?.key === key ? resolved.items : latest.filter(entry => viewingPercent(entry) < 95) as ContinueEntry[];
}
