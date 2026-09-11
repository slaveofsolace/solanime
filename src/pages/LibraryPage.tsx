import { Link } from 'react-router-dom';
import { PageIntro, TitleCard } from '../components/ui';
import { useAppState } from '../state';

export default function LibraryPage() {
  const { watchlist, history, preferences } = useAppState();
  const [prefs, setPrefs] = preferences;
  return (
    <div className="library-page">
      <PageIntro
        code="MY LIST"
        title="Watchlist & history"
        copy="Saved only in this browser."
        aside={
          <>
            <strong>{watchlist.items.length}</strong>
            <span>saved titles</span>
          </>
        }
      />

      <section className="library-section" aria-labelledby="watchlist-title">
        <header className="section-heading">
          <div>
            <p className="eyebrow">WATCHLIST</p>
            <h2 id="watchlist-title">Saved for later</h2>
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
            <p className="eyebrow">RECENTLY OPENED</p>
            <h2 id="history-title">Recently opened</h2>
          </div>
          {history.entries.length > 0 && (
            <button className="text-button" type="button" onClick={history.clear}>
              Clear history
            </button>
          )}
        </header>
        {history.entries.length ? (
          <ol className="history-list">
            {history.entries.slice(0, 20).map((entry) => (
              <li key={`${entry.episodeId}:${entry.language}`}>
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
                  </span>
                  <span aria-hidden="true">Resume →</span>
                </Link>
                <button
                  className="history-remove"
                  type="button"
                  aria-label={`Remove ${entry.title} ${entry.episodeLabel} from history`}
                  onClick={() => history.remove(entry.episodeId, entry.language)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <div className="library-empty">
            <p>Episodes you open will appear here.</p>
          </div>
        )}
      </section>

      <section className="preferences-section" aria-labelledby="preferences-title">
        <header>
          <p className="eyebrow">PLAYBACK PREFERENCES</p>
          <h2 id="preferences-title">Defaults</h2>
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
              <small>
                Moves to the next episode when a supported direct player finishes. Third-party
                frames cannot report completion.
              </small>
            </span>
            <input
              type="checkbox"
              checked={prefs.autoplayNext}
              onChange={(event) => setPrefs({ ...prefs, autoplayNext: event.target.checked })}
            />
          </label>
          <label>
            <span>
              <strong>Interface theme</strong>
              <small>Stored only in this browser.</small>
            </span>
            <select
              value={prefs.theme ?? 'dark'}
              onChange={(event) =>
                setPrefs({ ...prefs, theme: event.target.value as 'dark' | 'light' })
              }
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
        </div>
      </section>
    </div>
  );
}
