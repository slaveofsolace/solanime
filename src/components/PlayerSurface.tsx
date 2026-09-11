import { useEffect, useRef, useState } from 'react';
import type { PlaybackResolution } from '../types';
import { readProgress, writeProgress } from '../lib/storage';
import { PLAYER_SANDBOX, PLAYER_PERMISSIONS, playbackUrl } from '../lib/playerPolicy';
import MediaControls from './MediaControls';
import Icon from './Icon';

type PlayerState = 'loading' | 'ready' | 'playing' | 'error';

export default function PlayerSurface({
  resolution,
  episodeId,
  language,
  rememberProgress,
  onStateChange,
  onOpen,
  onEnded,
}: {
  resolution: PlaybackResolution;
  episodeId: string;
  language: string;
  rememberProgress: boolean;
  onStateChange?: (state: PlayerState, detail?: string) => void;
  onOpen?: () => void;
  onEnded?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onStateChange, onOpen, onEnded });
  callbacks.current = { onStateChange, onOpen, onEnded };
  const opened = useRef(false);
  const markOpen = () => {
    if (!opened.current) {
      opened.current = true;
      callbacks.current.onOpen?.();
    }
  };
  const [state, setState] = useState<PlayerState>('loading');
  const [detail, setDetail] = useState('Preparing the selected source…');
  const [iframeEnabled, setIframeEnabled] = useState(false);
  const inputUrl = resolution.url ?? resolution.embedUrl ?? '';
  const sourceUrl = playbackUrl(inputUrl, resolution.playbackType, window.location.origin) ?? '';
  const progressScope = `${resolution.providerId}:${resolution.playbackType}`;

  const update = (next: PlayerState, message: string) => {
    setState(next);
    setDetail(message);
    callbacks.current.onStateChange?.(next, message);
  };

  useEffect(() => {
    opened.current = false;
    setIframeEnabled(false);
    setState('loading');
    setDetail('');
  }, [sourceUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (
      !video ||
      !sourceUrl ||
      resolution.playbackType === 'iframe' ||
      !['hls', 'dash', 'direct'].includes(resolution.playbackType)
    )
      return;

    let hls: { destroy(): void } | null = null;
    let dash: { reset(): void } | null = null;
    let cancelled = false;
    let lastProgressWrite = 0;

    const restore = () => {
      if (!rememberProgress || !Number.isFinite(video.duration)) return;
      const seconds = readProgress(episodeId, language, progressScope);
      if (seconds > 5 && seconds < video.duration - 15) video.currentTime = seconds;
    };
    const playing = () => {
      markOpen();
      update('playing', 'Playback started.');
    };
    const ended = () => {
      if (rememberProgress) writeProgress(episodeId, language, progressScope, 0);
      callbacks.current.onEnded?.();
    };
    const ready = () => update('ready', 'Source loaded and ready to play.');
    const failed = () =>
      update('error', 'The browser could not play this source. Try another server.');
    const remember = () => {
      if (!rememberProgress || Date.now() - lastProgressWrite < 5000) return;
      lastProgressWrite = Date.now();
      writeProgress(episodeId, language, progressScope, video.currentTime);
    };
    video.addEventListener('loadedmetadata', restore);
    video.addEventListener('canplay', ready);
    video.addEventListener('playing', playing);
    video.addEventListener('error', failed);
    video.addEventListener('timeupdate', remember);
    video.addEventListener('ended', ended);

    const attachSource = async () => {
      if (resolution.playbackType === 'hls') {
        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = sourceUrl;
        } else {
          const { default: Hls } = await import('hls.js');
          if (cancelled) return;
          if (!Hls.isSupported()) {
            update('error', 'HLS playback is not supported in this browser.');
            return;
          }
          const instance = new Hls({ enableWorker: true, lowLatencyMode: true });
          hls = instance;
          instance.loadSource(sourceUrl);
          instance.attachMedia(video);
          instance.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal)
              update('error', `HLS playback failed (${data.type}). Try another server.`);
          });
        }
      } else if (resolution.playbackType === 'dash') {
        const dashjs = await import('dashjs');
        if (cancelled) return;
        const instance = dashjs.MediaPlayer().create();
        dash = instance;
        instance.initialize(video, sourceUrl, false);
        instance.on(dashjs.MediaPlayer.events.ERROR, () =>
          update('error', 'DASH playback failed. Try another server.'),
        );
      } else {
        video.src = sourceUrl;
      }
    };
    void attachSource().catch(() => {
      if (!cancelled) update('error', 'The player module could not initialize this source.');
    });

    return () => {
      cancelled = true;
      video.removeEventListener('loadedmetadata', restore);
      video.removeEventListener('canplay', ready);
      video.removeEventListener('playing', playing);
      video.removeEventListener('error', failed);
      video.removeEventListener('timeupdate', remember);
      video.removeEventListener('ended', ended);
      if (rememberProgress && !video.ended && video.currentTime > 0)
        writeProgress(episodeId, language, progressScope, video.currentTime);
      hls?.destroy();
      dash?.reset();
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [sourceUrl, resolution.playbackType, episodeId, language, rememberProgress, progressScope]);

  if (
    !sourceUrl ||
    !['iframe', 'external', 'hls', 'dash', 'direct'].includes(resolution.playbackType)
  ) {
    return (
      <div className="player-empty" role="alert">
        <p className="eyebrow">NO PLAYABLE RESOURCE</p>
        <h2>The provider did not return a player URL.</h2>
        <p>Select another server. This source does not have a supported playback address.</p>
      </div>
    );
  }

  if (resolution.playbackType === 'iframe') {
    return (
      <div className="player-frame">
        {iframeEnabled ? (
          <iframe
            key={sourceUrl}
            src={sourceUrl}
            title="Episode player"
            allow={PLAYER_PERMISSIONS}
            sandbox={PLAYER_SANDBOX}
            data-solanime-player="true"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            onLoad={() => update('ready', 'Player frame loaded.')}
          />
        ) : (
          <div className="player-consent">
            <h2>Ready when you are</h2>
            <button
              className="button button--primary"
              type="button"
              onClick={() => {
                markOpen();
                setIframeEnabled(true);
                update('loading', 'Loading player…');
              }}
            >
              <Icon name="play" /> Play here
            </button>
          </div>
        )}
        <p
          className={`player-state player-state--${state}${state === 'error' ? '' : ' sr-only'}`}
          aria-live="polite"
        >
          {detail}
        </p>
        <details className="player-help">
          <summary>Player options</summary>
          <p>
            Pop-ups, downloads and top-page redirects are restricted. If a source will not load,
            select another server.
          </p>
          <p>
            Some provider pages do not support restricted embedding. Opening one directly leaves
            these restrictions.
          </p>
          <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
            Open provider in a new tab
          </a>
        </details>
      </div>
    );
  }

  if (resolution.playbackType === 'external') {
    return (
      <div className="player-empty">
        <p className="eyebrow">EXTERNAL PLAYER</p>
        <h2>This source opens on its provider.</h2>
        <p>The provider does not expose an embeddable player for this mapping.</p>
        <a
          className="button button--primary"
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open provider <span aria-hidden="true">↗</span>
        </a>
      </div>
    );
  }

  return (
    <div className="player-video" ref={frameRef}>
      <video ref={videoRef} playsInline preload="metadata" aria-label="Episode video" />
      <MediaControls videoRef={videoRef} frameRef={frameRef} />
      <p
        className={`player-state player-state--${state}${state === 'error' ? '' : ' sr-only'}`}
        aria-live="polite"
      >
        {detail}
      </p>
    </div>
  );
}
