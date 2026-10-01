import { useAccount } from '../account/AccountProvider';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { TitleCard } from '../components/ui';
import Icon from '../components/Icon';
import MyAnimeListLibrary from '../components/MyAnimeListLibrary';
import { useAppState } from '../state';

function progress(position?: number, duration?: number) {
  if (!duration || !position) return 0;
  return Math.max(0, Math.min(100, (position / duration) * 100));
}

export default function LibraryPage() {
  const { hash } = useLocation();
  const historyHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (hash !== '#history-title') return;
    const frame = requestAnimationFrame(() => {
      historyHeading.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
      historyHeading.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [hash]);
  const { profile } = useAccount();
  const { watchlist, history } = useAppState();
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyLimit, setHistoryLimit] = useState(20);
  const matchingHistory = history.entries.filter(entry =>
    `${entry.title} ${entry.episodeLabel} ${entry.language}`.toLocaleLowerCase().includes(historyQuery.trim().toLocaleLowerCase()));
  return (
    <div className="library-page">
      <header className="library-heading">
        <div>
          <span className="library-heading__eyebrow">Your collection</span>
          <h1>Library</h1>
          <p>
            {profile
              ? `Saved for ${profile.name}`
              : 'Your saved titles and watch history'}
          </p>
        </div>
        <p className="library-heading__count">
          <strong>{watchlist.items.length}</strong>
          <span>{watchlist.items.length === 1 ? 'saved title' : 'saved titles'}</span>
        </p>
      </header>

      <section className="library-section" aria-labelledby="watchlist-title">
        <header className="section-heading">
          <div>
            <h2 id="watchlist-title">My List</h2>
          </div>
        </header>
        {watchlist.items.length ? (
          <div className="title-grid title-grid--compact">
            {watchlist.items.map((item, index) => (
              <TitleCard key={item.id} title={item} index={index} />
            ))}
          </div>
        ) : (
          <div className="library-empty">
            <p>Save a title to find it here.</p>
            <Link className="button button--primary" to="/catalogue">
              Explore titles
            </Link>
          </div>
        )}
      </section>

      <section className="library-section" aria-labelledby="history-title">
        <header className="section-heading">
          <div>
            <h2 id="history-title" ref={historyHeading} tabIndex={-1} style={{ scrollMarginTop: 112 }}>Watch history</h2>
          </div>
          {history.entries.length > 0 && (
            <button className="text-button" type="button" onClick={history.clear}>
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
                <button
                  className="history-remove"
                  type="button"
                  aria-label={`Remove ${entry.title} ${entry.episodeLabel} from history`}
                  onClick={() => history.remove(entry.episodeId, entry.language)}
                >
                  Remove
                </button>
              </li>;
            })}
          </ol>
          {!matchingHistory.length && <p className="history-no-match">No episodes match this search.</p>}
          {matchingHistory.length > historyLimit && <button type="button" className="button button--outline history-more"
            onClick={() => setHistoryLimit(limit => limit + 20)}>Show more history</button>}
          </>
        ) : (
          <div className="library-empty">
            <p>Episodes you open will appear here.</p>
          </div>
        )}
      </section>

      <MyAnimeListLibrary />
    </div>
  );
}
