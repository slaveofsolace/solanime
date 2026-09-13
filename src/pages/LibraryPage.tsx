import { useAccount } from '../account/AccountProvider';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { TitleCard } from '../components/ui';
import { useAppState } from '../state';
import AppearanceSettings from '../components/AppearanceSettings';

function progress(position?: number, duration?: number) {
  if (!duration || !position) return 0;
  return Math.max(0, Math.min(100, (position / duration) * 100));
}

export default function LibraryPage() {
  const { profile } = useAccount();
  const { watchlist, history, preferences } = useAppState();
  const [prefs, setPrefs] = preferences;
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyLimit, setHistoryLimit] = useState(20);
  const matchingHistory = history.entries.filter(entry =>
    `${entry.title} ${entry.episodeLabel} ${entry.language}`.toLocaleLowerCase().includes(historyQuery.trim().toLocaleLowerCase()));
  return (
    <div className="library-page">
      <header className="library-heading">
        <div>
          <h1>Library</h1>
          <p>
            {profile
              ? `Saved for ${profile.name}.`
              : 'Saved on this device. Sign in to keep your profiles in sync.'}
          </p>
        </div>
        <p className="library-heading__count">
          <strong>{watchlist.items.length}</strong>
          <span>saved titles</span>
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
            <p>Your watchlist is empty.</p>
            <Link className="button button--primary" to="/catalogue">
              Browse catalogue
            </Link>
          </div>
        )}
      </section>

      <section className="library-section" aria-labelledby="history-title">
        <header className="section-heading">
          <div>
            <h2 id="history-title">Watch history</h2>
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
                      <span aria-hidden="true">SOL</span>
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

      <details className="library-settings">
      <summary>Viewing preferences</summary>
      <div className="library-preferences-grid">
        <section id="appearance" className="preferences-section" aria-labelledby="appearance-title">
          <header>
            <h2 id="appearance-title">Appearance</h2>
            <p className="appearance-caption">Personalize the interface.</p>
          </header>
          <AppearanceSettings />
        </section>
        <section className="preferences-section" aria-labelledby="preferences-title">
          <header>
            <h2 id="preferences-title">Playback defaults</h2>
          </header>
          <div className="preference-list">
            <label>
              <span>
                <strong>Preferred version</strong>
                <small>Used when that version exists.</small>
              </span>
              <select
                value={prefs.preferredLanguage}
                onChange={(event) => setPrefs({ ...prefs, preferredLanguage: event.target.value })}
              >
                <option value="sub">Sub</option>
                <option value="dub">Dub</option>
                <option value="raw">Raw</option>
              </select>
            </label>
            <label>
              <span>
                <strong>Remember progress</strong>
                <small>Supported direct players only.</small>
              </span>
              <input
                type="checkbox"
                checked={prefs.rememberProgress}
                onChange={(event) => setPrefs({ ...prefs, rememberProgress: event.target.checked })}
              />
            </label>
            <label>
              <span>
                <strong>Autoplay next</strong>
                <small>Moves to the next episode when this video finishes.</small>
              </span>
              <input
                type="checkbox"
                checked={prefs.autoplayNext}
                onChange={(event) => setPrefs({ ...prefs, autoplayNext: event.target.checked })}
              />
            </label>
          </div>
        </section>
      </div>
      </details>
    </div>
  );
}
