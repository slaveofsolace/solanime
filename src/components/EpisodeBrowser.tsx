import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Episode, TitleSummary } from '../types';
import { useAppState } from '../state';
import Icon from './Icon';
import { viewingPercent } from '../lib/continueWatching';

const PAGE_SIZE = 50;

export const episodeName = (episode: Episode) =>
  episode.title ||
  episode.label ||
  (episode.number != null ? `Episode ${episode.number}` : 'Special');
const episodeCountLabel = (count: number) => `${count} ${count === 1 ? 'episode' : 'episodes'}`;

function EpisodeArtwork({ episode }: { episode: Episode }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [episode.thumbnailUrl]);
  if (episode.thumbnailUrl && !failed) return <img src={episode.thumbnailUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
  const number = episode.number == null ? 'SP' : String(episode.number).padStart(2, '0');
  return <span className="episode-thumbnail__fallback" aria-hidden="true"><small>{episode.number == null ? 'SPECIAL' : 'EPISODE'}</small><strong>{number}</strong></span>;
}

function episodeSeason(episode: Episode) {
  if (Number.isInteger(episode.seasonNumber) && Number(episode.seasonNumber) >= 0) return episode.seasonNumber!;
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
  title?: TitleSummary;
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
  const { watched, history } = useAppState();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(''),
    [page, setPage] = useState<number | null>(null),
    [selectedSeason, setSelectedSeason] = useState<string | null>(params.get('season'));
  const focusCurrentOnMount = useRef(false);
  const routeSeason = params.get('season');
  useEffect(() => { setSelectedSeason(routeSeason); setPage(null); }, [routeSeason]);
  const languageEpisodes = useMemo(
    () => episodes.filter((episode) => !language || episode.versions.some((version) => version.language === language)),
    [episodes, language],
  );
  const compactWithoutStills = !currentId && languageEpisodes.length >= 6 &&
    languageEpisodes.filter((episode) => Boolean(episode.thumbnailUrl)).length < languageEpisodes.length / 2;
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
        label: season === 0 ? 'Specials' : `Season ${season}`,
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
    <div className={`episode-browser episode-browser--${currentId ? 'sidebar' : 'cards'}${compactWithoutStills ? ' episode-browser--compact' : ''}`}>
      <div className="episode-controls">
      {seasonGroups && (
        <label className="episode-season-picker">
          <span>Season</span>
          <select aria-label="Season" value={activeSeason} onChange={(event) => {
            setQuery('');
            setSelectedSeason(event.target.value);
            setPage(0);
            const next = new URLSearchParams(params);
            next.set('season', event.target.value);
            setParams(next);
          }}>
            <option value="all">All episodes · {languageEpisodes.length}</option>
            {seasonGroups.map((group) => <option key={group.key} value={group.key}>{group.label} · {group.episodes.length}</option>)}
          </select>
          {normalizedQuery && <small>Searching every season</small>}
        </label>
      )}
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
              const next = new URLSearchParams(params);
              next.delete('season');
              setParams(next, { replace: true });
            }}
          >
            Current episode
          </button>
        )}
      </div>}
      </div>
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
            const record = history?.entries.find(entry => entry.episodeId === e.id && entry.language === language);
            const percent = record ? viewingPercent(record) : 0;
            const seen = watched.isWatched(e.id, language) || percent >= 95;
            const version = e.versions.find(item => item.language === language);
            const mapped = Boolean(version?.providerCount);
            const duration = e.durationSeconds ?? record?.duration;
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
                to={`/watch/${encodeURIComponent(slug)}/${encodeURIComponent(e.id)}?language=${encodeURIComponent(language)}${seasonGroups && activeSeason !== 'all' ? `&season=${activeSeason}` : ''}`}
                aria-current={e.id === currentId ? 'page' : undefined}
              >
                <span className="episode-thumbnail">
                  <EpisodeArtwork episode={e} />
                  <span className="episode-play"><Icon name={mapped ? 'play' : 'info'} /></span>
                  {duration != null && duration > 0 && <span className="episode-duration">{Math.ceil(duration / 60)}m</span>}
                  {percent > 0 && <span className="episode-progress" role="progressbar" aria-label={`${displayName} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}><span style={{ width: `${percent}%` }} /></span>}
                </span>
                <span className="episode-copy">
                  {!repeatedNumber && <span className="episode-number">{e.number == null ? 'Special' : /^\d+(?:\.\d+)?$/.test(String(e.number)) ? `E${e.number}` : e.number}</span>}
                  <strong>{displayName}</strong>
                  <span className="episode-meta">{currentId === e.id ? 'Now selected' : seen ? 'Watched' : percent > 0 ? `${Math.round(percent)}% watched` : language === 'sub' ? 'Subtitled' : language === 'dub' ? 'Dubbed' : language}{!mapped && ' · Source unavailable'}</span>
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
