import { useEffect, useRef, useState } from 'react';
import type { PlaybackResolution } from '../types';
import { readProgress, writeProgress } from '../lib/storage';

type PlayerState = 'loading' | 'ready' | 'playing' | 'error';

export default function PlayerSurface({
  resolution,
  episodeId,
  language,
  rememberProgress,
  onStateChange,
}: {
  resolution: PlaybackResolution;
  episodeId: string;
  language: string;
  rememberProgress: boolean;
  onStateChange?: (state: PlayerState, detail?: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<PlayerState>('loading');
  const [detail, setDetail] = useState('Preparing the selected source…');
  const [iframeEnabled, setIframeEnabled] = useState(false);
  const sourceUrl = resolution.url ?? resolution.embedUrl ?? '';
  const progressScope = `${resolution.providerId}:${resolution.playbackType}`;

  const update = (next: PlayerState, message: string) => {
    setState(next);
    setDetail(message);
    onStateChange?.(next, message);
  };

  useEffect(() => {
    setIframeEnabled(false);
    setState('loading');
    setDetail('Ready to load the selected provider inside SolAnime.');
  }, [sourceUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !sourceUrl || resolution.playbackType === 'iframe' || resolution.playbackType === 'external') return;

    let hls: { destroy(): void } | null = null;
    let dash: { reset(): void } | null = null;
    let cancelled = false;
    let lastProgressWrite = 0;

    const restore = () => {
      if (!rememberProgress || !Number.isFinite(video.duration)) return;
      const seconds = readProgress(episodeId, language, progressScope);
      if (seconds > 5 && seconds < video.duration - 15) video.currentTime = seconds;
    };
    const playing = () => update('playing', 'Playback started.');
    const ready = () => update('ready', 'Source loaded and ready to play.');
    const failed = () => update('error', 'The browser could not play this source. Try another server.');
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

    const attachSource = async () => {
      if (resolution.playbackType === 'hls') {
        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = sourceUrl;
        } else {
          const { default: Hls } = await import('hls.js');
          if (cancelled) return;
          if (!Hls.isSupported()) { update('error', 'HLS playback is not supported in this browser.'); return; }
          const instance = new Hls({ enableWorker: true, lowLatencyMode: true });
          hls = instance;
          instance.loadSource(sourceUrl);
          instance.attachMedia(video);
          instance.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) update('error', `HLS playback failed (${data.type}). Try another server.`);
          });
        }
      } else if (resolution.playbackType === 'dash') {
        const dashjs = await import('dashjs');
        if (cancelled) return;
        const instance = dashjs.MediaPlayer().create();
        dash = instance;
        instance.initialize(video, sourceUrl, false);
        instance.on(dashjs.MediaPlayer.events.ERROR, () => update('error', 'DASH playback failed. Try another server.'));
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
      if (rememberProgress && video.currentTime > 0) writeProgress(episodeId, language, progressScope, video.currentTime);
      hls?.destroy();
      dash?.reset();
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [sourceUrl, resolution.playbackType, episodeId, language, rememberProgress, progressScope]);

  if (!sourceUrl) {
    return (
      <div className="player-empty" role="alert">
        <p className="eyebrow">NO PLAYABLE RESOURCE</p>
        <h2>The provider did not return a player URL.</h2>
        <p>Select another server. No substitute media will be shown under this provider’s label.</p>
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
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            onLoad={() => update('ready', 'Provider player loaded inside SolAnime. Start playback to verify the media.')}
          />
        ) : (
          <div className="player-consent">
            <p className="eyebrow">READY TO WATCH</p>
            <h2>Play this episode in SolAnime</h2>
            <p>This provider requires its normal unsandboxed embed. It will load only after you choose Play here.</p>
            <button
              className="button button--primary"
              type="button"
              onClick={() => {
                setIframeEnabled(true);
                update('loading', 'Loading the provider player inside SolAnime…');
              }}
            >
              Play here
            </button>
          </div>
        )}
        <p className={`player-state player-state--${state}`} aria-live="polite">{detail}</p>
        <div className="player-fallback"><span>Player unavailable in this browser?</span><a href={sourceUrl} target="_blank" rel="noopener noreferrer">Open provider <span aria-hidden="true">↗</span></a></div>
      </div>
    );
  }

  if (resolution.playbackType === 'external') {
    return (
      <div className="player-empty">
        <p className="eyebrow">EXTERNAL PLAYER</p>
        <h2>This source opens on its provider.</h2>
        <p>The provider does not expose an embeddable player for this mapping.</p>
        <a className="button button--primary" href={sourceUrl} target="_blank" rel="noopener noreferrer">Open provider <span aria-hidden="true">↗</span></a>
      </div>
    );
  }

  return (
    <div className="player-video">
      <video ref={videoRef} controls playsInline preload="metadata" aria-label="Episode video" />
      <p className={`player-state player-state--${state}`} aria-live="polite">{detail}</p>
    </div>
  );
}
