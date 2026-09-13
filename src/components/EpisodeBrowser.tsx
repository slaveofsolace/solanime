import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Episode } from '../types';
import { useAppState } from '../state';
import Icon from './Icon';
export const episodeName = (episode: Episode) =>
  episode.label ||
  episode.title ||
  (episode.number != null ? `Episode ${episode.number}` : 'Special');
const episodeCountLabel = (count: number) => `${count} ${count === 1 ? 'episode' : 'episodes'}`;
interface EpisodeBrowserProps {
  episodes: Episode[];
  language: string;
  slug: string;
  currentId?: string;
}

export default function EpisodeBrowser(props: EpisodeBrowserProps) {
  // A new watch context resets the search/range, not an ordinary inventory refresh.
  return <EpisodeBrowserContent key={JSON.stringify([props.slug, props.language, props.currentId])} {...props} />;
}

function EpisodeBrowserContent({
  episodes,
  language,
  slug,
  currentId,
}: EpisodeBrowserProps) {
  const { watched } = useAppState();
  const [query, setQuery] = useState(''),
    [page, setPage] = useState<number | null>(null);
  const focusCurrentOnMount = useRef(false);
  const languageEpisodes = useMemo(
    () => episodes.filter((episode) => !language || episode.versions.some((version) => version.language === language)),
    [episodes, language],
  );
  const currentIndex = languageEpisodes.findIndex((episode) => episode.id === currentId);
  const currentPage = Math.floor(Math.max(0, currentIndex) / 50);
  const matches = useMemo(
    () =>
      languageEpisodes.filter(
        (e) =>
          `${e.number ?? ''} ${episodeName(e)}`
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase()),
      ),
    [languageEpisodes, query],
  );
  const pages = Math.ceil(matches.length / 50),
    active = Math.min(page ?? currentPage, Math.max(0, pages - 1));
  const visible = matches.slice(active * 50, active * 50 + 50);
  const canJumpToCurrent = currentIndex >= 0 && (query !== '' || !visible.some((episode) => episode.id === currentId));
  return (
    <div className="episode-browser">
      <div className="episode-toolbar">
        <label className="episode-search">
          <Icon name="search" />
          <span className="sr-only">Find an episode</span>
          <input
            type="search"
            value={query}
            placeholder="Find an episode"
            maxLength={100}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <span>{episodeCountLabel(matches.length)}</span>
        {canJumpToCurrent && (
          <button
            type="button"
            className="episode-current-jump"
            onClick={() => {
              focusCurrentOnMount.current = true;
              setQuery('');
              setPage(null);
            }}
          >
            Current episode
          </button>
        )}
      </div>
      {pages > 1 && (
        <div className="episode-ranges" role="group" aria-label="Episode range">
          {Array.from({ length: pages }, (_, i) => (
            <button type="button" key={i} aria-pressed={i === active} onClick={() => setPage(i)}>
              {i * 50 + 1}–{Math.min(matches.length, (i + 1) * 50)}
            </button>
          ))}
        </div>
      )}
      {visible.length ? (
        <ol className="episode-grid">
          {visible.map((e) => (
            <li key={e.id} data-current={currentId === e.id}>
              <Link
                ref={e.id === currentId ? (element) => {
                  if (element && focusCurrentOnMount.current) {
                    focusCurrentOnMount.current = false;
                    element.focus();
                  }
                } : undefined}
                to={`/watch/${encodeURIComponent(slug)}/${encodeURIComponent(e.id)}?language=${encodeURIComponent(language)}`}
                aria-current={e.id === currentId ? 'page' : undefined}
              >
                <span className="episode-number">{e.number ?? '—'}</span>
                <strong>{episodeName(e)}</strong>
                <span className="episode-play">
                  <Icon name="play" />
                </span>
              </Link>
              <button
                className="watched-toggle"
                type="button"
                aria-label={`${watched.isWatched(e.id, language) ? 'Mark unwatched' : 'Mark watched'}: ${episodeName(e)}`}
                aria-pressed={watched.isWatched(e.id, language)}
                onClick={() => watched.toggle(e.id, language)}
              >
                <Icon name="check" />
                <span>{watched.isWatched(e.id, language) ? 'Watched' : 'Mark watched'}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <div className="library-empty">
          <h3>No matching episodes</h3>
          <p>Try another number or language version.</p>
        </div>
      )}
    </div>
  );
}
