import { useStorageScope } from '../account/storageScope';
import { useEffect, useRef, useState } from 'react';
import type { PlaybackResolution } from '../types';
import { readProgress, writeProgress } from '../lib/storage';
import { PLAYER_SANDBOX, PLAYER_PERMISSIONS, playbackUrl } from '../lib/playerPolicy';
import MediaControls from './MediaControls';
import Icon from './Icon';
import { useAppState } from '../state';

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
  const scope = useStorageScope();
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
  const [preferences, setPreferences] = useAppState().preferences;
  const embedMode = preferences.embedMode === 'restricted' ? 'restricted' : 'compatible';
  const setEmbedMode = (mode: 'compatible' | 'restricted') =>
    setPreferences((current) => ({ ...current, embedMode: mode }));
  const [frameAttempt, setFrameAttempt] = useState(0);
  const [frameSlow, setFrameSlow] = useState(false);
  const [insidePreview] = useState(() => window.self !== window.top);
  const inputUrl = resolution.url ?? resolution.embedUrl ?? '';
  const sourceUrl = playbackUrl(inputUrl, resolution.playbackType, window.location.origin) ?? '';
  const progressScope = `${resolution.providerId}:${resolution.playbackType}`;
  const progressKey = `progress:${episodeId}:${language}:${progressScope}`;
  const allowedHostsKey = (resolution.allowedMediaHosts ?? []).join(',');

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
    if (!iframeEnabled || resolution.playbackType !== 'iframe') return;
    setFrameSlow(false);
    update('loading', 'Loading player…');
    const timer = window.setTimeout(() => setFrameSlow(true), 15000);
    return () => window.clearTimeout(timer);
  }, [sourceUrl, iframeEnabled, embedMode, frameAttempt, resolution.playbackType]);

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
    const saveProgress = (seconds: number) => {
      if (scope) scope.write(progressKey, seconds);
      else writeProgress(episodeId, language, progressScope, seconds);
    };
    const validResource = (raw: string) => {
      try {
        const url = new URL(raw, sourceUrl);
        return (
          !allowedHostsKey ||
          (url.protocol === 'https:' && allowedHostsKey.split(',').includes(url.hostname))
        );
      } catch {
        return false;
      }
    };

    const restore = () => {
      if (!rememberProgress || !Number.isFinite(video.duration)) return;
      const saved = scope
        ? scope.read(progressKey)
        : readProgress(episodeId, language, progressScope);
      const seconds = typeof saved === 'number' && Number.isFinite(saved) && saved >= 0 ? saved : 0;
      if (seconds > 5 && seconds < video.duration - 15) video.currentTime = seconds;
    };
    const playing = () => {
      markOpen();
      update('playing', 'Playback started.');
    };
    const ended = () => {
      if (rememberProgress) saveProgress(0);
      callbacks.current.onEnded?.();
    };
    const ready = () => update('ready', 'Source loaded and ready to play.');
    const failed = () =>
      update('error', 'The browser could not play this source. Try another server.');
    const remember = () => {
      if (!rememberProgress || Date.now() - lastProgressWrite < 5000) return;
      lastProgressWrite = Date.now();
      saveProgress(video.currentTime);
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
          const instance = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
            xhrSetup: (xhr, url) => {
              xhr.withCredentials = false;
              if (!validResource(url)) throw Error('Media host is not permitted for this source.');
            },
          });
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
        saveProgress(video.currentTime);
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
    rememberProgress,
    progressScope,
    progressKey,
    scope,
    allowedHostsKey,
  ]);

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
            key={`${sourceUrl}:${embedMode}:${frameAttempt}`}
            src={sourceUrl}
            title="Episode player"
            allow={PLAYER_PERMISSIONS}
            sandbox={embedMode === 'restricted' ? PLAYER_SANDBOX : undefined}
            data-solanime-player="true"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            onLoad={() => {
              setFrameSlow(false);
              update(
                'ready',
                'Player document loaded; media availability is controlled by the provider.',
              );
            }}
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
        {embedMode === 'compatible' && (
          <p className="compatibility-status" role="status">
            Provider compatibility active · provider-controlled playback.
          </p>
        )}
        <p
          className={`player-state player-state--${state}${state === 'error' ? '' : ' sr-only'}`}
          aria-live="polite"
        >
          {detail}
        </p>
        {frameSlow && state === 'loading' && (
          <div className="player-delay" role="status">
            Still waiting for the provider.{' '}
            <button type="button" onClick={() => setFrameAttempt((attempt) => attempt + 1)}>
              Reload player
            </button>
          </div>
        )}
        <details className="player-help">
          <summary>
            Playback settings &amp; help
            <span className="player-mode-label">
              {embedMode === 'compatible' ? 'Standard' : 'Restricted'}
            </span>
          </summary>
          <div className="embed-mode" role="group" aria-label="Provider compatibility">
            <button
              type="button"
              aria-pressed={embedMode === 'restricted'}
              onClick={() => setEmbedMode('restricted')}
            >
              Restricted embed
            </button>
            <button
              type="button"
              aria-pressed={embedMode === 'compatible'}
              onClick={() => setEmbedMode('compatible')}
            >
              Provider compatibility
            </button>
          </div>
          <p className="player-preference-note">
            This choice is saved for your current profile or guest browser and follows you between
            episodes.
          </p>
          <button
            className="button"
            type="button"
            onClick={() => {
              setFrameAttempt((attempt) => attempt + 1);
              setIframeEnabled(true);
              markOpen();
            }}
          >
            Reload player
          </button>
          {embedMode === 'restricted' && (
            <button type="button" className="button" onClick={() => setEmbedMode('compatible')}>
              Fix sandbox warning
            </button>
          )}
          {insidePreview && (
            <p>
              This site is open inside another page. Its restrictions can affect the player.{' '}
              <a href={window.location.href} target="_blank" rel="noopener noreferrer">
                Open Solanime in its own tab
              </a>
            </p>
          )}
          <p>
            {embedMode === 'restricted'
              ? 'A sandbox error means this provider refuses restricted embedding. Provider compatibility removes the sandbox for this source; it also removes its popup and navigation protections.'
              : 'Compatibility mode is a normal provider embed. Solanime cannot block its internal requests or restyle its controls from this page. Use restricted mode or a native source for stronger isolation.'}
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
      <video
        ref={videoRef}
        playsInline
        crossOrigin="anonymous"
        preload="metadata"
        aria-label="Episode video"
      />
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
