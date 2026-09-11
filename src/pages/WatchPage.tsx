import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon';
import { api, errorMessage } from '../lib/api';
import type { Episode, PlaybackResolution, ProviderChoice, TitleDetail } from '../types';
import { InlineNotice, StatusPanel } from '../components/ui';
import PlayerSurface from '../components/PlayerSurface';
import { useAppState } from '../state';

function episodeName(episode: Episode): string {
  return (
    episode.label ??
    episode.title ??
    (episode.number !== undefined && episode.number !== null
      ? `Episode ${episode.number}`
      : 'Special')
  );
}

function capabilityList(provider: ProviderChoice): string[] {
  if (Array.isArray(provider.capabilities)) return provider.capabilities;
  return Object.entries(provider.capabilities ?? {})
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
}

export default function WatchPage() {
  const { slug = '', episodeId = '' } = useParams();
  const [params] = useSearchParams();
  return <WatchSession key={`${slug}:${episodeId}:${params.get('language') ?? ''}`} />;
}
function WatchSession() {
  const [theater, setTheater] = useState(false);
  const { slug = '', episodeId = '' } = useParams();
  const [params, updateParams] = useSearchParams();
  // URL updates must not restart the provider-list request on each server selection.
  const updateParamsRef = useRef(updateParams);
  updateParamsRef.current = updateParams;
  const setParams = useCallback<typeof updateParams>(
    (next, options) => updateParamsRef.current(next, options),
    [],
  );
  const navigate = useNavigate();
  const { history, preferences, watched, comments } = useAppState();
  const [preference] = preferences;
  const [title, setTitle] = useState<TitleDetail | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [providers, setProviders] = useState<ProviderChoice[]>([]);
  const [resolution, setResolution] = useState<PlaybackResolution | null>(null);
  const [activeMapping, setActiveMapping] = useState<string | null>(null);
  const [pendingMapping, setPendingMapping] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [loadingTitle, setLoadingTitle] = useState(true);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [providerRetry, setProviderRetry] = useState(0);
  const [commentAuthor, setCommentAuthor] = useState('');
  const [commentBody, setCommentBody] = useState('');
  const resolveController = useRef<AbortController | null>(null);
  const requestSequence = useRef(0);
  const [resolutionRetry, setResolutionRetry] = useState(0);
  const requestedLanguage = params.get('language') ?? '';
  const serverFromUrl = params.get('server') ?? '';

  useEffect(() => {
    resolveController.current?.abort();
    requestSequence.current += 1;
    const controller = new AbortController();
    setLoadingTitle(true);
    setPageError(null);
    setResolution(null);
    setActiveMapping(null);
    setPendingMapping(null);
    api
      .title(slug, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        const allEpisodes = result.episodes ?? result.title.episodes ?? [];
        const currentEpisode = allEpisodes.find((item) => item.id === episodeId) ?? null;
        setTitle(result.title);
        setEpisodes(allEpisodes);
        setEpisode(currentEpisode);
        if (!currentEpisode)
          setPageError('This episode is not present in the imported title record.');
        setLoadingTitle(false);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setPageError(errorMessage(cause));
        setLoadingTitle(false);
      });
    return () => controller.abort();
  }, [slug, episodeId]);

  const availableLanguages = episode?.versions.map((version) => version.language) ?? [];
  const language = availableLanguages.includes(requestedLanguage)
    ? requestedLanguage
    : availableLanguages.includes(preference.preferredLanguage)
      ? preference.preferredLanguage
      : (availableLanguages[0] ?? '');

  useEffect(() => {
    resolveController.current?.abort();
    requestSequence.current += 1;
    setPendingMapping(null);
    if (!episode || !language) return;
    if (requestedLanguage !== language) {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set('language', language);
          next.delete('server');
          return next;
        },
        { replace: true },
      );
      return;
    }
    const controller = new AbortController();
    setLoadingProviders(true);
    setProviderError(null);
    setProviders([]);
    setResolution(null);
    setActiveMapping(null);
    api
      .providers(episode.id, language, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setProviders(result.providers ?? []);
        setLoadingProviders(false);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setProviderError(errorMessage(cause));
        setLoadingProviders(false);
      });
    return () => controller.abort();
  }, [episode, language, requestedLanguage, setParams, providerRetry]);

  // The URL is the sole selection authority. A click requests navigation; only
  // the committed route resolves a source. A fast failure cannot select the old URL.
  const selectProvider = useCallback(
    (provider: ProviderChoice, replaceHistory = false) => {
      resolveController.current?.abort();
      requestSequence.current += 1;
      setResolution(null);
      setActiveMapping(null);
      setProviderError(null);
      if (serverFromUrl === provider.mappingId) {
        setResolutionRetry((value) => value + 1);
      } else {
        setPendingMapping(provider.mappingId);
        setParams(
          (current) => {
            const next = new URLSearchParams(current);
            next.set('language', language);
            next.set('server', provider.mappingId);
            return next;
          },
          { replace: replaceHistory },
        );
      }
    },
    [serverFromUrl, language, setParams],
  );
  useEffect(() => {
    if (loadingTitle || loadingProviders || !episode || !language || !providers.length) return;
    const requested = providers.find((provider) => provider.mappingId === serverFromUrl);
    const candidate =
      requested ??
      providers.find(
        (provider) => provider.status !== 'blocked' && provider.status !== 'unavailable',
      );
    if (!candidate) return;
    if (serverFromUrl !== candidate.mappingId) {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set('language', language);
          next.set('server', candidate.mappingId);
          return next;
        },
        { replace: true },
      );
      return;
    }
    setResolution(null);
    setActiveMapping(null);
    setProviderError(null);
    if (candidate.status === 'blocked' || candidate.status === 'unavailable') {
      setPendingMapping(null);
      setProviderError(candidate.reason ?? 'The requested provider mapping is unavailable.');
      return;
    }
    resolveController.current?.abort();
    const controller = new AbortController();
    resolveController.current = controller;
    const sequence = ++requestSequence.current;
    setPendingMapping(candidate.mappingId);
    void api
      .resolve(candidate.mappingId, language, controller.signal)
      .then((result) => {
        if (controller.signal.aborted || sequence !== requestSequence.current) return;
        if (
          result.status === 'unavailable' ||
          result.status === 'blocked' ||
          (!result.url && !result.embedUrl)
        ) {
          const issue = typeof result.error === 'string' ? result.error : result.error?.message;
          throw new Error(issue ?? 'This provider did not return a playable resource.');
        }
        setResolution(result);
        setActiveMapping(candidate.mappingId);
        setPendingMapping(null);
      })
      .catch((cause) => {
        if (controller.signal.aborted || sequence !== requestSequence.current) return;
        setPendingMapping(null);
        setProviderError(errorMessage(cause));
      });
    return () => controller.abort();
  }, [
    episode,
    language,
    providers,
    loadingTitle,
    loadingProviders,
    serverFromUrl,
    resolutionRetry,
    setParams,
  ]);

  useEffect(() => () => resolveController.current?.abort(), []);

  const navigableEpisodes = useMemo(
    () => episodes.filter((item) => item.versions.some((version) => version.language === language)),
    [episodes, language],
  );
  const episodeIndex = navigableEpisodes.findIndex((item) => item.id === episodeId);
  const previous = episodeIndex > 0 ? navigableEpisodes[episodeIndex - 1] : null;
  const next =
    episodeIndex >= 0 && episodeIndex < navigableEpisodes.length - 1
      ? navigableEpisodes[episodeIndex + 1]
      : null;
  const goToEpisode = (target: Episode) =>
    navigate(
      `/watch/${encodeURIComponent(slug)}/${encodeURIComponent(target.id)}?language=${encodeURIComponent(language)}`,
    );

  if (loadingTitle)
    return (
      <StatusPanel eyebrow="" title="Loading episode…" busy>
        <p>Loading the episode and available servers.</p>
      </StatusPanel>
    );
  if (pageError || !title || !episode)
    return (
      <StatusPanel
        eyebrow="EPISODE UNAVAILABLE"
        title="This watch route could not be opened."
        action={
          <Link className="button button--primary" to={`/title/${encodeURIComponent(slug)}`}>
            Back to title
          </Link>
        }
      >
        <p>{pageError ?? 'The episode was not found.'}</p>
      </StatusPanel>
    );

  const rememberViewing = () => {
    history.remember({
      titleId: title.id,
      slug,
      title: title.name,
      imageUrl: title.imageUrl ?? title.posterUrl,
      episodeId: episode.id,
      episodeLabel: episodeName(episode),
      language,
      watchedAt: new Date().toISOString(),
    });
  };
  const titleName = title.name ?? title.title ?? 'Untitled record';
  const episodeComments = comments.forEpisode(episode.id);
  const episodeWatched = watched.isWatched(episode.id, language);

  return (
    <div className={`watch-page${theater ? ' watch-page--theater' : ''}`}>
      <header className="watch-heading">
        <div>
          <nav className="crumbs" aria-label="Breadcrumb">
            <Link to="/catalogue">Catalogue</Link>
            <span>/</span>
            <Link to={`/title/${encodeURIComponent(slug)}`}>{titleName}</Link>
            <span>/</span>
            <span aria-current="page">{episodeName(episode)}</span>
          </nav>
          <p className="eyebrow">NOW WATCHING / {language.toUpperCase()}</p>
          <h1>{titleName}</h1>
          <p>{episodeName(episode)}</p>
        </div>
        <div className="episode-nav" aria-label="Episode navigation">
          <button
            type="button"
            disabled={!previous}
            onClick={() => previous && goToEpisode(previous)}
          >
            <span aria-hidden="true">←</span> Previous
          </button>
          <button type="button" disabled={!next} onClick={() => next && goToEpisode(next)}>
            Next <span aria-hidden="true">→</span>
          </button>
          <label className="episode-jump">
            <span>Jump to</span>
            <select
              aria-label="Jump to episode"
              value={episode.id}
              onChange={(event) => {
                const target = navigableEpisodes.find((item) => item.id === event.target.value);
                if (target) goToEpisode(target);
              }}
            >
              {navigableEpisodes.map((item) => (
                <option value={item.id} key={item.id}>
                  {episodeName(item)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            aria-pressed={episodeWatched}
            onClick={() => watched.toggle(episode.id, language)}
          >
            {episodeWatched ? '✓ Watched' : 'Mark watched'}
          </button>
        </div>
      </header>

      <div className="watch-layout">
        <section className="player-stage" aria-label="Video player">
          {pendingMapping && !resolution ? (
            <div className="player-empty" aria-live="polite" aria-busy="true">
              <p className="eyebrow">RESOLVING SOURCE</p>
              <h2>Connecting to the selected server…</h2>
              <p>Choose another server if this connection is unavailable.</p>
            </div>
          ) : resolution ? (
            <PlayerSurface
              key={`${resolution.mappingId}:${resolution.url ?? resolution.embedUrl}`}
              resolution={resolution}
              episodeId={episode.id}
              language={language}
              rememberProgress={preference.rememberProgress}
              onOpen={rememberViewing}
              onEnded={() => {
                if (!watched.isWatched(episode.id, language)) watched.toggle(episode.id, language);
                if (preference.autoplayNext && next) goToEpisode(next);
              }}
              onStateChange={(state, detail) => {
                if (state === 'error') setProviderError(detail ?? 'Playback failed.');
              }}
            />
          ) : (
            <div className="player-empty">
              <p className="eyebrow">NO ACTIVE SOURCE</p>
              <h2>
                {loadingProviders
                  ? 'Loading servers…'
                  : providers.length
                    ? 'Select an available server.'
                    : 'No servers for this episode'}
              </h2>
              <p>
                {providers.length
                  ? 'Server availability depends on the provider.'
                  : 'The episode is in the catalogue, but no sources have been imported for this version.'}
              </p>
            </div>
          )}
        </section>

        <aside className="server-drawer" aria-labelledby="servers-title">
          <div className="server-drawer__heading">
            <p className="eyebrow">PLAYBACK</p>
            <h2 id="servers-title">Servers</h2>
          </div>
          {availableLanguages.length > 1 && (
            <div
              className="language-tabs language-tabs--vertical"
              role="group"
              aria-label="Episode language"
            >
              {availableLanguages.map((item) => (
                <button
                  type="button"
                  key={item}
                  aria-pressed={item === language}
                  onClick={() => setParams({ language: item })}
                >
                  {item}
                </button>
              ))}
            </div>
          )}
          {loadingProviders ? (
            <p className="drawer-status" aria-live="polite">
              Loading mapped servers…
            </p>
          ) : providers.length === 0 ? (
            <InlineNotice tone="warning">
              No provider mappings are stored for this version.
            </InlineNotice>
          ) : (
            <div className="server-list">
              {providers.map((provider, index) => {
                const selected = provider.mappingId === activeMapping;
                const pending = provider.mappingId === pendingMapping;
                const disabled = provider.status === 'blocked' || provider.status === 'unavailable';
                return (
                  <button
                    type="button"
                    key={provider.mappingId}
                    aria-pressed={selected}
                    disabled={disabled || pending}
                    onClick={() => void selectProvider(provider)}
                  >
                    <span className="server-index">{String(index + 1).padStart(2, '0')}</span>
                    <span>
                      <strong>{provider.label}</strong>
                      <small>
                        {pending ? 'Resolving…' : `${provider.playbackType} · ${provider.status}`}
                      </small>
                    </span>
                    <span
                      className={`availability availability--${provider.status}`}
                      aria-hidden="true"
                    />
                  </button>
                );
              })}
            </div>
          )}
          {providerError && (
            <InlineNotice tone="error">
              <strong>Source not loaded.</strong> {providerError}
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  const selected = providers.find((item) => item.mappingId === serverFromUrl);
                  if (selected) void selectProvider(selected, true);
                  else setProviderRetry((value) => value + 1);
                }}
              >
                Retry selected server
              </button>
            </InlineNotice>
          )}
          {activeMapping &&
            (() => {
              const active = providers.find((provider) => provider.mappingId === activeMapping);
              if (!active) return null;
              const capabilities = capabilityList(active);
              return (
                <details className="source-facts">
                  <summary>Connection details</summary>
                  <p>
                    <span>Active resource</span>
                    <strong>{active.label}</strong>
                  </p>
                  <p>
                    <span>Player mode</span>
                    <strong>{active.playbackType}</strong>
                  </p>
                  {capabilities.length > 0 && (
                    <p>
                      <span>Capabilities</span>
                      <strong>{capabilities.join(', ')}</strong>
                    </p>
                  )}
                  {resolution?.expiresAt && (
                    <p>
                      <span>Resolution expiry</span>
                      <strong>{new Date(resolution.expiresAt).toLocaleString()}</strong>
                    </p>
                  )}
                </details>
              );
            })()}
        </aside>
      </div>

      <nav className="watch-episode-strip" aria-label="Nearby episodes">
        {navigableEpisodes.slice(Math.max(0, episodeIndex - 3), episodeIndex + 4).map((item) => (
          <button
            type="button"
            key={item.id}
            aria-current={item.id === episode.id ? 'page' : undefined}
            onClick={() => goToEpisode(item)}
          >
            <span>{item.number ?? 'SP'}</span>
            <strong>{episodeName(item)}</strong>
          </button>
        ))}
      </nav>

      <section className="comments-section" aria-labelledby="comments-title">
        <header className="section-heading">
          <div>
            <p className="eyebrow">ON THIS DEVICE</p>
            <h2 id="comments-title">Your notes</h2>
          </div>
          <p>
            {episodeComments.length} note{episodeComments.length === 1 ? '' : 's'}
          </p>
        </header>
        <div className="comments-layout">
          <form
            className="comment-form"
            onSubmit={(event) => {
              event.preventDefault();
              comments.add(episode.id, commentAuthor, commentBody);
              setCommentBody('');
            }}
          >
            <label>
              <span>Name</span>
              <input
                value={commentAuthor}
                maxLength={40}
                onChange={(event) => setCommentAuthor(event.target.value)}
                placeholder="Guest"
              />
            </label>
            <label>
              <span>Note</span>
              <textarea
                required
                value={commentBody}
                maxLength={1000}
                onChange={(event) => setCommentBody(event.target.value)}
                placeholder="Add a note about this episode"
              />
            </label>
            <div>
              <small>Notes stay in this browser and are not posted publicly.</small>
              <button className="button button--primary" type="submit">
                Save note
              </button>
            </div>
          </form>
          {episodeComments.length ? (
            <ol className="comment-list">
              {episodeComments.map((comment) => (
                <li key={comment.id}>
                  <header>
                    <strong>{comment.author}</strong>
                    <time dateTime={comment.createdAt}>
                      {new Date(comment.createdAt).toLocaleString()}
                    </time>
                  </header>
                  <p>{comment.body}</p>
                  <button type="button" onClick={() => comments.remove(comment.id)}>
                    Delete
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <div className="comments-empty">
              <p>No notes yet.</p>
              <small>Notes are saved only in this browser.</small>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
