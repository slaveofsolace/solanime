import { useStorageScope } from '../account/storageScope';
import { useEffect, useRef, useState } from 'react';
import type { PlaybackResolution } from '../types';
import { readProgress, writeProgress } from '../lib/storage';
import { mediaCrossOrigin, mediaIsSupported, playbackUrl } from '../lib/playerPolicy';
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
  initialPosition,
  onStateChange,
  onOpen,
  onProgress,
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
  /** Current episode-version position carried across compatible native providers. */
  initialPosition?: number;
  onStateChange?: (state: PlayerState, detail?: string) => void;
  onOpen?: () => void;
  onProgress?: (position: number, duration: number) => void;
  onEnded?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  theater?: boolean;
  onTheater?: () => void;
}) {
  const scope = useStorageScope();
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [overlayTarget, setOverlayTarget] = useState<HTMLDivElement | null>(null);
  const callbacks = useRef({ onStateChange, onOpen, onProgress, onEnded, rememberProgress });
  callbacks.current = { onStateChange, onOpen, onProgress, onEnded, rememberProgress };
  const carriedPosition = useRef(initialPosition);
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
    const controller = new AbortController();
    let cancelled = false,
      opened = false;
    let restoreTarget: number | null | undefined;
    let restoreCheck: number | undefined;
    let restoreStartedAt = 0;
    let restoreStableAt = 0;
    let restoreSettled = false;
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
      if (!Number.isFinite(seconds) || seconds < 0) return;
      if (callbacks.current.rememberProgress) {
        if (scope) scope.write(progressKey, seconds);
        else writeProgress(episodeId, language, progressScope, seconds);
      }
      if (Number.isFinite(video.duration) && video.duration > 0)
        callbacks.current.onProgress?.(seconds, video.duration);
    };
    const stopRestoreCheck = () => {
      if (restoreCheck !== undefined) window.clearInterval(restoreCheck);
      restoreCheck = undefined;
    };
    const restore = () => {
      if (restoreSettled || !Number.isFinite(video.duration)) return;
      if (restoreTarget === undefined) {
        const carried = carriedPosition.current;
        if (!callbacks.current.rememberProgress && typeof carried !== 'number') {
          restoreTarget = null;
          return;
        }
        const stored = callbacks.current.rememberProgress
          ? scope
            ? scope.read(progressKey)
            : readProgress(episodeId, language, progressScope)
          : undefined;
        const value = typeof carried === 'number' && Number.isFinite(carried) ? carried : stored;
        const endGuard = Math.min(15, Math.max(0.25, video.duration * 0.05));
        const minimum = value === carried ? 0 : 5;
        restoreTarget =
          typeof value === 'number' && value > minimum && value < video.duration - endGuard
            ? value
            : null;
      }
      if (restoreTarget === null) return;
      const now = performance.now();
      const difference = video.currentTime - restoreTarget;
      if (difference > 0.1) {
        // Playback or a deliberate forward seek has already moved beyond the carried point.
        restoreSettled = true;
        stopRestoreCheck();
        return;
      }
      if (Math.abs(difference) <= 0.05) {
        restoreStableAt ||= now;
        if (now - restoreStableAt >= 600) {
          restoreSettled = true;
          stopRestoreCheck();
          return;
        }
      } else {
        restoreStableAt = 0;
        try {
          video.currentTime = restoreTarget;
        } catch {
          // Metadata is present but some engines accept the seek only after their next ready event.
        }
      }
      if (restoreCheck === undefined) {
        restoreStartedAt ||= now;
        restoreCheck = window.setInterval(() => {
          if (cancelled || performance.now() - restoreStartedAt > 4_000) {
            restoreSettled = true;
            stopRestoreCheck();
            return;
          }
          restore();
        }, 100);
      }
    };
    const ready = () => {
      // WebKit may reset a loadedmetadata seek while finalizing a new resource; verify once at
      // canplay without rewinding media that has already advanced.
      restore();
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
      if (Number.isFinite(video.duration) && video.duration > 0)
        callbacks.current.onProgress?.(video.duration, video.duration);
      callbacks.current.onEnded?.();
    };
    const failed = () =>
      update('error', 'This video could not be played. Try again or choose another source.');
    const remember = () => {
      restore();
      if (!video.ended && Date.now() - lastProgressWrite >= 5000) {
        lastProgressWrite = Date.now();
        save(video.currentTime);
      } else if (!video.ended && Number.isFinite(video.duration) && video.duration > 0) {
        // Session carry is cheap and must stay current even while durable writes are throttled.
        callbacks.current.onProgress?.(video.currentTime, video.duration);
      }
    };
    // Throttled timeupdate writes can lag up to 5 s, so flush on pause and before the page goes away.
    const flush = () => {
      if (!video.ended && video.currentTime > 0) {
        lastProgressWrite = Date.now();
        save(video.currentTime);
      }
    };
    video.addEventListener('loadedmetadata', restore);
    video.addEventListener('canplay', ready);
    video.addEventListener('pause', flush);
    window.addEventListener('pagehide', flush);
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
        if (typeof MediaSource === 'undefined') {
          update('error', 'This browser cannot play this DASH source.');
          return;
        }
        const dashjs = await import('dashjs');
        if (cancelled) return;
        const instance = dashjs.MediaPlayer().create();
        dash = instance;
        instance.initialize(video, sourceUrl, false);
        instance.on(dashjs.MediaPlayer.events.ERROR, failed);
      } else {
        // Same-origin native files can be checked without widening CORS or proxying. This also
        // gives every browser a deterministic failure signal before attaching a broken resource.
        if (new URL(sourceUrl).origin === window.location.origin) {
          const response = await fetch(sourceUrl, {
            method: 'HEAD',
            cache: 'no-store',
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(`Media returned HTTP ${response.status}.`);
        }
        if (!cancelled) video.src = sourceUrl;
      }
    };
    void attach().catch(failed);
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
      stopRestoreCheck();
      video.removeEventListener('loadedmetadata', restore);
      video.removeEventListener('canplay', ready);
      video.removeEventListener('playing', playing);
      video.removeEventListener('error', failed);
      video.removeEventListener('timeupdate', remember);
      video.removeEventListener('ended', ended);
      video.removeEventListener('pause', flush);
      window.removeEventListener('pagehide', flush);
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
      <div className="player-screen" ref={setOverlayTarget}>
      <video
        ref={videoRef}
        playsInline
        crossOrigin={mediaCrossOrigin(resolution)}
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
      </div>
      <MediaControls
        videoRef={videoRef}
        frameRef={frameRef}
        overlayTarget={state === 'ready' || state === 'playing' ? overlayTarget : null}
        onPrevious={onPrevious}
        onNext={onNext}
        theater={theater}
        onTheater={onTheater}
      />
    </div>
  );
}
