import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Episode } from '../types';
import { useAppState } from '../state';
import Icon from './Icon';

const PAGE_SIZE = 50;

export const episodeName = (episode: Episode) =>
  episode.label ||
  episode.title ||
  (episode.number != null ? `Episode ${episode.number}` : 'Special');
const episodeCountLabel = (count: number) => `${count} ${count === 1 ? 'episode' : 'episodes'}`;

function episodeSeason(episode: Episode) {
  const candidates = [episode.number, episode.label, episode.title].filter(
    (value): value is string | number => value != null,
  );
  for (const candidate of candidates) {
    const value = String(candidate).trim();
    const match =
      /^s(?:eason)?[\s._-]*(\d{1,3})[\s._:-]*e(?:pisode)?[\s._-]*\d+/i.exec(value) ??
      /^season[\s._-]+(\d{1,3})(?:[\s._:-]+episode[\s._-]+\d+)/i.exec(value);
    if (match) return Number(match[1]);
  }
  return null;
}
interface EpisodeBrowserProps {
  episodes: Episode[];
  language: string;
  slug: string;
  currentId?: string;
  /** Hide the unfiltered count when a parent heading already shows it. */
  compactHeading?: boolean;
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
  compactHeading = false,
}: EpisodeBrowserProps) {
  const { watched } = useAppState();
  const [query, setQuery] = useState(''),
    [page, setPage] = useState<number | null>(null),
    [selectedSeason, setSelectedSeason] = useState<string | null>(null);
  const focusCurrentOnMount = useRef(false);
  const languageEpisodes = useMemo(
    () => episodes.filter((episode) => !language || episode.versions.some((version) => version.language === language)),
    [episodes, language],
  );
  const seasonGroups = useMemo(() => {
    const parsed = languageEpisodes.map((episode) => ({ episode, season: episodeSeason(episode) }));
    const seasons = new Set(parsed.flatMap(({ season }) => (season == null ? [] : [season])));
    if (seasons.size < 2 || parsed.filter(({ season }) => season != null).length / Math.max(1, parsed.length) < 0.7) {
      return null;
    }
    const groups = [...seasons]
      .sort((a, b) => a - b)
      .map((season) => ({
        key: `season-${season}`,
        label: `Season ${season}`,
        episodes: parsed.filter((item) => item.season === season).map((item) => item.episode),
      }));
    const extras = parsed.filter((item) => item.season == null).map((item) => item.episode);
    if (extras.length) groups.push({ key: 'extras', label: 'Extras', episodes: extras });
    return groups;
  }, [languageEpisodes]);
  const currentSeason = seasonGroups?.find((group) => group.episodes.some((episode) => episode.id === currentId));
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const selectedGroup = seasonGroups?.find((group) => group.key === selectedSeason);
  const activeSeason = normalizedQuery
    ? 'all'
    : selectedSeason === 'all'
      ? 'all'
      : (selectedGroup?.key ?? currentSeason?.key ?? seasonGroups?.[0]?.key ?? 'all');
  const scopedEpisodes =
    activeSeason === 'all'
      ? languageEpisodes
      : (seasonGroups?.find((group) => group.key === activeSeason)?.episodes ?? languageEpisodes);
  const matches = useMemo(
    () =>
      scopedEpisodes.filter(
        (e) =>
          `${e.number ?? ''} ${episodeName(e)}`
            .toLocaleLowerCase()
            .includes(normalizedQuery),
      ),
    [normalizedQuery, scopedEpisodes],
  );
  const currentIndex = matches.findIndex((episode) => episode.id === currentId);
  const currentPage = Math.floor(Math.max(0, currentIndex) / PAGE_SIZE);
  const pages = Math.ceil(matches.length / PAGE_SIZE),
    active = Math.min(page ?? currentPage, Math.max(0, pages - 1));
  const visible = matches.slice(active * PAGE_SIZE, active * PAGE_SIZE + PAGE_SIZE);
  const currentExists = languageEpisodes.some((episode) => episode.id === currentId);
  const canJumpToCurrent =
    currentExists && (normalizedQuery !== '' || !visible.some((episode) => episode.id === currentId));
  const showToolbar = languageEpisodes.length > 1 || normalizedQuery !== '';
  const showResultCount = !compactHeading || normalizedQuery !== '';
  return (
    <div className="episode-browser">
      {showToolbar && <div className="episode-toolbar">
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
        {showResultCount && <span className="episode-result-count" aria-live="polite">{episodeCountLabel(matches.length)}</span>}
        {canJumpToCurrent && (
          <button
            type="button"
            className="episode-current-jump"
            onClick={() => {
              focusCurrentOnMount.current = true;
              setQuery('');
              setSelectedSeason(null);
              setPage(null);
            }}
          >
            Current episode
          </button>
        )}
      </div>}
      {seasonGroups && (
        <label className="episode-season-picker">
          <span>Season</span>
          <select
            aria-label="Season"
            value={activeSeason}
            onChange={(event) => {
              setQuery('');
              setSelectedSeason(event.target.value);
              setPage(0);
            }}
          >
            <option value="all">All episodes · {languageEpisodes.length}</option>
            {seasonGroups.map((group) => (
              <option key={group.key} value={group.key}>
                {group.label} · {group.episodes.length}
              </option>
            ))}
          </select>
          {normalizedQuery && <small>Searching every season</small>}
        </label>
      )}
      {pages > 1 && (
        <div className="episode-ranges" role="group" aria-label="Episode range">
          {Array.from({ length: pages }, (_, i) => (
            <button type="button" key={i} aria-pressed={i === active} onClick={() => setPage(i)}>
              {i * PAGE_SIZE + 1}–{Math.min(matches.length, (i + 1) * PAGE_SIZE)}
            </button>
          ))}
        </div>
      )}
      {visible.length ? (
        <ol className="episode-grid">
          {visible.map((e) => {
            const displayName = episodeName(e);
            const episodeNumber = e.number == null ? null : String(e.number).trim();
            const repeatedNumber = Boolean(
              episodeNumber &&
                (displayName.trim().toLocaleLowerCase() === episodeNumber.toLocaleLowerCase() ||
                  displayName.trim().toLocaleLowerCase() === `episode ${episodeNumber}`.toLocaleLowerCase() ||
                  displayName.trim().toLocaleLowerCase() === `ep ${episodeNumber}`.toLocaleLowerCase() ||
                  displayName.trim().toLocaleLowerCase().startsWith(`${episodeNumber.toLocaleLowerCase()} ·`)),
            );
            return <li key={e.id} data-current={currentId === e.id}>
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
                {!repeatedNumber && <span className="episode-number">{e.number ?? '—'}</span>}
                <strong>{displayName}</strong>
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
            </li>;
          })}
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
