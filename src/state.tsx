import { createContext, useContext, type PropsWithChildren } from 'react';
import { useEpisodeComments, useHistory, usePreferences, useWatchedEpisodes, useWatchlist } from './lib/storage';

type AppStateValue = {
  watchlist: ReturnType<typeof useWatchlist>;
  history: ReturnType<typeof useHistory>;
  preferences: ReturnType<typeof usePreferences>;
  watched: ReturnType<typeof useWatchedEpisodes>;
  comments: ReturnType<typeof useEpisodeComments>;
};

const AppStateContext = createContext<AppStateValue | null>(null);

export function AppStateProvider({ children }: PropsWithChildren) {
  const watchlist = useWatchlist();
  const history = useHistory();
  const preferences = usePreferences();
  const watched = useWatchedEpisodes();
  const comments = useEpisodeComments();
  return (
    <AppStateContext.Provider value={{ watchlist, history, preferences, watched, comments }}>
      {children}
    </AppStateContext.Provider>
  );
}

export function useAppState(): AppStateValue {
  const value = useContext(AppStateContext);
  if (!value) throw new Error('useAppState must be used inside AppStateProvider');
  return value;
}
