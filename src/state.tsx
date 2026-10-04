import { createContext, useContext, useState, type PropsWithChildren } from 'react';
import type { TitleSummary } from './types';
import { useAccount } from './account/AccountProvider';
import { useLocation, useNavigate } from 'react-router-dom';
import { withReturnTo } from './account/returnTo';
import {
  useEpisodeComments,
  useHistory,
  usePreferences,
  useWatchedEpisodes,
  useWatchlist,
} from './lib/storage';

type AppStateValue = {
  theater: boolean;
  setTheater: (value: boolean | ((current: boolean) => boolean)) => void;
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
  const auth = useAccount();
  const navigate = useNavigate();
  const location = useLocation();
  const requireProfile = () => {
    if (auth.ready && auth.account && auth.profile) return true;
    navigate(withReturnTo(auth.account ? '/profiles' : '/login', location.pathname + location.search));
    return false;
  };
  const [theater, setTheater] = useState(false);
  const [preview, setPreview] = useState<TitleSummary | null>(null);
  const watchlist = useWatchlist();
  const history = useHistory();
  const preferences = usePreferences();
  const watched = useWatchedEpisodes();
  const comments = useEpisodeComments();
  return (
    <AppStateContext.Provider
      value={{
        watchlist: { ...watchlist, toggle: (id, title) => { if (requireProfile()) watchlist.toggle(id, title); }, move: (id, listName) => { if (requireProfile()) watchlist.move(id, listName); } },
        history,
        preferences,
        watched: { ...watched, toggle: (id, language) => { if (requireProfile()) watched.toggle(id, language); } },
        comments: { ...comments, add: (id, author, body) => { if (requireProfile()) comments.add(id, author, body); } },
        preview,
        setPreview,
        theater,
        setTheater,
      }}
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
