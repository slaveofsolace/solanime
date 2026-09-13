import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { mediaIsSupported } from '../lib/playerPolicy';
import type { PlaybackResolution, ProviderChoice, TitleDetailResponse } from '../types';
import { useAppState } from '../state';
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
import '../styles/title-watch.css';

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
  const [providers, setProviders] = useState<ProviderChoice[]>([]),
    [loadingSources, setLoadingSources] = useState(true);
  const [resolution, setResolution] = useState<PlaybackResolution | null>(null),
    [failure, setFailure] = useState<string | null>(null);
  const [failureStage, setFailureStage] = useState<'providers' | 'resolution' | null>(null);
  const [resolving, setResolving] = useState(false),
    [unsupported, setUnsupported] = useState(false),
    [providerRetry, setProviderRetry] = useState(0),
    [resolutionRetry, setResolutionRetry] = useState(0);
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
  const playableProviders = providers.filter(
    (provider) =>
      (provider.kind === 'native' || provider.kind === 'official-youtube') &&
      provider.supported === true &&
      provider.status === 'available',
  );
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
      >
        <p>This episode is not in the title’s catalogue.</p>
      </StatusPanel>
    );
  const title = detail.title;
  const go = (id: string) =>
    navigate(
      `/watch/${encodeURIComponent(slug)}/${encodeURIComponent(id)}?language=${encodeURIComponent(language)}`,
    );
  const localNotes = comments.forEpisode(episode.id);
  const activeVersion = episode.versions.find((version) => version.language === language);
  const versionLabel = activeVersion?.label?.trim() || language.toUpperCase();
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
  return (
    <div className={`watch-page${theater ? ' watch-page--theater' : ''}`}>
      <Link className="watch-back" to={`/title/${encodeURIComponent(slug)}`}>
        <Icon name="left" />
        Back to title
      </Link>
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
                if (!watched.isWatched(episode.id, language)) watched.toggle(episode.id, language);
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
                if (!watched.isWatched(episode.id, language)) watched.toggle(episode.id, language);
                if (preferences.autoplayNext && next) go(next.id);
              }}
              onError={(message) => {
                setFailure(message);
                setFailureStage('resolution');
                setResolution(null);
              }}
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
                if (!watched.isWatched(episode.id, language)) watched.toggle(episode.id, language);
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
      <div className="watch-selection">
        <div className="episode-nav" role="group" aria-label="Episode navigation">
          <button
            className="icon-button"
            type="button"
            aria-label="Previous episode"
            disabled={!previous}
            onClick={() => previous && go(previous.id)}
          >
            <Icon name="left" />
          </button>
          <label>
            <span>Episode</span>
            <select
              aria-label="Choose episode"
              value={episode.id}
              onChange={(e) => go(e.target.value)}
            >
              {versions.map((e) => (
                <option key={e.id} value={e.id}>
                  {episodeName(e)}
                </option>
              ))}
            </select>
          </label>
          <button
            className="icon-button"
            type="button"
            aria-label="Next episode"
            disabled={!next}
            onClick={() => next && go(next.id)}
          >
            <Icon name="right" />
          </button>
        </div>
        <label className="source-choice">
          <span>Source</span>
          <select
            aria-label="Playback source"
            value={candidate?.mappingId ?? ''}
            disabled={loadingSources || playableProviders.length === 0}
            onChange={(e) =>
              setParams(
                (current) => {
                  const update = new URLSearchParams(current);
                  update.set('server', e.target.value);
                  update.set('language', language);
                  return update;
                },
                { replace: true },
              )
            }
          >
            {!candidate && (
              <option value="">
                {providers.length
                  ? `0 playable sources · ${providers.length} mapped`
                  : 'No sources available'}
              </option>
            )}
            {playableProviders.map((p) => (
              <option key={p.mappingId} value={p.mappingId}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="version-choice">
          <span>Version</span>
          <select
            aria-label="Episode language"
            value={language}
            onChange={(e) => setParams({ language: e.target.value }, { replace: true })}
          >
            {episode.versions.map((v) => (
              <option key={v.id} value={v.language}>
                {v.label?.trim() || v.language.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
      </div>
      <header className="watch-heading">
        <div>
          <p className="watch-heading__episode">
            {episodeName(episode)} · {versionLabel}
          </p>
          <h1>{title.name}</h1>
        </div>
        <button
          type="button"
          className="button button--quiet"
          aria-pressed={watchlist.has(title.id)}
          onClick={() => watchlist.toggle(title.id, title)}
        >
          <Icon name={watchlist.has(title.id) ? 'check' : 'bookmark'} />
          {watchlist.has(title.id) ? 'In My List' : 'My List'}
        </button>
      </header>
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
      <details className="watch-about">
        <summary>About this title</summary>
        <p>
          {title.synopsis || title.description || 'No description is available for this title.'}
        </p>
      </details>
      <details className="watch-chapter watch-episodes" open>
        <summary>
          Episodes <span>{versions.length}</span>
        </summary>
        <EpisodeBrowser
          key={language}
          episodes={versions}
          language={language}
          slug={slug}
          currentId={episode.id}
          compactHeading
        />
      </details>
      <EpisodeCommunity episodeId={episode.id} />
      <details className="watch-chapter">
        <summary>
          Your notes <span>{localNotes.length}</span>
        </summary>
        <div className="comments-layout">
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
              placeholder="Something to remember about this episode…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div>
              <small>Private to your current profile or device.</small>
              <button type="submit" className="button button--primary" disabled={!note.trim()}>
                Save note
              </button>
            </div>
          </form>
          <ul className="comment-list" aria-label="Saved episode notes">
            {localNotes.length === 0 ? (
              <li className="comment-list__empty">
                <strong>No private notes yet</strong>
                <p>Notes you save here stay with this profile or device.</p>
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
  );
}
