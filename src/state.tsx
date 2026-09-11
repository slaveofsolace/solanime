import { createContext, useContext, useState, type PropsWithChildren } from 'react';
import type { TitleSummary } from './types';
import {
  useEpisodeComments,
  useHistory,
  usePreferences,
  useWatchedEpisodes,
  useWatchlist,
} from './lib/storage';

type AppStateValue = {
  preview: TitleSummary | null;
  setPreview: (title: TitleSummary | null) => void;
  watchlist: ReturnType<typeof useWatchlist>;
  history: ReturnType<typeof useHistory>;
  preferences: ReturnType<typeof usePreferences>;
  watched: ReturnType<typeof useWatchedEpisodes>;
  comments: ReturnType<typeof useEpisodeComments>;
};

const AppStateContext = createContext<AppStateValue | null>(null);

export function AppStateProvider({ children }: PropsWithChildren) {
  const [preview, setPreview] = useState<TitleSummary | null>(null);
  const watchlist = useWatchlist();
  const history = useHistory();
  const preferences = usePreferences();
  const watched = useWatchedEpisodes();
  const comments = useEpisodeComments();
  return (
    <AppStateContext.Provider
      value={{ watchlist, history, preferences, watched, comments, preview, setPreview }}
    >
      {children}
    </AppStateContext.Provider>
  );
}

export function useAppState(): AppStateValue {
  const value = useContext(AppStateContext);
  if (!value) throw new Error('useAppState must be used inside AppStateProvider');
  return value;
}
