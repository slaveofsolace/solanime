import { useEffect, useRef, useState } from 'react';
import type { PlaybackResolution } from '../types';
import {
  isOfficialYouTubeResolution,
  officialYouTubeEmbedUrl,
  officialYouTubeError,
  YOUTUBE_IFRAME_ALLOW,
  YOUTUBE_IFRAME_SANDBOX,
  type OfficialYouTubeResolution,
} from '../lib/youtubeOfficialPolicy';

type PlayerEvent<T = unknown> = { data: T; target: YouTubePlayer };
type YouTubePlayer = {
  destroy(): void;
  getCurrentTime(): number;
  getDuration(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
};
type YouTubeApi = {
  Player: new (
    element: HTMLIFrameElement,
    options: {
      events: {
        onReady(event: PlayerEvent): void;
        onStateChange(event: PlayerEvent<number>): void;
        onError(event: PlayerEvent<number>): void;
      };
    },
  ) => YouTubePlayer;
};

function isYouTubePlayer(value: unknown): value is YouTubePlayer {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<YouTubePlayer>;
  return (
    typeof candidate.destroy === 'function' &&
    typeof candidate.getCurrentTime === 'function' &&
    typeof candidate.getDuration === 'function' &&
    typeof candidate.seekTo === 'function'
  );
}

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const API_SCRIPT_ID = 'solanime-youtube-iframe-api';
let apiPromise: Promise<YouTubeApi> | null = null;

function loadYouTubeApi(): Promise<YouTubeApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YouTubeApi>((resolve, reject) => {
    let finished = false;
    const previous = window.onYouTubeIframeAPIReady;
    const settle = () => {
      if (finished || !window.YT?.Player) return;
      finished = true;
      window.clearTimeout(timeout);
      resolve(window.YT);
    };
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      settle();
    };
    let script = document.getElementById(API_SCRIPT_ID) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.id = API_SCRIPT_ID;
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.referrerPolicy = 'strict-origin-when-cross-origin';
      document.head.appendChild(script);
    }
    script.addEventListener('load', settle, { once: true });
    script.addEventListener('error', () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      script?.remove();
      apiPromise = null;
      reject(new Error('The official YouTube player library could not be loaded.'));
    }, { once: true });
    const timeout = window.setTimeout(() => {
      if (finished) return;
      finished = true;
      script?.remove();
      apiPromise = null;
      reject(new Error('The official YouTube player took too long to initialize.'));
    }, 12_000);
    settle();
  });
  return apiPromise;
}

interface Props {
  resolution: PlaybackResolution | OfficialYouTubeResolution;
  initialPosition?: number;
  onOpen?: () => void;
  onProgress?: (position: number, duration: number) => void;
  onEnded?: () => void;
}

export default function YouTubeOfficialPlayer({
  resolution,
  initialPosition,
  onOpen,
  onProgress,
  onEnded,
}: Props) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const callbacks = useRef({ onOpen, onProgress, onEnded });
  callbacks.current = { onOpen, onProgress, onEnded };
  const opened = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'playing' | 'error'>('loading');
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const officialResolution = isOfficialYouTubeResolution(resolution) ? resolution : null;
  const source = officialResolution
    ? officialYouTubeEmbedUrl(officialResolution, window.location.origin)
    : null;
  const sourceApproved = Boolean(source);

  useEffect(() => {
    const frame = iframe.current;
    if (!frame || !source || !sourceApproved) return;
    let cancelled = false;
    let player: YouTubePlayer | null = null;
    let progressTimer: number | undefined;
    opened.current = false;
    setState('loading');
    setError(null);
    const sample = (eventPlayer?: unknown) => {
      if (cancelled) return;
      const activePlayer = isYouTubePlayer(eventPlayer) ? eventPlayer : player;
      if (!activePlayer) return;
      const position = activePlayer.getCurrentTime();
      const duration = activePlayer.getDuration();
      if (Number.isFinite(position) && position >= 0 && Number.isFinite(duration) && duration > 0)
        callbacks.current.onProgress?.(position, duration);
    };
    const stopSampling = () => {
      if (progressTimer !== undefined) window.clearInterval(progressTimer);
      progressTimer = undefined;
    };
    void loadYouTubeApi().then((api) => {
      if (cancelled) return;
      const candidate = new api.Player(frame, {
        events: {
          onReady(event) {
            if (cancelled) return;
            if (isYouTubePlayer(event.target)) player = event.target;
            setState('ready');
            const duration = isYouTubePlayer(event.target) ? event.target.getDuration() : Number.NaN;
            const endGuard = Number.isFinite(duration) ? Math.min(15, Math.max(1, duration * .05)) : 15;
            if (
              typeof initialPosition === 'number' &&
              Number.isFinite(initialPosition) &&
              initialPosition >= 5 &&
              Number.isFinite(duration) &&
              initialPosition < duration - endGuard
            )
              event.target.seekTo(initialPosition, true);
          },
          onStateChange(event) {
            if (cancelled) return;
            if (isYouTubePlayer(event.target)) player = event.target;
            if (event.data === 1) {
              setState('playing');
              if (!opened.current) {
                opened.current = true;
                callbacks.current.onOpen?.();
              }
              if (progressTimer === undefined) {
                sample(event.target);
                progressTimer = window.setInterval(sample, 1_000);
              }
              return;
            }
            if (event.data === 0) {
              sample(event.target);
              stopSampling();
              callbacks.current.onEnded?.();
              return;
            }
            if (event.data === 2) {
              sample(event.target);
              stopSampling();
              setState('ready');
            }
          },
          onError(event) {
            if (cancelled) return;
            stopSampling();
            setError(officialYouTubeError(event.data));
            setState('error');
          },
        },
      });
      if (isYouTubePlayer(candidate)) player = candidate;
    }).catch((reason: unknown) => {
      if (cancelled) return;
      setError({
        code: 'YOUTUBE_API_UNAVAILABLE',
        message: reason instanceof Error ? reason.message : 'The official YouTube player could not be loaded.',
      });
      setState('error');
    });
    return () => {
      stopSampling();
      sample();
      cancelled = true;
      if (isYouTubePlayer(player)) player.destroy();
    };
  // Resume position is a one-time input for a given player instance. Progress
  // persistence updates it while playback is active; rebuilding here would
  // tear down the iframe immediately after the first progress/open callback.
  // A source change still creates a fresh instance and captures the latest
  // position for the newly selected episode.
  }, [attempt, source, sourceApproved]);

  if (!source || !officialResolution)
    return (
      <div className="provider-player provider-player--rejected" role="alert">
        <div>
          <h2>Official player blocked</h2>
          <p>The response did not match Solanime’s verified publisher and video policy.</p>
        </div>
      </div>
    );

  return (
    <div className="provider-player youtube-official-player" data-provider="youtube-official" data-state={state}>
      <iframe
        ref={iframe}
        key={`${source}:${attempt}`}
        src={source}
        title={`Official YouTube player — ${officialResolution.publisher.label}`}
        sandbox={YOUTUBE_IFRAME_SANDBOX}
        allow={YOUTUBE_IFRAME_ALLOW}
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
      <p className="provider-player__label">Official upload · {officialResolution.publisher.label}</p>
      {state === 'loading' && <span className="sr-only" role="status">Loading official YouTube player</span>}
      {state === 'error' && error && (
        <div className="provider-player__error" role="alert" data-error-code={error.code}>
          <span>{error.message}</span>
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry</button>
        </div>
      )}
    </div>
  );
}
