import { useAccount } from '../account/AccountProvider';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { TitleCard } from '../components/ui';
import SelectControl from '../components/SelectControl';
import Icon from '../components/Icon';
import Dialog, { markDialogTrigger } from '../components/Dialog';
import HistoryActions from '../components/HistoryActions';
import MyAnimeListLibrary from '../components/MyAnimeListLibrary';
import { useAppState } from '../state';
import { latestBySeries, viewingPercent } from '../lib/continueWatching';

function progress(position?: number, duration?: number) {
  if (!duration || !position) return 0;
  return Math.max(0, Math.min(100, (position / duration) * 100));
}

export default function LibraryPage() {
  const { hash } = useLocation();
  const [params, setParams] = useSearchParams();
  const view = hash === '#history-title' ? 'history' : hash === '#mal-list' ? 'list'
    : params.get('view') === 'history' ? 'history' : 'list';
  const historyHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (hash !== '#history-title') return;
    const frame = requestAnimationFrame(() => {
      historyHeading.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
      historyHeading.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [hash, view]);
  const { profile } = useAccount();
  const { watchlist, history } = useAppState();
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyLimit, setHistoryLimit] = useState(20);
  const [clearForProfile, setClearForProfile] = useState<string | null>(null);
  useEffect(() => { setHistoryQuery(''); setHistoryLimit(20); setClearForProfile(null); }, [profile?.id]);
  const matchingHistory = history.entries.filter(entry =>
    `${entry.title} ${entry.episodeLabel} ${entry.language}`.toLocaleLowerCase().includes(historyQuery.trim().toLocaleLowerCase()));
  const latestHistory = new Map(latestBySeries(history.entries).map(entry => [entry.titleId, entry]));
  const startedTitles = new Set(history.entries.map(entry => entry.titleId));
  const formats = [...new Set(watchlist.items.map(item => item.type?.trim()).filter((type): type is string => Boolean(type)))].sort();
  const format = formats.includes(params.get('type') ?? '') ? params.get('type')! : '';
  const filter = ['started', 'not-started'].includes(params.get('progress') ?? '') ? params.get('progress')! : '';
  const sort = params.get('sort') === 'title' ? 'title' : 'saved';
  const savedTitles = watchlist.items.filter(item => (!format || item.type?.trim() === format) &&
    (!filter || (filter === 'started' ? startedTitles.has(item.id) : !startedTitles.has(item.id))));
  if (sort === 'title') savedTitles.sort((a, b) => (a.name ?? a.title ?? '').localeCompare(b.name ?? b.title ?? ''));
  const changeSavedFilter = (key: string, value: string) => {
    setParams(current => {
      const next = new URLSearchParams(current);
      next.set('view', 'list');
      if (value) next.set(key, value); else next.delete(key);
      return next;
    });
  };
  return (
    <div className="library-page">
      <header className="library-heading">
        <div>
          <h1>Library</h1>
        </div>
      </header>
      <nav className="library-navigation" aria-label="Library views">
        <Link to="/library?view=list" aria-current={view === 'list' ? 'page' : undefined}>My List</Link>
        <Link to="/library?view=history" aria-current={view === 'history' ? 'page' : undefined}>History</Link>
      </nav>

      {view === 'list' && <section className="library-section library-saved" aria-labelledby="watchlist-title">
        <h2 id="watchlist-title" className="sr-only">My List</h2>
        {watchlist.items.length ? (
          <>
          <div className="library-toolbar">
            <p className="library-result-count" aria-live="polite">{savedTitles.length} {savedTitles.length === 1 ? 'title' : 'titles'}</p>
            <div className="library-filters">
              <label><span className="sr-only">Filter saved titles</span>
                <SelectControl value={filter} onChange={event => changeSavedFilter('progress', event.target.value)}>
                  <option value="">All titles</option><option value="started">Started</option><option value="not-started">Not started</option>
                </SelectControl>
              </label>
              {formats.length > 1 && <label><span className="sr-only">Saved title format</span>
                <SelectControl value={format} onChange={event => changeSavedFilter('type', event.target.value)}>
                  <option value="">All formats</option>{formats.map(value => <option key={value} value={value}>{value}</option>)}
                </SelectControl>
              </label>}
              <label><span className="sr-only">Sort saved titles</span>
                <SelectControl value={sort} onChange={event => changeSavedFilter('sort', event.target.value === 'saved' ? '' : event.target.value)}>
                  <option value="saved">Recently saved</option><option value="title">Title A–Z</option>
                </SelectControl>
              </label>
            </div>
          </div>
          {savedTitles.length ? <ul className="library-saved-grid">
            {savedTitles.map((item, index) => {
              const entry = latestHistory.get(item.id);
              const percent = entry ? viewingPercent(entry) : 0;
              return <li key={item.id} className="library-saved-item">
                <TitleCard title={item} index={index} format="landscape" contextual />
                {entry && <div className="library-saved-progress">
                  {percent > 0 && <span className="history-progress" role="progressbar"
                    aria-label={`${item.name ?? item.title ?? 'Untitled'} ${entry.episodeLabel} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
                    <span style={{ width: `${percent}%` }} />
                  </span>}
                  <Link to={`/watch/${encodeURIComponent(entry.slug)}/${encodeURIComponent(entry.episodeId)}?language=${encodeURIComponent(entry.language)}`}>
                    <Icon name="play" /><span>{percent >= 95 ? 'Watch again' : percent > 0 ? 'Resume' : 'Open'} · {entry.episodeLabel}</span>
                  </Link>
                </div>}
              </li>;
            })}
          </ul> : <div className="library-empty">
            <p>No saved titles match these filters.</p>
            <button type="button" className="text-button" onClick={() => setParams({ view: 'list' })}>Clear filters</button>
          </div>}
          </>
        ) : (
          <div className="library-empty">
            <p>Save a title to find it here.</p>
            <Link className="button button--primary" to="/catalogue">
              Explore titles
            </Link>
          </div>
        )}
      </section>}

      {view === 'history' && <section className="library-section" aria-labelledby="history-title">
        <header className="section-heading">
          <div>
            <h2 id="history-title" ref={historyHeading} tabIndex={-1} style={{ scrollMarginTop: 112 }}>Watch history</h2>
          </div>
          {history.entries.length > 0 && (
            <button className="text-button" type="button" aria-haspopup="dialog" onClick={event => {
              markDialogTrigger(event.currentTarget); setClearForProfile(profile?.id ?? null);
            }}>
              Clear history
            </button>
          )}
        </header>
        {history.entries.length > 0 && <label className="history-search">
          <span className="sr-only">Find in watch history</span>
          <input type="search" placeholder="Find a title or episode" value={historyQuery}
            onChange={event => { setHistoryQuery(event.target.value); setHistoryLimit(20); }} />
          <span>{matchingHistory.length} {matchingHistory.length === 1 ? 'episode' : 'episodes'}</span>
        </label>}
        {history.entries.length ? (
          <>
          <ol className="history-list">
            {matchingHistory.slice(0, historyLimit).map((entry) => {
              const percent = progress(entry.position, entry.duration);
              return <li key={`${entry.episodeId}:${entry.language}`}>
                <Link
                  className="history-link"
                  to={`/watch/${encodeURIComponent(entry.slug)}/${encodeURIComponent(entry.episodeId)}?language=${encodeURIComponent(entry.language)}`}
                >
                  <span className="history-art">
                    {entry.imageUrl ? (
                      <img src={entry.imageUrl} alt="" referrerPolicy="no-referrer" />
                    ) : (
                      <Icon name="play" />
                    )}
                  </span>
                  <span>
                    <strong>{entry.title}</strong>
                    <small>
                      {entry.episodeLabel} · {entry.language}
                    </small>
                    {percent > 0 && <span
                      className="history-progress"
                      role="progressbar"
                      aria-label={`${entry.title} viewing progress`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(percent)}
                    >
                      <span style={{ width: `${percent}%` }} />
                    </span>}
                  </span>
                  <span aria-hidden="true">{percent >= 95 ? 'Watch again' : percent > 0 ? 'Resume' : 'Open episode'} →</span>
                </Link>
                <HistoryActions entry={entry} title={watchlist.items.find(item => item.id === entry.titleId)} context="history" />
              </li>;
            })}
          </ol>
          {!matchingHistory.length && <p className="history-no-match">No episodes match this search.</p>}
          {matchingHistory.length > historyLimit && <button type="button" className="button button--outline history-more"
            onClick={() => setHistoryLimit(limit => limit + 20)}>Show more history</button>}
          </>
        ) : (
          <div className="library-empty">
            <p>Episodes you watch will appear here.</p>
          </div>
        )}
      </section>}

      {clearForProfile && clearForProfile === profile?.id && <Dialog title="Clear watch history?" onClose={() => setClearForProfile(null)} className="history-actions-sheet">
        <p className="history-confirm-copy">This clears watch history and Continue Watching for {profile.name}. Your watchlist and marked-as-watched episodes stay saved.</p>
        <div className="history-confirm-actions">
          <button type="button" className="button button--outline" onClick={() => setClearForProfile(null)}>Keep history</button>
          <button type="button" className="button button--primary" onClick={() => {
            if (clearForProfile === profile?.id) history.clear();
            setClearForProfile(null);
          }}>Clear this profile’s history</button>
        </div>
      </Dialog>}
      {view === 'list' && <MyAnimeListLibrary />}
    </div>
  );
}
