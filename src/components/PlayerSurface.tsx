import { useStorageScope } from '../account/storageScope';
import { useEffect, useRef, useState } from 'react';
import type { PlaybackResolution } from '../types';
import { readProgress, writeProgress } from '../lib/storage';
import { mediaIsSupported, playbackUrl } from '../lib/playerPolicy';
import MediaControls from './MediaControls';
import Icon from './Icon';

type PlayerState = 'loading' | 'ready' | 'playing' | 'error';
export function PlayerMessage({
  title,
  children,
  busy = false,
  retry,
}: {
  title: string;
  children?: React.ReactNode;
  busy?: boolean;
  retry?: () => void;
}) {
  return (
    <div
      className="player-message"
      role={busy ? 'status' : 'region'}
      aria-label={title}
      aria-busy={busy}
    >
      {busy ? (
        <span className="loading-spinner" aria-hidden="true" />
      ) : (
        <Icon name="unavailable" className="player-message__icon" />
      )}
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {retry && (
        <button className="button button--primary" type="button" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}
/** Deliberately has no iframe or external-page fallback, including for legacy API responses. */
export default function PlayerSurface({
  resolution,
  episodeId,
  language,
  rememberProgress,
  onStateChange,
  onOpen,
  onEnded,
  onPrevious,
  onNext,
  theater = false,
  onTheater,
}: {
  resolution: PlaybackResolution;
  episodeId: string;
  language: string;
  rememberProgress: boolean;
  onStateChange?: (state: PlayerState, detail?: string) => void;
  onOpen?: () => void;
  onEnded?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  theater?: boolean;
  onTheater?: () => void;
}) {
  const scope = useStorageScope();
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onStateChange, onOpen, onEnded, rememberProgress });
  callbacks.current = { onStateChange, onOpen, onEnded, rememberProgress };
  const [state, setState] = useState<PlayerState>('loading');
  const [detail, setDetail] = useState('Loading video…');
  const [attempt, setAttempt] = useState(0);
  const supported = mediaIsSupported(resolution, window.location.origin);
  const sourceUrl = supported
    ? playbackUrl(resolution.url ?? '', resolution.playbackType, window.location.origin)!
    : '';
  const progressScope = `${resolution.providerId}:${resolution.playbackType}`;
  const progressKey = `progress:${episodeId}:${language}:${progressScope}`;
  const allowedHostsKey = (resolution.allowedMediaHosts ?? []).join(',');

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !sourceUrl) return;
    let hls: { destroy(): void } | null = null;
    let dash: { reset(): void } | null = null;
    let cancelled = false,
      opened = false,
      restored = false;
    let lastProgressWrite = 0;
    const update = (next: PlayerState, message: string) => {
      if (cancelled) return;
      setState(next);
      setDetail(message);
      callbacks.current.onStateChange?.(next, message);
    };
    update('loading', 'Loading video…');
    const timer = window.setTimeout(() => {
      if (video.readyState < 2)
        update(
          'error',
          'The video is taking too long to load. Try again or choose another source.',
        );
    }, 25_000);
    const save = (seconds: number) => {
      if (!callbacks.current.rememberProgress || !Number.isFinite(seconds) || seconds < 0) return;
      if (scope) scope.write(progressKey, seconds);
      else writeProgress(episodeId, language, progressScope, seconds);
    };
    const restore = () => {
      if (restored || !Number.isFinite(video.duration)) return;
      restored = true;
      if (!callbacks.current.rememberProgress) return;
      const value = scope
        ? scope.read(progressKey)
        : readProgress(episodeId, language, progressScope);
      if (typeof value === 'number' && value > 5 && value < video.duration - 15)
        video.currentTime = value;
    };
    const ready = () => {
      clearTimeout(timer);
      update(video.paused ? 'ready' : 'playing', '');
    };
    const playing = () => {
      clearTimeout(timer);
      if (!opened) {
        opened = true;
        callbacks.current.onOpen?.();
      }
      update('playing', '');
    };
    const ended = () => {
      save(0);
      callbacks.current.onEnded?.();
    };
    const failed = () =>
      update('error', 'This video could not be played. Try again or choose another source.');
    const remember = () => {
      if (!video.ended && Date.now() - lastProgressWrite >= 5000) {
        lastProgressWrite = Date.now();
        save(video.currentTime);
      }
    };
    video.addEventListener('loadedmetadata', restore);
    video.addEventListener('canplay', ready);
    video.addEventListener('playing', playing);
    video.addEventListener('error', failed);
    video.addEventListener('timeupdate', remember);
    video.addEventListener('ended', ended);
    const attach = async () => {
      if (resolution.playbackType === 'hls') {
        if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = sourceUrl;
        else {
          const { default: Hls } = await import('hls.js');
          if (cancelled) return;
          if (!Hls.isSupported()) {
            update('error', 'This browser cannot play this HLS source.');
            return;
          }
          const instance = new Hls({
            enableWorker: true,
            xhrSetup: (xhr, raw) => {
              xhr.withCredentials = false;
              const url = new URL(raw, sourceUrl);
              if (
                allowedHostsKey &&
                !(url.protocol === 'https:' && allowedHostsKey.split(',').includes(url.hostname))
              )
                throw Error('Unapproved media host.');
            },
          });
          hls = instance;
          instance.attachMedia(video);
          instance.loadSource(sourceUrl);
          instance.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) failed();
          });
        }
      } else if (resolution.playbackType === 'dash') {
        const dashjs = await import('dashjs');
        if (cancelled) return;
        const instance = dashjs.MediaPlayer().create();
        dash = instance;
        instance.initialize(video, sourceUrl, false);
        instance.on(dashjs.MediaPlayer.events.ERROR, failed);
      } else video.src = sourceUrl;
    };
    void attach().catch(failed);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      video.removeEventListener('loadedmetadata', restore);
      video.removeEventListener('canplay', ready);
      video.removeEventListener('playing', playing);
      video.removeEventListener('error', failed);
      video.removeEventListener('timeupdate', remember);
      video.removeEventListener('ended', ended);
      if (!video.ended && video.currentTime > 0) save(video.currentTime);
      hls?.destroy();
      dash?.reset();
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [
    sourceUrl,
    resolution.playbackType,
    episodeId,
    language,
    progressScope,
    progressKey,
    scope,
    allowedHostsKey,
    attempt,
  ]);

  if (!supported)
    return (
      <PlayerMessage title="Unsupported source">
        This source cannot be played through Solanime’s controls. Choose another source or episode.
      </PlayerMessage>
    );
  return (
    <div className="player-video" ref={frameRef} data-player="solanime-native">
      <video
        ref={videoRef}
        playsInline
        crossOrigin="anonymous"
        preload="metadata"
        aria-label="Episode video"
      >
        {(resolution.captions ?? []).map((track) => {
          const url = playbackUrl(track.url, 'direct', window.location.origin);
          if (
            !url ||
            (allowedHostsKey && !allowedHostsKey.split(',').includes(new URL(url).hostname))
          )
            return null;
          return (
            <track
              key={`${url}:${track.language}`}
              src={url}
              kind="subtitles"
              srcLang={track.language}
              label={track.label}
              default={track.default}
            />
          );
        })}
      </video>
      {state === 'loading' && (
        <div className="media-loading" role="status">
          <span className="loading-spinner" aria-hidden="true" />
          <span className="sr-only">Loading video</span>
        </div>
      )}
      {state === 'error' && (
        <div className="media-failure">
          <PlayerMessage title="Video unavailable" retry={() => setAttempt((n) => n + 1)}>
            {detail}
          </PlayerMessage>
        </div>
      )}
      <MediaControls
        videoRef={videoRef}
        frameRef={frameRef}
        onPrevious={onPrevious}
        onNext={onNext}
        theater={theater}
        onTheater={onTheater}
      />
    </div>
  );
}
