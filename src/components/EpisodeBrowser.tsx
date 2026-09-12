import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Episode } from '../types';
import { useAppState } from '../state';
import Icon from './Icon';
export const episodeName = (episode: Episode) =>
  episode.label ||
  episode.title ||
  (episode.number != null ? `Episode ${episode.number}` : 'Special');
export default function EpisodeBrowser({
  episodes,
  language,
  slug,
  currentId,
}: {
  episodes: Episode[];
  language: string;
  slug: string;
  currentId?: string;
}) {
  const { watched } = useAppState();
  const [query, setQuery] = useState(''),
    [page, setPage] = useState(0);
  const matches = useMemo(
    () =>
      episodes.filter(
        (e) =>
          (!language || e.versions.some((v) => v.language === language)) &&
          `${e.number ?? ''} ${episodeName(e)}`
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase()),
      ),
    [episodes, language, query],
  );
  const pages = Math.ceil(matches.length / 50),
    active = Math.min(page, Math.max(0, pages - 1));
  const visible = matches.slice(active * 50, active * 50 + 50);
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
        <span>{matches.length} episodes</span>
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
