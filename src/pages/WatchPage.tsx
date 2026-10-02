import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useInitialReadiness } from '../branding/ApplicationReadiness';
import { mediaIsSupported } from '../lib/playerPolicy';
import type { PlaybackResolution, ProviderChoice, TitleDetailResponse } from '../types';
import { useAppState } from '../state';
import { useAccount } from '../account/AccountProvider';
import PlayerSurface, { PlayerMessage } from '../components/PlayerSurface';
import EpisodeBrowser, { episodeName } from '../components/EpisodeBrowser';
import { StatusPanel } from '../components/ui';
import Icon from '../components/Icon';
import EpisodeCommunity from '../components/EpisodeCommunity';
import UnsupportedPlayback from '../components/UnsupportedPlayback';
import ProviderPlayer from '../components/ProviderPlayer';
import { isProviderEmbedResolution } from '../lib/providerEmbedPolicy';
import YouTubeOfficialPlayer from '../components/YouTubeOfficialPlayer';
import { isOfficialYouTubeResolution } from '../lib/youtubeOfficialPolicy';
import { prioritizePlaybackSources } from '../lib/providerPriority';

function safeAttributionUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export default function WatchPage() {
  const { slug = '', episodeId = '' } = useParams();
  const [params] = useSearchParams();
  return <WatchSession key={`${slug}:${episodeId}:${params.get('language') ?? ''}`} />;
}
function WatchSession() {
  const { profile } = useAccount();
  const { slug = '', episodeId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const {
    preferences: [preferences],
    history,
    watched,
    comments,
    watchlist,
    theater,
    setTheater,
  } = useAppState();
  const [detail, setDetail] = useState<TitleDetailResponse | null>(null),
    [titleError, setTitleError] = useState<string | null>(null);
  useInitialReadiness(Boolean(detail), titleError);
  const [providers, setProviders] = useState<ProviderChoice[]>([]),
    [loadingSources, setLoadingSources] = useState(true);
  const [resolution, setResolution] = useState<PlaybackResolution | null>(null),
    [failure, setFailure] = useState<string | null>(null);
  const [failureStage, setFailureStage] = useState<'providers' | 'resolution' | null>(null);
  const [resolving, setResolving] = useState(false),
    [unsupported, setUnsupported] = useState(false),
    [providerRetry, setProviderRetry] = useState(0),
    [resolutionRetry, setResolutionRetry] = useState(0);
  const [failedProviderMappings, setFailedProviderMappings] = useState<Set<string>>(() => new Set());
  const [note, setNote] = useState('');
  const carriedProgress = useRef<{ position: number; duration: number } | null>(null);
  const episode = detail?.episodes.find((item) => item.id === episodeId);
  const requestedLanguage = params.get('language') ?? preferences.preferredLanguage;
  const language = episode?.versions.some((v) => v.language === requestedLanguage)
    ? requestedLanguage
    : (episode?.versions[0]?.language ?? '');
  const versions = useMemo(
    () => detail?.episodes.filter((e) => e.versions.some((v) => v.language === language)) ?? [],
    [detail, language],
  );
  const index = versions.findIndex((e) => e.id === episodeId),
    previous = versions[index - 1],
    next = index >= 0 ? versions[index + 1] : undefined;
  const requestedMapping = params.get('server');
  const requestedProvider = requestedMapping
    ? providers.find((p) => p.mappingId === requestedMapping)
    : undefined;
  const playableProviders = prioritizePlaybackSources(providers.filter(
    (provider) =>
      (provider.kind === 'native' || provider.kind === 'official-youtube' || provider.kind === 'embed') &&
      provider.supported === true &&
      provider.status === 'available' &&
      !failedProviderMappings.has(provider.mappingId),
  ));
  const candidate = requestedMapping
    ? playableProviders.find((p) => p.mappingId === requestedMapping)
    : playableProviders[0];
  useEffect(() => {
    const abort = new AbortController();
    void api
      .title(slug, abort.signal)
      .then((result) => {
        if (!abort.signal.aborted) setDetail(result);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setTitleError(errorMessage(e));
      });
    return () => abort.abort();
  }, [slug]);
  useEffect(() => {
    if (!episode?.id || !language) return;
    setFailedProviderMappings(new Set());
    const abort = new AbortController();
    setLoadingSources(true);
    setProviders([]);
    setFailure(null);
    setFailureStage(null);
    setResolution(null);
    void api
      .providers(episode.id, language, abort.signal)
      .then((result) => {
        if (abort.signal.aborted) return;
        setProviders(result.providers);
        setLoadingSources(false);
      })
      .catch((e) => {
        if (!abort.signal.aborted) {
          setFailure(errorMessage(e));
          setFailureStage('providers');
          setLoadingSources(false);
        }
      });
    return () => abort.abort();
  }, [episode?.id, language, providerRetry]);
  useEffect(() => {
    setResolution(null);
    setUnsupported(false);
    setResolving(false);
    if (loadingSources) return;
    if (!candidate?.supported || candidate.status !== 'available') {
      setUnsupported(true);
      return;
    }
    const abort = new AbortController();
    setResolving(true);
    setFailure(null);
    setFailureStage(null);
    void api
      .resolve(candidate.mappingId, language, abort.signal)
      .then((source) => {
        if (abort.signal.aborted) return;
        if (isOfficialYouTubeResolution(source) || isProviderEmbedResolution(source, language)) {
          setResolution(source);
          setResolving(false);
          return;
        }
        if (!mediaIsSupported(source, window.location.origin)) {
          setUnsupported(true);
          setResolving(false);
          return;
        }
        setResolution(source);
        setResolving(false);
      })
      .catch((e) => {
        if (!abort.signal.aborted) {
          setFailure(errorMessage(e));
          setFailureStage('resolution');
          setResolving(false);
        }
      });
    return () => abort.abort();
  }, [
    candidate?.mappingId,
    candidate?.supported,
    candidate?.status,
    language,
    loadingSources,
    resolutionRetry,
  ]);
  if (titleError)
    return (
      <StatusPanel
        eyebrow=""
        title="Episode unavailable"
        action={
          <Link className="button button--primary" to={`/title/${encodeURIComponent(slug)}`}>
            Back to title
          </Link>
        }
      >
        <p>{titleError}</p>
      </StatusPanel>
    );
  if (!detail)
    return (
      <div className="watch-page">
        <div className="player-stage">
          <PlayerMessage title="Loading episode" busy />
        </div>
      </div>
    );
  if (!episode)
    return (
      <StatusPanel
        eyebrow=""
        title="Episode not found"
        action={
          <Link className="button" to={`/title/${encodeURIComponent(slug)}`}>
            View episodes
          </Link>
        }
      />
    );
  const title = detail.title;
  const go = (id: string) =>
    navigate(
      `/watch/${encodeURIComponent(slug)}/${encodeURIComponent(id)}?language=${encodeURIComponent(language)}`,
    );
  const localNotes = comments.forEpisode(episode.id);
  const historyEntry = history.entries.find(
    (item) => item.episodeId === episode.id && item.language === language,
  );
  const remember = (position = historyEntry?.position, duration = historyEntry?.duration) => {
    if (
      typeof position === 'number' &&
      Number.isFinite(position) &&
      typeof duration === 'number' &&
      Number.isFinite(duration) &&
      duration > 0
    ) {
      carriedProgress.current = { position, duration };
    }
    history.remember({
      titleId: title.id,
      slug,
      title: title.name,
      imageUrl: title.imageUrl ?? title.posterUrl,
      episodeId: episode.id,
      episodeLabel: episodeName(episode),
      language,
      position,
      duration,
      watchedAt: new Date().toISOString(),
    });
  };
  const handleProviderFailure = (message: string) => {
    const failedMappingId = candidate?.mappingId;
    if (failedMappingId) {
      const failed = new Set(failedProviderMappings);
      failed.add(failedMappingId);
      setFailedProviderMappings(failed);
      const allPlayable = prioritizePlaybackSources(providers.filter(
        (provider) =>
          (provider.kind === 'native' || provider.kind === 'official-youtube' || provider.kind === 'embed') &&
          provider.supported === true &&
          provider.status === 'available' &&
          provider.mappingId !== failedMappingId &&
          !failed.has(provider.mappingId),
      ));
      const nextProvider = allPlayable[0];
      if (nextProvider) {
        setFailure(null);
        setFailureStage(null);
        setResolution(null);
        setParams(
          (current) => {
            const update = new URLSearchParams(current);
            update.set('server', nextProvider.mappingId);
            update.set('language', language);
            return update;
          },
          { replace: true },
        );
        return;
      }
    }
    setFailure(message);
    setFailureStage('resolution');
    setResolution(null);
  };
  const chooseSource = (mappingId: string) =>
    setParams(
      (current) => {
        const update = new URLSearchParams(current);
        update.set('server', mappingId);
        update.set('language', language);
        return update;
      },
      { replace: true },
    );
  const sourceLabel = (p: ProviderChoice) =>
    p.edition
      ? p.providerId === 'youtube-official'
        ? `YouTube · ${p.edition}`
        : `${p.label} · ${p.edition}`
      : p.label;
  const titlePath = `/title/${encodeURIComponent(slug)}`;
  const saved = watchlist.has(title.id);
  return (
    <div className={`watch-page${theater ? ' watch-page--theater' : ''}`}>
      <div className="watch-stage">
        <div className="watch-topbar">
          <Link className="watch-topbar__back" to={titlePath} aria-label={`Back to ${title.name}`}>
            <Icon name="left" />
            <span className="watch-topbar__back-label">Back to title</span>
          </Link>
          <p className="watch-topbar__title" aria-hidden="true">
            <strong>{title.name}</strong>
            <span>{episodeName(episode)}</span>
          </p>
        </div>
        <div className="player-stage">
          {loadingSources || resolving ? (
            <PlayerMessage title="Loading video" busy />
          ) : failure ? (
            <PlayerMessage
              title="Video unavailable"
              retry={() =>
                failureStage === 'providers'
                  ? setProviderRetry((value) => value + 1)
                  : setResolutionRetry((value) => value + 1)
              }
            >
              {failure}
            </PlayerMessage>
          ) : resolution ? (
            isOfficialYouTubeResolution(resolution) ? (
              <YouTubeOfficialPlayer
                key={`${episode.id}:${resolution.mappingId}`}
                resolution={resolution}
                initialPosition={
                  carriedProgress.current?.position ??
                  (preferences.rememberProgress ? historyEntry?.position : undefined)
                }
                onOpen={() => remember()}
                onProgress={(position, duration) => {
                  carriedProgress.current = { position, duration };
                  if (preferences.rememberProgress) remember(position, duration);
                }}
                onEnded={() => {
                  if (profile && !watched.isWatched(episode.id, language)) watched.toggle(episode.id, language);
                  if (preferences.autoplayNext && next) go(next.id);
                }}
              />
            ) : isProviderEmbedResolution(resolution, language) ? (
              <ProviderPlayer
                key={`${episode.id}:${resolution.mappingId}`}
                resolution={resolution}
                language={language}
                onOpen={() => remember()}
                onProgress={(position, duration) => {
                  carriedProgress.current = { position, duration };
                  if (preferences.rememberProgress) remember(position, duration);
                }}
                onEnded={() => {
                  if (profile && !watched.isWatched(episode.id, language)) watched.toggle(episode.id, language);
                  if (preferences.autoplayNext && next) go(next.id);
                }}
                onError={(message) => {
                  handleProviderFailure(message);
                }}
                onRefresh={() => setResolutionRetry((value) => value + 1)}
              />
            ) : (
              <PlayerSurface
                key={`${episode.id}:${resolution.mappingId}`}
                resolution={resolution}
                episodeId={episode.id}
                language={language}
                rememberProgress={preferences.rememberProgress}
                initialPosition={
                  carriedProgress.current?.position ??
                  (preferences.rememberProgress ? historyEntry?.position : undefined)
                }
                theater={theater}
                onTheater={() => setTheater((value) => !value)}
                onPrevious={previous ? () => go(previous.id) : undefined}
                onNext={next ? () => go(next.id) : undefined}
                onOpen={() => remember()}
                onProgress={(position, duration) => {
                  carriedProgress.current = { position, duration };
                  if (preferences.rememberProgress) remember(position, duration);
                }}
                onEnded={() => {
                  if (profile && !watched.isWatched(episode.id, language)) watched.toggle(episode.id, language);
                  if (preferences.autoplayNext && next) go(next.id);
                }}
              />
            )
          ) : (
            <UnsupportedPlayback
              providers={providers}
              selected={unsupported ? requestedProvider ?? candidate : undefined}
              artworkUrl={
                title.artwork?.backdrop?.url ??
                title.backdropUrl ??
                title.artwork?.poster?.url ??
                title.imageUrl ??
                title.posterUrl
              }
            />
          )}
        </div>
      </div>
      <section className="watch-info" aria-labelledby="watch-title">
        <header className="watch-heading">
          <div className="watch-heading__copy">
            <p className="watch-heading__episode">
              {episode.number != null && /^\d+(?:\.\d+)?$/.test(String(episode.number)) && (
                <span className="watch-heading__number">E{episode.number}</span>
              )}
              <span>{episodeName(episode)}</span>
            </p>
            <h1 id="watch-title">
              <Link to={titlePath}>{title.name}</Link>
            </h1>
          </div>
          <button
            type="button"
            className="watch-save"
            aria-pressed={saved}
            aria-label={saved ? 'In My List' : 'My List'}
            onClick={() => watchlist.toggle(title.id, title)}
          >
            <Icon name={saved ? 'check' : 'bookmark'} />
            <span>{saved ? 'In My List' : 'My List'}</span>
          </button>
        </header>
        <div className="watch-steps" role="group" aria-label="Episode navigation">
          <button
            className="watch-step"
            type="button"
            aria-label="Previous episode"
            disabled={!previous}
            onClick={() => previous && go(previous.id)}
          >
            <Icon name="previous" />
            <span>Previous</span>
          </button>
          <button
            className="watch-step watch-step--next"
            type="button"
            aria-label="Next episode"
            disabled={!next}
            onClick={() => next && go(next.id)}
          >
            <span className="watch-step__copy">
              <small>{next ? 'Up next' : 'Last episode'}</small>
              <strong>{next ? episodeName(next) : 'You’re all caught up'}</strong>
            </span>
            <Icon name="next" />
          </button>
        </div>
        <div className="watch-options">
          {episode.versions.length > 0 && (
            <div className="watch-option">
              <span className="watch-option__label" id="watch-language-label">Audio</span>
              <div className="segmented-control" role="group" aria-labelledby="watch-language-label">
                {episode.versions.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    aria-pressed={v.language === language}
                    onClick={() => v.language !== language && setParams({ language: v.language }, { replace: true })}
                  >
                    {v.label?.trim() || (v.language === 'sub' ? 'Subtitled' : v.language === 'dub' ? 'Dubbed' : v.language.toUpperCase())}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="watch-option">
            <span className="watch-option__label" id="watch-source-label">Server</span>
            {playableProviders.length ? (
              <div className="segmented-control segmented-control--scroll" role="group" aria-labelledby="watch-source-label">
                {playableProviders.map((p) => (
                  <button
                    key={p.mappingId}
                    type="button"
                    aria-pressed={p.mappingId === candidate?.mappingId}
                    onClick={() => p.mappingId !== candidate?.mappingId && chooseSource(p.mappingId)}
                  >
                    {sourceLabel(p)}
                  </button>
                ))}
              </div>
            ) : (
              <span className="watch-option__empty">
                {loadingSources ? 'Checking servers…' : providers.length ? 'No playable servers' : 'No servers available'}
              </span>
            )}
          </div>
        </div>
        {resolution?.attribution && safeAttributionUrl(resolution.attribution.url) && (
          <p className="source-attribution">
            Playing from{' '}
            <a
              href={safeAttributionUrl(resolution.attribution.url)!}
              target="_blank"
              rel="noreferrer nofollow"
            >
              {resolution.attribution.label}
            </a>{' '}
            ·{' '}
            {/public domain/i.test(resolution.attribution.license)
              ? 'Public domain'
              : resolution.attribution.license}
          </p>
        )}
      </section>
      <section className="watch-episodes" aria-labelledby="watch-episodes-heading">
        <header className="watch-section-heading">
          <h2 id="watch-episodes-heading">Episodes</h2>
          <span className="watch-count">{versions.length}</span>
        </header>
        <EpisodeBrowser
          key={language}
          episodes={versions}
          language={language}
          slug={slug}
          currentId={episode.id}
          title={title}
          compactHeading
        />
      </section>
      <div className="watch-extras">
        <details className="watch-about disclosure">
          <summary className="disclosure-trigger"><span>About this title</span><Icon name="right" /></summary>
          <div className="disclosure-content"><p>
            {title.synopsis || title.description || 'No description is available for this title.'}
          </p></div>
        </details>
        <EpisodeCommunity episodeId={episode.id} />
        <details className="watch-notes disclosure">
          <summary className="disclosure-trigger">
            <span>Your notes</span><span className="disclosure-accessory"><span className="watch-count">{localNotes.length}</span><Icon name="right" /></span>
          </summary>
          <div className="comments-layout disclosure-content">
            <form
              className="comment-form"
              onSubmit={(e) => {
                e.preventDefault();
                comments.add(episode.id, 'You', note);
                setNote('');
              }}
            >
              <label htmlFor="episode-note">Note</label>
              <textarea
                id="episode-note"
                required
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <div>
                <small>Private to your selected profile.</small>
                <button type="submit" className="button button--primary" disabled={!note.trim()}>
                  Save note
                </button>
              </div>
            </form>
            <ul className="comment-list" aria-label="Saved episode notes">
              {localNotes.length === 0 ? (
                <li className="comment-list__empty">
                  <strong>No notes yet</strong>
                </li>
              ) : localNotes.map((n) => (
                  <li key={n.id}>
                    <p>{n.body}</p>
                    <button className="text-button" type="button" onClick={() => comments.remove(n.id)}>
                      Delete note
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        </details>
      </div>
    </div>
  );
}
